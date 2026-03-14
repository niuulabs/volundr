package cli

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"sort"
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
	loginForce    bool
)

func init() {
	loginCmd.Flags().StringVar(&loginIssuer, "issuer", "", "OIDC issuer URL (saved to config for future use)")
	loginCmd.Flags().StringVar(&loginClientID, "client-id", "", "OIDC client ID (saved to config)")
	loginCmd.Flags().BoolVar(&loginDevice, "device", false, "Use device code flow instead of browser")
	loginCmd.Flags().BoolVar(&loginForce, "force", false, "Re-authenticate even if tokens are still valid")
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
	RunE: func(_ *cobra.Command, _ []string) error {
		cfg, err := remote.Load()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}

		// When no --context flag and multiple contexts exist, login all.
		if cfgContext == "" && len(cfg.Contexts) > 1 {
			return loginAllContexts(cfg)
		}

		ctx, ctxKey, err := cfg.ResolveContext(cfgContext)
		if err != nil {
			return err
		}

		return loginSingleContext(cfg, ctx, ctxKey)
	},
}

// tokenStillValid returns true if the context has a token whose expiry is more
// than 30 seconds in the future.
func tokenStillValid(rctx *remote.Context) bool {
	if rctx.Token == "" || rctx.TokenExpiry == "" {
		return false
	}
	expiry, err := time.Parse(time.RFC3339, rctx.TokenExpiry)
	if err != nil {
		return false
	}
	return time.Until(expiry) > 30*time.Second
}

// loginSingleContext performs login for a single context and saves the config.
func loginSingleContext(cfg *remote.Config, rctx *remote.Context, ctxKey string) error {
	// Resolve issuer and client ID: flags > server discovery > saved config.
	issuer, clientID, err := resolveAuthConfig(rctx)
	if err != nil {
		return err
	}

	// Save issuer and client ID to context for future use.
	rctx.Issuer = issuer
	rctx.ClientID = clientID

	client := auth.NewOIDCClient(issuer)
	bgCtx := context.Background()

	var token *auth.TokenResponse

	if loginDevice {
		token, err = runDeviceCodeFlow(bgCtx, client, clientID)
	} else {
		token, err = runAuthCodeFlow(bgCtx, client, clientID)
	}
	if err != nil {
		return err
	}

	// Store tokens in context.
	rctx.Token = token.AccessToken
	rctx.RefreshToken = token.RefreshToken
	if token.ExpiresIn > 0 {
		rctx.TokenExpiry = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second).UTC().Format(time.RFC3339)
	}

	cfg.Contexts[ctxKey] = rctx
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
	if rctx.TokenExpiry != "" {
		fmt.Printf("  Token expires: %s\n", cyanValue(rctx.TokenExpiry))
	}
	fmt.Printf("  Context: %s\n", cyanValue(ctxKey))
	fmt.Printf("  Config saved to %s\n", mutedText(configPath))

	return nil
}

// loginAllContexts iterates all configured contexts in sorted order and
// authenticates each one. It skips contexts with valid tokens unless --force
// is set. Config is saved once at the end.
func loginAllContexts(cfg *remote.Config) error {
	keys := sortedContextKeys(cfg)
	fmt.Printf("Logging in to %d contexts...\n\n", len(keys))

	failMark := lipgloss.NewStyle().Foreground(tui.DefaultTheme.AccentRed).Render("✗")
	skipMark := lipgloss.NewStyle().Foreground(tui.DefaultTheme.AccentCyan).Render("–")

	var errors []string

	for _, key := range keys {
		rctx := cfg.Contexts[key]
		fmt.Printf("── %s (%s)\n", cyanValue(key), mutedText(rctx.Server))

		// Skip contexts without a server configured.
		if rctx.Server == "" {
			fmt.Printf("   %s Skipped (no server configured)\n\n", skipMark)
			continue
		}

		// Skip if token is still valid and --force not set.
		if !loginForce && tokenStillValid(rctx) {
			fmt.Printf("   %s Token still valid (expires %s)\n\n", skipMark, rctx.TokenExpiry)
			continue
		}

		// Resolve auth config for this context.
		// In multi-login mode, contexts without auth are skipped (not errored).
		issuer, clientID, err := resolveAuthConfig(rctx)
		if err != nil {
			fmt.Printf("   %s No auth configured, skipping\n\n", skipMark)
			continue
		}

		rctx.Issuer = issuer
		rctx.ClientID = clientID

		client := auth.NewOIDCClient(issuer)
		bgCtx := context.Background()

		var token *auth.TokenResponse
		if loginDevice {
			token, err = runDeviceCodeFlow(bgCtx, client, clientID)
		} else {
			token, err = runAuthCodeFlow(bgCtx, client, clientID)
		}
		if err != nil {
			fmt.Printf("   %s %s\n\n", failMark, err)
			errors = append(errors, fmt.Sprintf("%s: %v", key, err))
			continue
		}

		rctx.Token = token.AccessToken
		rctx.RefreshToken = token.RefreshToken
		if token.ExpiresIn > 0 {
			rctx.TokenExpiry = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second).UTC().Format(time.RFC3339)
		}

		// Fetch user info for the success message.
		email := ""
		info, infoErr := client.Userinfo(token.AccessToken)
		if infoErr == nil && info.Email != "" {
			email = info.Email
		}

		if email != "" {
			fmt.Printf("   %s Logged in as %s\n\n", successMark, cyanValue(email))
		} else {
			fmt.Printf("   %s Logged in successfully\n\n", successMark)
		}
	}

	// Save config once at the end.
	if err := cfg.Save(); err != nil {
		return fmt.Errorf("saving config: %w", err)
	}

	configPath, _ := remote.ConfigPath()
	fmt.Printf("Config saved to %s\n", mutedText(configPath))

	if len(errors) > 0 {
		return fmt.Errorf("login failed for %d context(s)", len(errors))
	}

	return nil
}

// sortedContextKeys returns context keys in sorted order.
func sortedContextKeys(cfg *remote.Config) []string {
	keys := make([]string, 0, len(cfg.Contexts))
	for k := range cfg.Contexts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
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
// Priority: CLI flags > server auto-discovery > saved context config.
func resolveAuthConfig(rctx *remote.Context) (issuer, clientID string, err error) {
	// If both flags are provided, use them directly.
	if loginIssuer != "" && loginClientID != "" {
		return loginIssuer, loginClientID, nil
	}

	// Try auto-discovery from the Volundr server.
	if loginIssuer == "" || loginClientID == "" {
		discovered := tryAuthDiscovery(rctx)
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

	// Fall back to saved context config.
	if issuer == "" {
		issuer = rctx.Issuer
	}
	if clientID == "" {
		clientID = rctx.ClientID
	}

	if issuer == "" || clientID == "" {
		return "", "", fmt.Errorf("could not determine auth configuration\n\n" +
			"Either configure a server and let it be discovered automatically:\n" +
			"  volundr context add <name> --server <url>\n\n" +
			"Or provide flags explicitly:\n" +
			"  volundr login --issuer <url> --client-id <id>")
	}

	return issuer, clientID, nil
}

// tryAuthDiscovery attempts to fetch OIDC config from the Volundr server.
// Returns nil if discovery fails (server not configured, endpoint missing, etc.).
func tryAuthDiscovery(rctx *remote.Context) *api.AuthDiscoveryResponse {
	if rctx.Server == "" {
		return nil
	}

	fmt.Printf("Discovering auth configuration from %s...\n", cyanValue(rctx.Server))

	client := api.NewClient(rctx.Server, "")
	resp, err := client.GetAuthConfig()
	if err != nil {
		fmt.Printf("  %s\n\n", mutedText("Server does not have auth configured (dev mode). Use --issuer and --client-id flags."))
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

	ctx := context.Background()
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.CommandContext(ctx, "open", url) //nolint:gosec // URL is constructed from trusted OIDC config
	case "linux":
		cmd = exec.CommandContext(ctx, "xdg-open", url) //nolint:gosec // URL is constructed from trusted OIDC config
	case "windows":
		cmd = exec.CommandContext(ctx, "rundll32", "url.dll,FileProtocolHandler", url) //nolint:gosec // URL is constructed from trusted OIDC config
	default:
		return fmt.Errorf("unsupported platform %s — open this URL manually:\n  %s", runtime.GOOS, url)
	}

	return cmd.Start()
}
