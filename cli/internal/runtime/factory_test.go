package runtime

import (
	"testing"
)

func TestNewRuntime_Local(t *testing.T) {
	rt := NewRuntime("local")
	if _, ok := rt.(*LocalRuntime); !ok {
		t.Errorf("expected *LocalRuntime, got %T", rt)
	}
}

func TestNewRuntime_Default(t *testing.T) {
	rt := NewRuntime("")
	if _, ok := rt.(*LocalRuntime); !ok {
		t.Errorf("expected *LocalRuntime for empty string, got %T", rt)
	}
}

func TestNewRuntime_Unknown(t *testing.T) {
	rt := NewRuntime("unknown")
	if _, ok := rt.(*LocalRuntime); !ok {
		t.Errorf("expected *LocalRuntime for unknown type, got %T", rt)
	}
}
