package tui

import (
	"testing"
)

func TestModeString(t *testing.T) {
	t.Parallel()

	tests := []struct {
		mode Mode
		want string
	}{
		{ModeNormal, "NORMAL"},
		{ModeInsert, "INSERT"},
		{ModeSearch, "SEARCH"},
		{ModeCommand, "COMMAND"},
		{Mode(99), "NORMAL"}, // unknown mode defaults to NORMAL
	}

	for _, tt := range tests {
		got := tt.mode.String()
		if got != tt.want {
			t.Errorf("Mode(%d).String() = %q, want %q", tt.mode, got, tt.want)
		}
	}
}

func TestPageInfo(t *testing.T) {
	t.Parallel()

	if len(Pages) != PageCount {
		t.Errorf("len(Pages) = %d, want PageCount = %d", len(Pages), PageCount)
	}

	if len(PageOrder) != PageCount {
		t.Errorf("len(PageOrder) = %d, want PageCount = %d", len(PageOrder), PageCount)
	}

	// Ensure all pages in PageOrder appear in Pages map
	for _, p := range PageOrder {
		if _, ok := Pages[p]; !ok {
			t.Errorf("PageOrder contains page %d not in Pages map", p)
		}
	}
}

func TestProgramSenderSendNilProgram(t *testing.T) {
	t.Parallel()

	// Send with no program set should not panic
	s := &ProgramSender{}
	s.Send("test message") // no-op, should not panic
}

func TestProgramSenderSetProgram(t *testing.T) {
	t.Parallel()

	s := &ProgramSender{}
	// Setting nil program should not panic
	s.SetProgram(nil)
	s.Send("test") // still no-op with nil program
}

func TestKeyConstants(t *testing.T) {
	t.Parallel()

	// Verify key constants are non-empty
	keys := []string{
		KeyDown, KeyDownArrow, KeyUp, KeyUpArrow,
		KeyScrollDown, KeyScrollUp,
		KeyJumpBottom, KeyJumpTop,
		KeySearch, KeySelect, KeyRefresh,
		KeyNextFilter, KeyPrevFilter,
		KeyEscape, KeyCommandPalette,
	}
	for _, k := range keys {
		if k == "" {
			t.Errorf("key constant is empty")
		}
	}
}
