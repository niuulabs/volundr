package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

var tyrCmd = &cobra.Command{
	Use:   "tyr",
	Short: "Tyr saga coordinator (coming soon)",
	Long: `Tyr is a standalone saga coordinator that autonomously orchestrates
coding work by decomposing project specs into phases and raids.

This namespace is reserved for future Tyr commands.`,
	RunE: func(_ *cobra.Command, _ []string) error {
		fmt.Println("Tyr commands are coming soon.")
		fmt.Println("See https://github.com/niuulabs/volundr for updates.")
		return nil
	},
}
