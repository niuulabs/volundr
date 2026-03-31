// Package broker implements a lightweight WebSocket broker that bridges
// browser clients (Skuld protocol) with a Claude Code CLI process (SDK
// protocol). It can be embedded in the Forge server for mini mode or
// run as a standalone process for VM deployments.
//
// TODO(standalone): Add NewStandaloneTransport that spawns Claude CLI
// and manages its own SDK WebSocket server, enabling `niuu volundr broker`
// as a standalone command for non-k8s deployments.
package broker

// Transport abstracts CLI communication so the broker doesn't depend on
// Forge's SDKTransport directly. In embedded mode, Forge's SDKTransport
// implements this. In standalone mode, a transport that spawns and manages
// the CLI process directly would implement this.
type Transport interface {
	// SendUserMessage sends a user message to the CLI process.
	// content can be a string or an array of content blocks.
	SendUserMessage(content any, cliSessionID string) error

	// SendControlResponse sends a control_response envelope to the CLI.
	SendControlResponse(response map[string]any) error

	// CLISessionID returns the session ID reported by the CLI on init.
	CLISessionID() string
}
