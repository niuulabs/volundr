package cli

import (
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/api"
	"github.com/niuulabs/volundr/cli/internal/remote"
)

func init() {
	sessionsCmd.AddCommand(sessionsListCmd)
	sessionsCmd.AddCommand(sessionsCreateCmd)
	sessionsCmd.AddCommand(sessionsStartCmd)
	sessionsCmd.AddCommand(sessionsStopCmd)
	sessionsCmd.AddCommand(sessionsDeleteCmd)

	// Create command flags
	sessionsCreateCmd.Flags().StringP("name", "n", "", "Session name (required)")
	sessionsCreateCmd.Flags().StringP("repo", "r", "", "Repository (e.g. org/repo)")
	sessionsCreateCmd.Flags().StringP("model", "m", "claude-sonnet-4", "AI model to use")
	sessionsCreateCmd.Flags().StringP("branch", "b", "main", "Git branch")
	_ = sessionsCreateCmd.MarkFlagRequired("name")
}

var sessionsCmd = &cobra.Command{
	Use:     "sessions",
	Aliases: []string{"s"},
	Short:   "Manage coding sessions",
	Long:    "List, create, start, stop, and delete coding sessions.",
}

var sessionsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all sessions",
	RunE: func(_ *cobra.Command, _ []string) error {
		client, err := newAPIClient()
		if err != nil {
			return err
		}

		sessions, err := client.ListSessions()
		if err != nil {
			return fmt.Errorf("listing sessions: %w", err)
		}

		if jsonOutput {
			return printJSON(sessions)
		}

		if len(sessions) == 0 {
			fmt.Println("No sessions found.")
			return nil
		}

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		_, _ = fmt.Fprintln(w, "ID\tNAME\tSTATUS\tMODEL\tREPO\tBRANCH\tTOKENS")
		for _, s := range sessions {
			_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\t%d\n",
				s.ID[:8], s.Name, s.Status, s.Model, s.Repo, s.Branch, s.TokensUsed)
		}
		return w.Flush()
	},
}

var sessionsCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new session",
	RunE: func(cmd *cobra.Command, _ []string) error {
		client, err := newAPIClient()
		if err != nil {
			return err
		}

		name, _ := cmd.Flags().GetString("name")
		repo, _ := cmd.Flags().GetString("repo")
		model, _ := cmd.Flags().GetString("model")
		branch, _ := cmd.Flags().GetString("branch")

		session, err := client.CreateSession(api.SessionCreate{
			Name:   name,
			Repo:   repo,
			Model:  model,
			Branch: branch,
		})
		if err != nil {
			return fmt.Errorf("creating session: %w", err)
		}

		if jsonOutput {
			return printJSON(session)
		}

		fmt.Printf("Session created: %s (%s)\n", session.Name, session.ID)
		return nil
	},
}

var sessionsStartCmd = &cobra.Command{
	Use:   "start <session-id>",
	Short: "Start a stopped session",
	Args:  cobra.ExactArgs(1),
	RunE: func(_ *cobra.Command, args []string) error {
		client, err := newAPIClient()
		if err != nil {
			return err
		}

		if err := client.StartSession(args[0]); err != nil {
			return fmt.Errorf("starting session: %w", err)
		}

		fmt.Printf("Session %s started.\n", args[0])
		return nil
	},
}

var sessionsStopCmd = &cobra.Command{
	Use:   "stop <session-id>",
	Short: "Stop a running session",
	Args:  cobra.ExactArgs(1),
	RunE: func(_ *cobra.Command, args []string) error {
		client, err := newAPIClient()
		if err != nil {
			return err
		}

		if err := client.StopSession(args[0]); err != nil {
			return fmt.Errorf("stopping session: %w", err)
		}

		fmt.Printf("Session %s stopped.\n", args[0])
		return nil
	},
}

var sessionsDeleteCmd = &cobra.Command{
	Use:   "delete <session-id>",
	Short: "Delete a session",
	Args:  cobra.ExactArgs(1),
	RunE: func(_ *cobra.Command, args []string) error {
		client, err := newAPIClient()
		if err != nil {
			return err
		}

		if err := client.DeleteSession(args[0]); err != nil {
			return fmt.Errorf("deleting session: %w", err)
		}

		fmt.Printf("Session %s deleted.\n", args[0])
		return nil
	},
}

// newAPIClient creates an API client from config and CLI flags, with auto-refresh support.
// It uses the --context flag (or the sole context if only one exists).
func newAPIClient() (*api.Client, error) {
	cfg, err := remote.Load()
	if err != nil {
		return nil, fmt.Errorf("loading config: %w", err)
	}

	// CLI flags override: if --server and --token are both set, use them directly.
	if cfgServer != "" && cfgToken != "" {
		return api.NewClient(cfgServer, cfgToken), nil
	}

	ctx, _, err := cfg.ResolveContext(cfgContext)
	if err != nil {
		return nil, err
	}

	server := ctx.Server
	token := ctx.Token

	if cfgServer != "" {
		server = cfgServer
	}
	if cfgToken != "" {
		token = cfgToken
	}

	return api.NewClientWithContext(server, token, ctx, cfg), nil
}
