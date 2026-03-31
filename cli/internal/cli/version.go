package cli

import (
	"fmt"
	"runtime"

	"charm.land/lipgloss/v2"
	"github.com/spf13/cobra"

	tuipkg "github.com/niuulabs/volundr/cli/internal/tui"
)

// These variables are set at build time via ldflags.
var (
	version = "dev"
	commit  = "unknown"
	date    = "unknown"
)

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Show version information",
	RunE: func(_ *cobra.Command, _ []string) error {
		if jsonOutput {
			return printJSON(map[string]string{
				"version": version,
				"commit":  commit,
				"built":   date,
				"go":      runtime.Version(),
				"os":      runtime.GOOS,
				"arch":    runtime.GOARCH,
			})
		}

		theme := tuipkg.DefaultTheme

		hammerStyle := lipgloss.NewStyle().
			Foreground(theme.AccentCyan)

		titleStyle := lipgloss.NewStyle().
			Foreground(theme.AccentCyan).
			Bold(true)

		versionStyle := lipgloss.NewStyle().
			Foreground(theme.TextSecondary)

		taglineStyle := lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Italic(true)

		fmt.Println(hammerStyle.Render(tuipkg.HammerLogo))
		fmt.Println(titleStyle.Render("  niuu — The Development Platform"))
		fmt.Println(versionStyle.Render(fmt.Sprintf("  Version: %s", version)))
		fmt.Println(taglineStyle.Render("  \"Tools of the gods\""))
		fmt.Println()
		fmt.Printf("  commit:  %s\n", commit)
		fmt.Printf("  built:   %s\n", date)
		fmt.Printf("  go:      %s\n", runtime.Version())
		fmt.Printf("  os/arch: %s/%s\n", runtime.GOOS, runtime.GOARCH)
		return nil
	},
}
