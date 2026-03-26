package forge

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

// PATAuth is middleware that validates Bearer tokens against a configured
// list of personal access tokens. If auth mode is "none", all requests pass.
type PATAuth struct {
	tokens map[string]string // token -> name
	mode   string            // "pat" or "none"
}

// NewPATAuth creates a new PAT auth middleware from config.
func NewPATAuth(cfg *AuthConfig) *PATAuth {
	tokens := make(map[string]string, len(cfg.Tokens))
	for _, t := range cfg.Tokens {
		tokens[t.Token] = t.Name
	}
	return &PATAuth{
		tokens: tokens,
		mode:   cfg.Mode,
	}
}

// Wrap returns an http.Handler that enforces PAT authentication.
func (a *PATAuth) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for health check.
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}

		if a.mode == "none" {
			next.ServeHTTP(w, r)
			return
		}

		token := extractBearerToken(r)
		if token == "" {
			writeError(w, http.StatusUnauthorized, "missing Authorization header")
			return
		}

		name, ok := a.validate(token)
		if !ok {
			writeError(w, http.StatusUnauthorized, "invalid token")
			return
		}

		// Set the token name as the user ID for downstream handlers.
		r.Header.Set("X-Auth-User-Id", name)
		next.ServeHTTP(w, r)
	})
}

// validate checks the token against all configured tokens using
// constant-time comparison to avoid timing attacks.
func (a *PATAuth) validate(token string) (string, bool) {
	for t, name := range a.tokens {
		if subtle.ConstantTimeCompare([]byte(token), []byte(t)) == 1 {
			return name, true
		}
	}
	return "", false
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ""
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
		return ""
	}
	return parts[1]
}
