package cli

import (
	"encoding/json"
	"fmt"
	"os"
)

// jsonOutput is the global --json flag.
var jsonOutput bool

// printJSON marshals v as indented JSON to stdout.
func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return fmt.Errorf("encoding JSON: %w", err)
	}
	return nil
}
