package cli

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"

	_ "github.com/lib/pq" // PostgreSQL driver

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/tyr"
)

var tyrCmd = &cobra.Command{
	Use:   "tyr",
	Short: "Manage sagas, phases, and raids (tyr-mini)",
	Long:  `Interact with tyr-mini — the lightweight saga coordinator for mini mode.`,
}

var tyrSagasCmd = &cobra.Command{
	Use:   "sagas",
	Short: "Manage sagas",
}

var tyrSagasListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all sagas",
	RunE:  runTyrSagasList,
}

var tyrRaidsCmd = &cobra.Command{
	Use:   "raids",
	Short: "Manage raids",
}

var tyrRaidsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List raids for a phase",
	RunE:  runTyrRaidsList,
}

var tyrStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show tyr-mini health status",
	RunE:  runTyrStatus,
}

var tyrPhaseIDFlag string

func init() {
	tyrRaidsListCmd.Flags().StringVar(&tyrPhaseIDFlag, "phase", "", "Phase ID to list raids for")

	tyrSagasCmd.AddCommand(tyrSagasListCmd)
	tyrRaidsCmd.AddCommand(tyrRaidsListCmd)
	tyrCmd.AddCommand(tyrSagasCmd)
	tyrCmd.AddCommand(tyrRaidsCmd)
	tyrCmd.AddCommand(tyrStatusCmd)

	rootCmd.AddCommand(tyrCmd)
}

func openTyrStore() (*tyr.Store, func(), error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, nil, fmt.Errorf("load config: %w", err)
	}

	if !cfg.TyrEnabled() {
		return nil, nil, fmt.Errorf("tyr is not enabled — run 'volundr init' and enable tyr, or set tyr.enabled: true in config")
	}

	db, err := sql.Open("postgres", cfg.DSN())
	if err != nil {
		return nil, nil, fmt.Errorf("open database: %w", err)
	}

	cleanup := func() { _ = db.Close() }

	if err := db.PingContext(context.Background()); err != nil {
		cleanup()
		return nil, nil, fmt.Errorf("ping database (is volundr running?): %w", err)
	}

	return tyr.NewStore(db), cleanup, nil
}

func runTyrSagasList(_ *cobra.Command, _ []string) error {
	store, cleanup, err := openTyrStore()
	if err != nil {
		return err
	}
	defer cleanup()

	sagas, err := store.ListSagas(context.Background())
	if err != nil {
		return fmt.Errorf("list sagas: %w", err)
	}

	if jsonOutput {
		return json.NewEncoder(os.Stdout).Encode(sagas)
	}

	if len(sagas) == 0 {
		fmt.Println("No sagas found.")
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tSTATUS\tCONFIDENCE\tBRANCH")
	for _, s := range sagas {
		fmt.Fprintf(w, "%s\t%s\t%s\t%.0f%%\t%s\n",
			s.ID, s.Name, s.Status, s.Confidence*100, s.FeatureBranch())
	}
	return w.Flush()
}

func runTyrRaidsList(_ *cobra.Command, _ []string) error {
	if tyrPhaseIDFlag == "" {
		return fmt.Errorf("--phase flag is required")
	}

	store, cleanup, err := openTyrStore()
	if err != nil {
		return err
	}
	defer cleanup()

	raids, err := store.ListRaids(context.Background(), tyrPhaseIDFlag)
	if err != nil {
		return fmt.Errorf("list raids: %w", err)
	}

	if jsonOutput {
		return json.NewEncoder(os.Stdout).Encode(raids)
	}

	if len(raids) == 0 {
		fmt.Println("No raids found.")
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tSTATUS\tCONFIDENCE\tSESSION")
	for _, r := range raids {
		sessionID := "-"
		if r.SessionID != nil {
			sessionID = *r.SessionID
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%.0f%%\t%s\n",
			r.ID, r.Name, r.Status, r.Confidence*100, sessionID)
	}
	return w.Flush()
}

func runTyrStatus(_ *cobra.Command, _ []string) error {
	store, cleanup, err := openTyrStore()
	if err != nil {
		return err
	}
	defer cleanup()

	if err := store.Ping(context.Background()); err != nil {
		fmt.Println("tyr-mini: degraded (database unreachable)")
		return nil
	}

	fmt.Println("tyr-mini: ok")
	return nil
}
