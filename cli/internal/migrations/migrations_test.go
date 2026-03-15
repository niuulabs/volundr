package migrations

import "testing"

func TestFS_WithoutEmbedTag(t *testing.T) {
	// Without the embed_migrations build tag, FS() returns nil.
	if got := FS(); got != nil {
		t.Errorf("FS() = %v, want nil (no embed_migrations tag)", got)
	}
}
