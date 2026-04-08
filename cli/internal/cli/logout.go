package cli

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/remote"
)

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Clear stored authentication tokens",
	Long:  "Remove access token, refresh token, and token expiry from the local config file.",
	RunE: func(_ *cobra.Command, _ []string) error {
		cfg, err := remote.Load()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}

		_, ctxKey, err := cfg.ResolveContext(cfgContext)
		if err != nil {
			return err
		}

		if err := cfg.ClearTokens(ctxKey); err != nil {
			return err
		}

		if err := cfg.Save(); err != nil {
			return fmt.Errorf("saving config: %w", err)
		}

		fmt.Printf("%s Logged out from context %q. Tokens cleared.\n", successMark, ctxKey)
		return nil
	},
}
