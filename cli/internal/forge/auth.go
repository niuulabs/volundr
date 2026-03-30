package forge

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"strings"

	"github.com/niuulabs/volundr/cli/internal/httputil"
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

		// Admin endpoints are restricted to localhost only.
		if strings.HasPrefix(r.URL.Path, "/admin/") {
			host, _, _ := net.SplitHostPort(r.RemoteAddr)
			if host != "127.0.0.1" && host != "::1" {
				httputil.WriteJSON(w, http.StatusForbidden, map[string]string{
					"detail": "admin endpoints restricted to localhost",
				})
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		if a.mode == "none" {
			next.ServeHTTP(w, r)
			return
		}

		token := extractBearerToken(r)
		if token == "" {
			httputil.WriteError(w, http.StatusUnauthorized, "missing Authorization header")
			return
		}

		name, ok := a.validate(token)
		if !ok {
			httputil.WriteError(w, http.StatusUnauthorized, "invalid token")
			return
		}

		// Use JWT sub claim as owner_id if available, otherwise fall back
		// to the configured token name.
		ownerID := name
		if sub := extractJWTSub(token); sub != "" {
			ownerID = sub
		}
		r.Header.Set("X-Auth-User-Id", ownerID)
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

// extractJWTSub decodes a JWT token (without verification — the token is
// already validated by constant-time comparison) and returns the "sub" claim.
func extractJWTSub(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}
	sub, _ := claims["sub"].(string)
	return sub
}
