package cli

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/api"
	"github.com/niuulabs/volundr/cli/internal/auth"
	"github.com/niuulabs/volundr/cli/internal/remote"
	"github.com/niuulabs/volundr/cli/internal/tui"
)

var (
	loginIssuer   string
	loginClientID string
	loginDevice   bool
)

func init() {
	loginCmd.Flags().StringVar(&loginIssuer, "issuer", "", "OIDC issuer URL (saved to config for future use)")
	loginCmd.Flags().StringVar(&loginClientID, "client-id", "", "OIDC client ID (saved to config)")
	loginCmd.Flags().BoolVar(&loginDevice, "device", false, "Use device code flow instead of browser")
}

// CLI styles using the theme.
var (
	successMark = lipgloss.NewStyle().Foreground(tui.DefaultTheme.AccentAmber).Render("✓")
	cyanValue   = func(s string) string {
		return lipgloss.NewStyle().Foreground(tui.DefaultTheme.AccentCyan).Render(s)
	}
	mutedText = func(s string) string {
		return lipgloss.NewStyle().Foreground(tui.DefaultTheme.TextMuted).Render(s)
	}
)

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate with an OIDC identity provider",
	Long: `Authenticate with an OIDC identity provider using standard OpenID Connect.

OIDC configuration (issuer and client ID) is auto-discovered from the
configured Volundr server. You can override with --issuer and --client-id.

By default, opens a browser for the Authorization Code flow with PKCE.
Use --device for environments without a browser (e.g. remote servers).`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := remote.Load()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}

		// Resolve issuer and client ID: flags > server discovery > saved config.
		issuer, clientID, err := resolveAuthConfig(cfg)
		if err != nil {
			return err
		}

		// Save issuer and client ID to config for future use.
		cfg.Issuer = issuer
		cfg.ClientID = clientID

		client := auth.NewOIDCClient(issuer)
		ctx := context.Background()

		var token *auth.TokenResponse

		if loginDevice {
			token, err = runDeviceCodeFlow(ctx, client, clientID)
		} else {
			token, err = runAuthCodeFlow(ctx, client, clientID)
		}
		if err != nil {
			return err
		}

		// Store tokens in config.
		cfg.Token = token.AccessToken
		cfg.RefreshToken = token.RefreshToken
		if token.ExpiresIn > 0 {
			cfg.TokenExpiry = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second).UTC().Format(time.RFC3339)
		}

		if err := cfg.Save(); err != nil {
			return fmt.Errorf("saving config: %w", err)
		}

		// Fetch user info for the success message.
		email := ""
		info, infoErr := client.Userinfo(token.AccessToken)
		if infoErr == nil && info.Email != "" {
			email = info.Email
		}

		configPath, _ := remote.ConfigPath()

		if email != "" {
			fmt.Printf("\n%s Logged in as %s\n", successMark, cyanValue(email))
		} else {
			fmt.Printf("\n%s Logged in successfully\n", successMark)
		}
		if cfg.TokenExpiry != "" {
			fmt.Printf("  Token expires: %s\n", cyanValue(cfg.TokenExpiry))
		}
		fmt.Printf("  Config saved to %s\n", mutedText(configPath))

		return nil
	},
}

func runAuthCodeFlow(ctx context.Context, client *auth.OIDCClient, clientID string) (*auth.TokenResponse, error) {
	fmt.Println("Opening browser for authentication...")

	token, redirectURI, err := client.AuthorizationCodeFlow(ctx, clientID, openBrowser)
	if err != nil {
		return nil, fmt.Errorf("authorization code flow: %w", err)
	}

	_ = redirectURI
	return token, nil
}

func runDeviceCodeFlow(ctx context.Context, client *auth.OIDCClient, clientID string) (*auth.TokenResponse, error) {
	fmt.Print("Requesting device code... ")

	token, err := client.DeviceCodeFlow(ctx, clientID, func(resp auth.DeviceCodeResponse) {
		uri := resp.VerificationURI
		if resp.VerificationURIComplete != "" {
			uri = resp.VerificationURIComplete
		}
		fmt.Printf("\nEnter the code below at: %s\n\n", cyanValue(uri))
		fmt.Printf("  Code: %s\n\n", lipgloss.NewStyle().Bold(true).Foreground(tui.DefaultTheme.AccentAmber).Render(resp.UserCode))
		fmt.Print("Waiting for authorization... ")
	})
	if err != nil {
		return nil, fmt.Errorf("device code flow: %w", err)
	}

	fmt.Printf("%s\n", successMark)
	return token, nil
}

// resolveAuthConfig determines the OIDC issuer and client ID to use.
// Priority: CLI flags > server auto-discovery > saved config.
func resolveAuthConfig(cfg *remote.Config) (issuer, clientID string, err error) {
	// If both flags are provided, use them directly.
	if loginIssuer != "" && loginClientID != "" {
		return loginIssuer, loginClientID, nil
	}

	// Try auto-discovery from the Volundr server.
	if loginIssuer == "" || loginClientID == "" {
		discovered := tryAuthDiscovery(cfg)
		if discovered != nil {
			if loginIssuer == "" {
				issuer = discovered.Issuer
			}
			if loginClientID == "" {
				clientID = discovered.ClientID
			}
		}
	}

	// Apply flag overrides.
	if loginIssuer != "" {
		issuer = loginIssuer
	}
	if loginClientID != "" {
		clientID = loginClientID
	}

	// Fall back to saved config.
	if issuer == "" {
		issuer = cfg.Issuer
	}
	if clientID == "" {
		clientID = cfg.ClientID
	}

	if issuer == "" || clientID == "" {
		return "", "", fmt.Errorf("could not determine auth configuration\n\n" +
			"Either configure a server and let it be discovered automatically:\n" +
			"  volundr config set server <url>\n\n" +
			"Or provide flags explicitly:\n" +
			"  volundr login --issuer <url> --client-id <id>")
	}

	return issuer, clientID, nil
}

// tryAuthDiscovery attempts to fetch OIDC config from the Volundr server.
// Returns nil if discovery fails (server not configured, endpoint missing, etc.).
func tryAuthDiscovery(cfg *remote.Config) *api.AuthDiscoveryResponse {
	if cfg.Server == "" || cfg.Server == "http://localhost:8000" {
		return nil
	}

	fmt.Printf("Discovering auth configuration from %s...\n", cyanValue(cfg.Server))

	client := api.NewClient(cfg.Server, "")
	resp, err := client.GetAuthConfig()
	if err != nil {
		fmt.Printf("  %s\n\n", mutedText(fmt.Sprintf("Server does not have auth configured (dev mode). Use --issuer and --client-id flags.")))
		return nil
	}

	if resp.Issuer == "" {
		fmt.Printf("  %s\n\n", mutedText("Server does not have auth configured (dev mode). Use --issuer and --client-id flags."))
		return nil
	}

	fmt.Printf("  %s %s\n", mutedText("Issuer:   "), cyanValue(resp.Issuer))
	fmt.Printf("  %s %s\n\n", mutedText("Client ID:"), cyanValue(resp.ClientID))

	return resp
}

// openBrowser opens the given URL in the default browser.
func openBrowser(url string) error {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		return fmt.Errorf("unsupported platform %s — open this URL manually:\n  %s", runtime.GOOS, url)
	}

	return cmd.Start()
}
