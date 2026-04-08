package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/config"
)

// tyrHTTPTimeout is the timeout for CLI HTTP requests to the local API.
const tyrHTTPTimeout = 10 * time.Second

var tyrCmd = &cobra.Command{
	Use:   "tyr",
	Short: "Tyr saga coordinator",
	Long: `Tyr is a saga coordinator that orchestrates coding work by decomposing
project specs into phases and raids.

In mini mode, tyr-mini runs embedded in Forge. Use 'niuu volundr init' to enable it.

Subcommands:
  sagas    Manage sagas (list, get, delete)
  raids    Manage raids (list active, summary)`,
	RunE: func(cmd *cobra.Command, _ []string) error {
		return cmd.Help()
	},
}

var tyrSagasCmd = &cobra.Command{
	Use:   "sagas",
	Short: "Manage sagas",
	RunE: func(cmd *cobra.Command, _ []string) error {
		return cmd.Help()
	},
}

var tyrSagasListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all sagas",
	RunE:  runTyrSagasList,
}

var tyrRaidsCmd = &cobra.Command{
	Use:   "raids",
	Short: "Manage raids",
	RunE: func(cmd *cobra.Command, _ []string) error {
		return cmd.Help()
	},
}

var tyrRaidsSummaryCmd = &cobra.Command{
	Use:   "summary",
	Short: "Show raid counts by status",
	RunE:  runTyrRaidsSummary,
}

var tyrRaidsActiveCmd = &cobra.Command{
	Use:   "active",
	Short: "List active raids",
	RunE:  runTyrRaidsActive,
}

func init() {
	tyrSagasCmd.AddCommand(tyrSagasListCmd)
	tyrRaidsCmd.AddCommand(tyrRaidsSummaryCmd)
	tyrRaidsCmd.AddCommand(tyrRaidsActiveCmd)
	tyrCmd.AddCommand(tyrSagasCmd)
	tyrCmd.AddCommand(tyrRaidsCmd)
}

func runTyrSagasList(_ *cobra.Command, _ []string) error {
	baseURL, err := tyrBaseURL()
	if err != nil {
		return err
	}

	resp, err := tyrGet(baseURL + "/api/v1/tyr/sagas")
	if err != nil {
		return err
	}

	var sagas []struct {
		ID            string   `json:"id"`
		Name          string   `json:"name"`
		Slug          string   `json:"slug"`
		Status        string   `json:"status"`
		Repos         []string `json:"repos"`
		FeatureBranch string   `json:"feature_branch"`
		IssueCount    int      `json:"issue_count"`
	}

	if err := json.Unmarshal(resp, &sagas); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if jsonOutput {
		fmt.Println(string(resp))
		return nil
	}

	if len(sagas) == 0 {
		fmt.Println("No sagas found.")
		return nil
	}

	tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	_, _ = fmt.Fprintln(tw, "NAME\tSLUG\tSTATUS\tRAIDS\tBRANCH")
	for _, s := range sagas {
		_, _ = fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%s\n",
			s.Name, s.Slug, s.Status, s.IssueCount, s.FeatureBranch)
	}
	return tw.Flush()
}

func runTyrRaidsSummary(_ *cobra.Command, _ []string) error {
	baseURL, err := tyrBaseURL()
	if err != nil {
		return err
	}

	resp, err := tyrGet(baseURL + "/api/v1/tyr/raids/summary")
	if err != nil {
		return err
	}

	if jsonOutput {
		fmt.Println(string(resp))
		return nil
	}

	var counts map[string]int
	if err := json.Unmarshal(resp, &counts); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if len(counts) == 0 {
		fmt.Println("No raids found.")
		return nil
	}

	tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	_, _ = fmt.Fprintln(tw, "STATUS\tCOUNT")
	for status, count := range counts {
		_, _ = fmt.Fprintf(tw, "%s\t%d\n", status, count)
	}
	return tw.Flush()
}

func runTyrRaidsActive(_ *cobra.Command, _ []string) error {
	baseURL, err := tyrBaseURL()
	if err != nil {
		return err
	}

	resp, err := tyrGet(baseURL + "/api/v1/tyr/raids/active")
	if err != nil {
		return err
	}

	if jsonOutput {
		fmt.Println(string(resp))
		return nil
	}

	var raids []struct {
		TrackerID  string  `json:"tracker_id"`
		Title      string  `json:"title"`
		Status     string  `json:"status"`
		Confidence float64 `json:"confidence"`
		SessionID  *string `json:"session_id"`
	}

	if err := json.Unmarshal(resp, &raids); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if len(raids) == 0 {
		fmt.Println("No active raids.")
		return nil
	}

	tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	_, _ = fmt.Fprintln(tw, "ID\tTITLE\tSTATUS\tCONFIDENCE\tSESSION")
	for _, r := range raids {
		session := "-"
		if r.SessionID != nil {
			session = (*r.SessionID)[:8]
		}
		_, _ = fmt.Fprintf(tw, "%s\t%s\t%s\t%.0f%%\t%s\n",
			truncate(r.TrackerID, 12), truncate(r.Title, 30),
			r.Status, r.Confidence*100, session)
	}
	return tw.Flush()
}

// Helpers.

func tyrBaseURL() (string, error) {
	cfg, err := config.Load()
	if err != nil {
		return "", fmt.Errorf("load config (run 'niuu volundr init' first): %w", err)
	}
	if !cfg.Volundr.Tyr.Enabled {
		return "", fmt.Errorf("tyr-mini is not enabled; run 'niuu volundr init' to enable it")
	}
	return "http://" + cfg.Volundr.Forge.Listen, nil
}

func tyrGet(url string) ([]byte, error) {
	client := &http.Client{Timeout: tyrHTTPTimeout}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	resp, err := client.Do(req) //nolint:gosec // URL from local config
	if err != nil {
		return nil, fmt.Errorf("request failed (is 'niuu volundr up' running?): %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("server returned %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}
