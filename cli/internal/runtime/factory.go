package runtime

// NewRuntime creates a Runtime for the given runtime type.
// Valid types: "local" (default), "docker", "k3s".
func NewRuntime(runtimeType string) Runtime {
	switch runtimeType {
	case "docker":
		return NewDockerRuntime()
	case "k3s":
		// k3s not yet implemented
		return NewLocalRuntime() // fallback for now
	default:
		return NewLocalRuntime()
	}
}
