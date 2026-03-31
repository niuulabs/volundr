package broker

import (
	"testing"
)

func TestTranslatePermissionResponse_FullFields(t *testing.T) {
	msg := map[string]any{
		"type":                "permission_response",
		"request_id":         "req-123",
		"behavior":           "allow",
		"updated_input":      map[string]any{"key": "val"},
		"updated_permissions": []any{"read", "write"},
	}

	got := translatePermissionResponse(msg)

	if got["subtype"] != "success" {
		t.Errorf("subtype = %v, want success", got["subtype"])
	}
	if got["request_id"] != "req-123" {
		t.Errorf("request_id = %v, want req-123", got["request_id"])
	}

	resp, ok := got["response"].(map[string]any)
	if !ok {
		t.Fatal("response is not map[string]any")
	}
	if resp["behavior"] != "allow" {
		t.Errorf("behavior = %v, want allow", resp["behavior"])
	}
	if resp["updatedInput"] == nil {
		t.Error("updatedInput should not be nil")
	}
	if resp["updatedPermissions"] == nil {
		t.Error("updatedPermissions should not be nil")
	}
}

func TestTranslatePermissionResponse_NilDefaults(t *testing.T) {
	msg := map[string]any{
		"type":       "permission_response",
		"request_id": "req-456",
		"behavior":   "deny",
	}

	got := translatePermissionResponse(msg)
	resp := got["response"].(map[string]any)

	// Should default to empty map and empty slice.
	if resp["updatedInput"] == nil {
		t.Error("updatedInput should default to empty map, not nil")
	}
	if resp["updatedPermissions"] == nil {
		t.Error("updatedPermissions should default to empty slice, not nil")
	}
}

func TestTranslatePermissionResponse_MissingFields(t *testing.T) {
	msg := map[string]any{}

	got := translatePermissionResponse(msg)

	if got["request_id"] != "" {
		t.Errorf("request_id = %v, want empty string", got["request_id"])
	}

	resp := got["response"].(map[string]any)
	if resp["behavior"] != "" {
		t.Errorf("behavior = %v, want empty string", resp["behavior"])
	}
}

func TestTranslateControlMessage_Interrupt(t *testing.T) {
	msg := map[string]any{}
	got := translateControlMessage("interrupt", msg)

	if got["subtype"] != "interrupt" {
		t.Errorf("subtype = %v, want interrupt", got["subtype"])
	}
	if got["request_id"] == "" {
		t.Error("request_id should be a generated UUID")
	}
}

func TestTranslateControlMessage_SetModel(t *testing.T) {
	msg := map[string]any{"model": "claude-opus-4-20250514"}
	got := translateControlMessage("set_model", msg)

	if got["subtype"] != "set_model" {
		t.Errorf("subtype = %v, want set_model", got["subtype"])
	}
	if got["model"] != "claude-opus-4-20250514" {
		t.Errorf("model = %v, want claude-opus-4-20250514", got["model"])
	}
}

func TestTranslateControlMessage_SetMaxThinkingTokens(t *testing.T) {
	msg := map[string]any{"max_thinking_tokens": float64(8192)}
	got := translateControlMessage("set_max_thinking_tokens", msg)

	if got["subtype"] != "set_max_thinking_tokens" {
		t.Errorf("subtype = %v, want set_max_thinking_tokens", got["subtype"])
	}
	if got["max_thinking_tokens"] != float64(8192) {
		t.Errorf("max_thinking_tokens = %v, want 8192", got["max_thinking_tokens"])
	}
}

func TestTranslateControlMessage_SetPermissionMode(t *testing.T) {
	msg := map[string]any{"mode": "auto"}
	got := translateControlMessage("set_permission_mode", msg)

	if got["subtype"] != "set_permission_mode" {
		t.Errorf("subtype = %v, want set_permission_mode", got["subtype"])
	}
	if got["mode"] != "auto" {
		t.Errorf("mode = %v, want auto", got["mode"])
	}
}

func TestTranslateControlMessage_MCPSetServers(t *testing.T) {
	servers := []any{map[string]any{"name": "s1"}}
	msg := map[string]any{"servers": servers}
	got := translateControlMessage("mcp_set_servers", msg)

	if got["subtype"] != "mcp_set_servers" {
		t.Errorf("subtype = %v, want mcp_set_servers", got["subtype"])
	}
	if got["servers"] == nil {
		t.Error("servers should not be nil")
	}
}

func TestTranslateControlMessage_RewindFiles(t *testing.T) {
	msg := map[string]any{"files": []any{"a.txt"}}
	got := translateControlMessage("rewind_files", msg)

	if got["subtype"] != "rewind_files" {
		t.Errorf("subtype = %v, want rewind_files", got["subtype"])
	}
}

func TestFilterCLIEvent_DropsKeepAlive(t *testing.T) {
	data := map[string]any{"type": "keep_alive"}
	if filterCLIEvent(data) {
		t.Error("keep_alive should be filtered out")
	}
}

func TestFilterCLIEvent_DropsEmptyContentBlockDelta(t *testing.T) {
	tests := []struct {
		name string
		data map[string]any
		want bool
	}{
		{
			name: "no delta key",
			data: map[string]any{"type": "content_block_delta"},
			want: false,
		},
		{
			name: "empty delta",
			data: map[string]any{
				"type":  "content_block_delta",
				"delta": map[string]any{},
			},
			want: false,
		},
		{
			name: "empty strings",
			data: map[string]any{
				"type":  "content_block_delta",
				"delta": map[string]any{"text": "", "thinking": "", "partial_json": ""},
			},
			want: false,
		},
		{
			name: "has text",
			data: map[string]any{
				"type":  "content_block_delta",
				"delta": map[string]any{"text": "hello"},
			},
			want: true,
		},
		{
			name: "has thinking",
			data: map[string]any{
				"type":  "content_block_delta",
				"delta": map[string]any{"thinking": "hmm"},
			},
			want: true,
		},
		{
			name: "has partial_json",
			data: map[string]any{
				"type":  "content_block_delta",
				"delta": map[string]any{"partial_json": "{"},
			},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := filterCLIEvent(tt.data); got != tt.want {
				t.Errorf("filterCLIEvent() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestFilterCLIEvent_PassesOtherEvents(t *testing.T) {
	events := []map[string]any{
		{"type": "assistant"},
		{"type": "result"},
		{"type": "user"},
		{"type": "system"},
		{"type": "content_block_start"},
	}

	for _, ev := range events {
		if !filterCLIEvent(ev) {
			t.Errorf("event type %q should pass filter", ev["type"])
		}
	}
}

func TestFilterCLIEvent_NoType(t *testing.T) {
	data := map[string]any{"foo": "bar"}
	if !filterCLIEvent(data) {
		t.Error("event with no type should pass filter")
	}
}
