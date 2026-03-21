package cli

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/remote"
)

func init() {
	configCmd.AddCommand(configGetCmd)
	configCmd.AddCommand(configSetCmd)
}

var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Manage CLI configuration",
	Long: `Manage CLI configuration stored in ~/.config/niuu/config.yaml.

Global keys: theme
Context keys (require --context): server, token, issuer, client-id`,
}

var configGetCmd = &cobra.Command{
	Use:   "get <key>",
	Short: "Get a configuration value",
	Args:  cobra.ExactArgs(1),
	RunE: func(_ *cobra.Command, args []string) error {
		cfg, err := remote.Load()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}

		key := args[0]

		// Global keys.
		if key == "theme" {
			fmt.Println(cfg.Theme)
			return nil
		}

		// Context-scoped keys.
		ctx, _, err := cfg.ResolveContext(cfgContext)
		if err != nil {
			return err
		}

		value, err := getContextValue(ctx, key)
		if err != nil {
			return err
		}

		fmt.Println(value)
		return nil
	},
}

var configSetCmd = &cobra.Command{
	Use:   "set <key> <value>",
	Short: "Set a configuration value",
	Args:  cobra.ExactArgs(2),
	RunE: func(_ *cobra.Command, args []string) error {
		cfg, err := remote.Load()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}

		key := args[0]
		value := args[1]

		// Global keys.
		if key == "theme" {
			cfg.Theme = value
			if err := cfg.Save(); err != nil {
				return fmt.Errorf("saving config: %w", err)
			}
			fmt.Printf("Set %s = %s\n", key, value)
			return nil
		}

		// Context-scoped keys.
		ctx, _, err := cfg.ResolveContext(cfgContext)
		if err != nil {
			return err
		}

		if err := setContextValue(ctx, key, value); err != nil {
			return err
		}

		if err := cfg.Save(); err != nil {
			return fmt.Errorf("saving config: %w", err)
		}

		fmt.Printf("Set %s = %s\n", key, value)
		return nil
	},
}

func getContextValue(ctx *remote.Context, key string) (string, error) {
	switch key {
	case "server":
		return ctx.Server, nil
	case "token":
		return ctx.Token, nil
	case "refresh_token":
		return ctx.RefreshToken, nil
	case "token_expiry":
		return ctx.TokenExpiry, nil
	case "issuer":
		return ctx.Issuer, nil
	case "client_id", "client-id":
		return ctx.ClientID, nil
	default:
		return "", fmt.Errorf("unknown config key: %s (valid keys: theme, server, token, refresh_token, token_expiry, issuer, client-id)", key)
	}
}

func setContextValue(ctx *remote.Context, key, value string) error {
	switch key {
	case "server":
		ctx.Server = value
	case "token":
		ctx.Token = value
	case "refresh_token":
		ctx.RefreshToken = value
	case "token_expiry":
		ctx.TokenExpiry = value
	case "issuer":
		ctx.Issuer = value
	case "client_id", "client-id":
		ctx.ClientID = value
	default:
		return fmt.Errorf("unknown config key: %s (valid keys: theme, server, token, refresh_token, token_expiry, issuer, client-id)", key)
	}
	return nil
}
