package cli

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTruncate(t *testing.T) {
	tests := []struct {
		input  string
		maxLen int
		want   string
	}{
		{"hello", 10, "hello"},
		{"hello world", 5, "he..."},
		{"ab", 5, "ab"},
		{"exactly5", 8, "exactly5"},
		{"toolong", 6, "too..."},
	}
	for _, tt := range tests {
		got := truncate(tt.input, tt.maxLen)
		if got != tt.want {
			t.Errorf("truncate(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
		}
	}
}

func TestReadAll(t *testing.T) {
	data := "hello world test data"
	r := bytes.NewReader([]byte(data))
	got, err := readAll(r)
	if err != nil {
		t.Fatalf("readAll error: %v", err)
	}
	if string(got) != data {
		t.Errorf("readAll = %q, want %q", string(got), data)
	}
}

func TestReadAll_Empty(t *testing.T) {
	r := bytes.NewReader(nil)
	got, err := readAll(r)
	if err != nil {
		t.Fatalf("readAll error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty result, got %d bytes", len(got))
	}
}

func TestTyrGet_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}))
	defer server.Close()

	resp, err := tyrGet(server.URL + "/test")
	if err != nil {
		t.Fatalf("tyrGet error: %v", err)
	}
	if len(resp) == 0 {
		t.Error("expected non-empty response")
	}
}

func TestTyrGet_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("internal error"))
	}))
	defer server.Close()

	_, err := tyrGet(server.URL + "/test")
	if err == nil {
		t.Fatal("expected error for 500 response")
	}
}

func TestTyrGet_ConnectionError(t *testing.T) {
	_, err := tyrGet("http://127.0.0.1:1/nonexistent")
	if err == nil {
		t.Fatal("expected error for connection failure")
	}
}

func TestReadAll_ErrorReader(t *testing.T) {
	r := &errorReader{err: io.ErrUnexpectedEOF}
	_, err := readAll(r)
	if err == nil {
		t.Fatal("expected error from readAll")
	}
}

type errorReader struct {
	err error
}

func (r *errorReader) Read(_ []byte) (int, error) {
	return 0, r.err
}

func TestTyrCmd_HasSubcommands(t *testing.T) {
	if !tyrCmd.HasSubCommands() {
		t.Error("tyr command should have subcommands")
	}
}

func TestTyrSagasCmd_HasSubcommands(t *testing.T) {
	if !tyrSagasCmd.HasSubCommands() {
		t.Error("tyr sagas should have subcommands")
	}
}

func TestTyrRaidsCmd_HasSubcommands(t *testing.T) {
	if !tyrRaidsCmd.HasSubCommands() {
		t.Error("tyr raids should have subcommands")
	}
}
