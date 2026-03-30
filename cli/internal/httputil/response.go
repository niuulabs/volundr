// Package httputil provides shared HTTP response helpers.
package httputil

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// WriteJSON encodes v as JSON and writes it to w with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError writes a JSON error response with {"detail": message}.
func WriteError(w http.ResponseWriter, status int, format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	WriteJSON(w, status, map[string]string{"detail": msg})
}
