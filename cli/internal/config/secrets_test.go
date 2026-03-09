package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCredentialsRoundTrip(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "credentials.enc")

	creds := &Credentials{
		AnthropicAPIKey: "sk-ant-test-key-12345",
		GithubToken:     "ghp_test_token_67890",
	}

	passphrase := "test-passphrase"

	if err := SaveCredentialsTo(creds, passphrase, path); err != nil {
		t.Fatalf("SaveCredentialsTo() error: %v", err)
	}

	loaded, err := LoadCredentialsFrom(passphrase, path)
	if err != nil {
		t.Fatalf("LoadCredentialsFrom() error: %v", err)
	}

	if loaded.AnthropicAPIKey != creds.AnthropicAPIKey {
		t.Errorf("AnthropicAPIKey: expected %q, got %q",
			creds.AnthropicAPIKey, loaded.AnthropicAPIKey)
	}
	if loaded.GithubToken != creds.GithubToken {
		t.Errorf("GithubToken: expected %q, got %q",
			creds.GithubToken, loaded.GithubToken)
	}
}

func TestCredentialsWrongPassphrase(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "credentials.enc")

	creds := &Credentials{
		AnthropicAPIKey: "sk-ant-secret",
	}

	if err := SaveCredentialsTo(creds, "correct-passphrase", path); err != nil {
		t.Fatalf("SaveCredentialsTo() error: %v", err)
	}

	_, err := LoadCredentialsFrom("wrong-passphrase", path)
	if err == nil {
		t.Error("expected error with wrong passphrase")
	}
}

func TestCredentialsEmptyFields(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "credentials.enc")

	creds := &Credentials{}
	passphrase := "test"

	if err := SaveCredentialsTo(creds, passphrase, path); err != nil {
		t.Fatalf("SaveCredentialsTo() error: %v", err)
	}

	loaded, err := LoadCredentialsFrom(passphrase, path)
	if err != nil {
		t.Fatalf("LoadCredentialsFrom() error: %v", err)
	}

	if loaded.AnthropicAPIKey != "" {
		t.Errorf("expected empty AnthropicAPIKey, got %q", loaded.AnthropicAPIKey)
	}
	if loaded.GithubToken != "" {
		t.Errorf("expected empty GithubToken, got %q", loaded.GithubToken)
	}
}

func TestCredentialsNonExistentFile(t *testing.T) {
	_, err := LoadCredentialsFrom("passphrase", "/nonexistent/credentials.enc")
	if err == nil {
		t.Error("expected error for non-existent file")
	}
}

func TestCredentialsTruncatedFile(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "credentials.enc")

	// Write a file that is too short.
	if err := os.WriteFile(path, []byte("short"), 0o600); err != nil {
		t.Fatalf("write test file: %v", err)
	}

	_, err := LoadCredentialsFrom("passphrase", path)
	if err == nil {
		t.Error("expected error for truncated file")
	}
}

func TestDeriveKeyDeterministic(t *testing.T) {
	salt := []byte("test-salt-32-bytes-long-padding!!")
	k1 := deriveKey("passphrase", salt)
	k2 := deriveKey("passphrase", salt)

	if len(k1) != KeySize {
		t.Errorf("expected key size %d, got %d", KeySize, len(k1))
	}

	for i := range k1 {
		if k1[i] != k2[i] {
			t.Error("expected deterministic key derivation")
			break
		}
	}
}

func TestDeriveKeyDifferentPassphrases(t *testing.T) {
	salt := []byte("test-salt-32-bytes-long-padding!!")
	k1 := deriveKey("passphrase1", salt)
	k2 := deriveKey("passphrase2", salt)

	same := true
	for i := range k1 {
		if k1[i] != k2[i] {
			same = false
			break
		}
	}
	if same {
		t.Error("expected different keys for different passphrases")
	}
}
