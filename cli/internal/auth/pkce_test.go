package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func TestGenerateCodeVerifier(t *testing.T) {
	t.Run("returns valid base64url string", func(t *testing.T) {
		verifier, err := GenerateCodeVerifier()
		if err != nil {
			t.Fatalf("GenerateCodeVerifier: %v", err)
		}
		if verifier == "" {
			t.Fatal("expected non-empty verifier")
		}

		// RFC 7636 requires 43-128 characters.
		if len(verifier) < 43 || len(verifier) > 128 {
			t.Errorf("verifier length %d outside 43-128 range", len(verifier))
		}

		// Should be valid base64url (no padding).
		_, err = base64.RawURLEncoding.DecodeString(verifier)
		if err != nil {
			t.Errorf("verifier is not valid base64url: %v", err)
		}
	})

	t.Run("returns unique values", func(t *testing.T) {
		v1, err := GenerateCodeVerifier()
		if err != nil {
			t.Fatalf("GenerateCodeVerifier: %v", err)
		}
		v2, err := GenerateCodeVerifier()
		if err != nil {
			t.Fatalf("GenerateCodeVerifier: %v", err)
		}
		if v1 == v2 {
			t.Error("expected unique verifiers, got identical values")
		}
	})
}

func TestCodeChallenge(t *testing.T) {
	t.Run("computes S256 correctly", func(t *testing.T) {
		verifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
		got := CodeChallenge(verifier)

		// Manually compute expected: SHA256(verifier) -> base64url.
		h := sha256.Sum256([]byte(verifier))
		want := base64.RawURLEncoding.EncodeToString(h[:])

		if got != want {
			t.Errorf("expected challenge %q, got %q", want, got)
		}
	})

	t.Run("different verifiers produce different challenges", func(t *testing.T) {
		c1 := CodeChallenge("verifier-one")
		c2 := CodeChallenge("verifier-two")
		if c1 == c2 {
			t.Error("expected different challenges for different verifiers")
		}
	})

	t.Run("deterministic for same input", func(t *testing.T) {
		c1 := CodeChallenge("same-verifier")
		c2 := CodeChallenge("same-verifier")
		if c1 != c2 {
			t.Error("expected same challenge for same verifier")
		}
	})

	t.Run("result is valid base64url without padding", func(t *testing.T) {
		challenge := CodeChallenge("test-verifier")
		_, err := base64.RawURLEncoding.DecodeString(challenge)
		if err != nil {
			t.Errorf("challenge is not valid base64url: %v", err)
		}
	})
}
