package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/remote"
)

var (
	contextAddServer   string
	contextAddName     string
	contextAddIssuer   string
	contextAddClientID string
	contextListJSON    bool
)

func init() {
	contextAddCmd.Flags().StringVar(&contextAddServer, "server", "", "Volundr server URL (required)")
	contextAddCmd.Flags().StringVar(&contextAddName, "name", "", "Display name for the context")
	contextAddCmd.Flags().StringVar(&contextAddIssuer, "issuer", "", "OIDC issuer URL")
	contextAddCmd.Flags().StringVar(&contextAddClientID, "client-id", "", "OIDC client ID")
	_ = contextAddCmd.MarkFlagRequired("server")

	contextListCmd.Flags().BoolVar(&contextListJSON, "json", false, "Output in JSON format")

	contextCmd.AddCommand(contextAddCmd)
	contextCmd.AddCommand(contextListCmd)
	contextCmd.AddCommand(contextRemoveCmd)
	contextCmd.AddCommand(contextRenameCmd)
}

var contextCmd = &cobra.Command{
	Use:   "context",
	Short: "Manage cluster contexts",
	Long:  "Add, list, remove, and rename Volundr cluster contexts.",
}

var contextAddCmd = &cobra.Command{
	Use:   "add <key> --server <url>",
	Short: "Add a new cluster context",
	Long: `Add a new cluster context with the given key and server URL.

Example:
  volundr context add prod --server https://volundr.prod.example.com --name "Production"
  volundr context add local --server http://127.0.0.1:8080`,
	Args: cobra.ExactArgs(1),
	RunE: func(_ *cobra.Command, args []string) error {
		cfg, err := remote.Load()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}

		key := args[0]
		name := contextAddName
		if name == "" {
			name = key
		}

		ctx := &remote.Context{
			Name:     name,
			Server:   contextAddServer,
			Issuer:   contextAddIssuer,
			ClientID: contextAddClientID,
		}

		if err := cfg.AddContext(key, ctx); err != nil {
			return err
		}

		if err := cfg.Save(); err != nil {
			return fmt.Errorf("saving config: %w", err)
		}

		fmt.Printf("Added context %q (server: %s)\n", key, contextAddServer)
		return nil
	},
}

// contextListEntry is used for JSON output of context list.
type contextListEntry struct {
	Key           string `json:"key"`
	Name          string `json:"name"`
	Server        string `json:"server"`
	Authenticated bool   `json:"authenticated"`
}

var contextListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all cluster contexts",
	RunE: func(_ *cobra.Command, _ []string) error {
		cfg, err := remote.Load()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}

		if len(cfg.Contexts) == 0 {
			fmt.Println("No contexts configured. Add one with: volundr context add <name> --server <url>")
			return nil
		}

		if contextListJSON {
			return contextListAsJSON(cfg)
		}

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		_, _ = fmt.Fprintln(w, "KEY\tNAME\tSERVER\tAUTH")
		for key, ctx := range cfg.Contexts {
			authStatus := "no"
			if ctx.Token != "" {
				authStatus = "yes"
			}
			_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", key, ctx.Name, ctx.Server, authStatus)
		}
		return w.Flush()
	},
}

func contextListAsJSON(cfg *remote.Config) error {
	entries := make([]contextListEntry, 0, len(cfg.Contexts))
	for key, ctx := range cfg.Contexts {
		entries = append(entries, contextListEntry{
			Key:           key,
			Name:          ctx.Name,
			Server:        ctx.Server,
			Authenticated: ctx.Token != "",
		})
	}

	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling JSON: %w", err)
	}

	fmt.Println(string(data))
	return nil
}

var contextRemoveCmd = &cobra.Command{
	Use:   "remove <key>",
	Short: "Remove a cluster context",
	Args:  cobra.ExactArgs(1),
	RunE: func(_ *cobra.Command, args []string) error {
		cfg, err := remote.Load()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}

		key := args[0]
		if err := cfg.RemoveContext(key); err != nil {
			return err
		}

		if err := cfg.Save(); err != nil {
			return fmt.Errorf("saving config: %w", err)
		}

		fmt.Printf("Removed context %q\n", key)
		return nil
	},
}

var contextRenameCmd = &cobra.Command{
	Use:   "rename <old-key> <new-key>",
	Short: "Rename a cluster context",
	Args:  cobra.ExactArgs(2),
	RunE: func(_ *cobra.Command, args []string) error {
		cfg, err := remote.Load()
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}

		if err := cfg.RenameContext(args[0], args[1]); err != nil {
			return err
		}

		if err := cfg.Save(); err != nil {
			return fmt.Errorf("saving config: %w", err)
		}

		fmt.Printf("Renamed context %q to %q\n", args[0], args[1])
		return nil
	},
}
