package cli

import (
	"fmt"
	"math"
	"time"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/auth"
	"github.com/niuulabs/volundr/cli/internal/remote"
)



var whoamiCmd = &cobra.Command{
	Use:   "whoami",
	Short: "Display information about the current user",
	Long:  "Call the OIDC userinfo endpoint and display the authenticated user's identity.",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := remote.Load()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}

		if cfg.Token == "" {
			return fmt.Errorf("not logged in — run: volundr login")
		}

		if cfg.Issuer == "" {
			return fmt.Errorf("no issuer configured — run: volundr login --issuer <url>")
		}

		client := auth.NewOIDCClient(cfg.Issuer)
		info, err := client.Userinfo(cfg.Token)
		if err != nil {
			return fmt.Errorf("fetching user info: %w", err)
		}

		name := info.Name
		if name == "" {
			name = info.PreferredUsername
		}
		if name == "" {
			name = info.Sub
		}

		fmt.Printf("  User:    %s\n", cyanValue(name))
		if info.Email != "" {
			fmt.Printf("  Email:   %s\n", cyanValue(info.Email))
		}
		fmt.Printf("  Issuer:  %s\n", cyanValue(cfg.Issuer))

		if cfg.TokenExpiry != "" {
			expiry, parseErr := time.Parse(time.RFC3339, cfg.TokenExpiry)
			if parseErr == nil {
				remaining := time.Until(expiry)
				expiryStr := fmt.Sprintf("%s (%s)", cfg.TokenExpiry, formatDuration(remaining))
				fmt.Printf("  Expires: %s\n", cyanValue(expiryStr))
			} else {
				fmt.Printf("  Expires: %s\n", cyanValue(cfg.TokenExpiry))
			}
		}

		return nil
	},
}

// formatDuration returns a human-friendly representation of a duration.
func formatDuration(d time.Duration) string {
	if d < 0 {
		return "expired"
	}

	minutes := int(math.Round(d.Minutes()))
	if minutes < 1 {
		return "less than a minute"
	}
	if minutes < 60 {
		return fmt.Sprintf("in %d minutes", minutes)
	}

	hours := minutes / 60
	mins := minutes % 60
	if mins == 0 {
		return fmt.Sprintf("in %d hours", hours)
	}
	return fmt.Sprintf("in %dh %dm", hours, mins)
}
