package cli

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/runtime"
)

const (
	// shutdownRequestTimeout is how long to wait for the forge shutdown
	// HTTP request to complete.
	shutdownRequestTimeout = 5 * time.Second
	// shutdownSettleDelay is a short pause after requesting shutdown to
	// let the server finish stopping sessions.
	shutdownSettleDelay = 2 * time.Second
)

var downCmd = &cobra.Command{
	Use:   "down",
	Short: "Stop the Volundr stack",
	Long:  `Gracefully stops all running Volundr services.`,
	RunE:  runDown,
}

func runDown(_ *cobra.Command, _ []string) error {
	fmt.Println("Stopping Volundr...")

	cfg, err := config.Load()
	if err != nil {
		// Config not loadable — fall back to PID-based shutdown.
		return fallbackPIDShutdown()
	}

	switch cfg.Volundr.Mode {
	case "mini":
		return downMini(cfg)
	case "k3s":
		return downK3s()
	default:
		return fallbackPIDShutdown()
	}
}

// downMini shuts down the forge server by calling its admin shutdown endpoint.
// If the HTTP request fails (server not running), it falls back to PID-based kill.
func downMini(cfg *config.Config) error {
	host, port, err := net.SplitHostPort(cfg.Volundr.Forge.Listen)
	if err != nil {
		return fallbackPIDShutdown()
	}

	url := fmt.Sprintf("http://%s:%s/admin/shutdown", host, port)

	client := &http.Client{Timeout: shutdownRequestTimeout}
	resp, err := client.Post(url, "application/json", http.NoBody) //nolint:noctx // one-shot shutdown request
	if err != nil {
		fmt.Println("Forge server not reachable, trying PID-based shutdown...")
		return fallbackPIDShutdown()
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		fmt.Printf("Unexpected response %d, trying PID-based shutdown...\n", resp.StatusCode)
		return fallbackPIDShutdown()
	}

	// Give the server time to stop sessions and shut down.
	time.Sleep(shutdownSettleDelay)

	cleanupStateFiles()
	fmt.Println("Stopped.")
	return nil
}

// downK3s shuts down the k3s runtime.
func downK3s() error {
	rt := runtime.NewRuntime("k3s")
	if err := rt.Down(context.Background()); err != nil {
		return fmt.Errorf("stop: %w", err)
	}

	fmt.Println("Stopped.")
	return nil
}

// fallbackPIDShutdown uses the PID file to send SIGTERM as a last resort.
func fallbackPIDShutdown() error {
	if err := runtime.DownFromPID(); err != nil {
		return fmt.Errorf("stop: %w", err)
	}

	cleanupStateFiles()
	fmt.Println("Stopped.")
	return nil
}

// cleanupStateFiles removes forge state and PID files if they exist.
func cleanupStateFiles() {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return
	}

	for _, name := range []string{"forge-state.json", runtime.PIDFile} {
		path := cfgDir + "/" + name
		if _, statErr := os.Stat(path); statErr == nil {
			_ = os.Remove(path)
		}
	}
}
