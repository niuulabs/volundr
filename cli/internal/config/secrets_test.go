package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCredentialsRoundTrip(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "credentials.enc")

	creds := &Credentials{ //nolint:gosec // test fixture, not real credentials
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

	creds := &Credentials{ //nolint:gosec // test fixture, not real credentials
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

func TestCredentialsPath(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(EnvHome, tmpDir)

	path, err := CredentialsPath()
	if err != nil {
		t.Fatalf("CredentialsPath() error: %v", err)
	}

	expected := filepath.Join(tmpDir, CredentialsFile)
	if path != expected {
		t.Errorf("CredentialsPath() = %q, want %q", path, expected)
	}
}

func TestSaveAndLoadCredentialsViaDefaults(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(EnvHome, tmpDir)

	creds := &Credentials{ //nolint:gosec // test fixture, not real credentials
		AnthropicAPIKey: "sk-ant-default-test",
		GithubToken:     "ghp_default_test",
	}
	passphrase := "default-passphrase"

	if err := SaveCredentials(creds, passphrase); err != nil {
		t.Fatalf("SaveCredentials() error: %v", err)
	}

	loaded, err := LoadCredentials(passphrase)
	if err != nil {
		t.Fatalf("LoadCredentials() error: %v", err)
	}

	if loaded.AnthropicAPIKey != creds.AnthropicAPIKey {
		t.Errorf("AnthropicAPIKey = %q, want %q", loaded.AnthropicAPIKey, creds.AnthropicAPIKey)
	}
	if loaded.GithubToken != creds.GithubToken {
		t.Errorf("GithubToken = %q, want %q", loaded.GithubToken, creds.GithubToken)
	}
}

func TestCredentialsExist(t *testing.T) {
	t.Run("returns false when credentials do not exist", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv(EnvHome, tmpDir)

		exists, err := CredentialsExist()
		if err != nil {
			t.Fatalf("CredentialsExist() error: %v", err)
		}
		if exists {
			t.Error("CredentialsExist() = true, want false")
		}
	})

	t.Run("returns true when credentials exist", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv(EnvHome, tmpDir)

		creds := &Credentials{AnthropicAPIKey: "test"} //nolint:gosec // test fixture
		if err := SaveCredentials(creds, "pass"); err != nil {
			t.Fatalf("SaveCredentials() error: %v", err)
		}

		exists, err := CredentialsExist()
		if err != nil {
			t.Fatalf("CredentialsExist() error: %v", err)
		}
		if !exists {
			t.Error("CredentialsExist() = false, want true")
		}
	})
}

func TestCredentialsFilePermissions(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "credentials.enc")

	creds := &Credentials{AnthropicAPIKey: "test"} //nolint:gosec // test fixture
	if err := SaveCredentialsTo(creds, "pass", path); err != nil {
		t.Fatalf("SaveCredentialsTo() error: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat() error: %v", err)
	}

	perm := info.Mode().Perm()
	if perm != 0o600 {
		t.Errorf("expected file permissions 0600, got %o", perm)
	}
}

func TestCredentialsPathErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv("HOME", "")

	_, err := CredentialsPath()
	if err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestSaveCredentialsErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv("HOME", "")

	creds := &Credentials{AnthropicAPIKey: "test"} //nolint:gosec // test fixture
	if err := SaveCredentials(creds, "pass"); err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestLoadCredentialsErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv("HOME", "")

	_, err := LoadCredentials("pass")
	if err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestCredentialsExistErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv("HOME", "")

	_, err := CredentialsExist()
	if err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestSaveCredentialsToReadOnlyDir(t *testing.T) {
	tmpDir := t.TempDir()
	readOnly := filepath.Join(tmpDir, "readonly")
	if err := os.Mkdir(readOnly, 0o500); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(readOnly, 0o700) }) //nolint:gosec // restoring permissions for cleanup

	creds := &Credentials{AnthropicAPIKey: "test"} //nolint:gosec // test fixture
	nested := filepath.Join(readOnly, "sub", "credentials.enc")
	if err := SaveCredentialsTo(creds, "pass", nested); err == nil {
		t.Error("expected error saving to read-only directory")
	}
}

func TestLoadCredentialsFromCorruptedCiphertext(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "credentials.enc")

	creds := &Credentials{AnthropicAPIKey: "test"} //nolint:gosec // test fixture
	if err := SaveCredentialsTo(creds, "pass", path); err != nil {
		t.Fatalf("SaveCredentialsTo() error: %v", err)
	}

	// Corrupt the ciphertext (after the salt) to trigger GCM decryption error.
	data, err := os.ReadFile(path) //nolint:gosec // test file path
	if err != nil {
		t.Fatalf("ReadFile() error: %v", err)
	}
	// Flip bytes in ciphertext area.
	for i := SaltSize; i < len(data); i++ {
		data[i] ^= 0xFF
	}
	if err := os.WriteFile(path, data, 0o600); err != nil { //nolint:gosec // test file path
		t.Fatalf("WriteFile() error: %v", err)
	}

	_, err = LoadCredentialsFrom("pass", path)
	if err == nil {
		t.Error("expected error for corrupted ciphertext")
	}
}

func TestSaveCredentialsToCreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	nested := filepath.Join(tmpDir, "a", "b", "credentials.enc")

	creds := &Credentials{AnthropicAPIKey: "test"} //nolint:gosec // test fixture
	if err := SaveCredentialsTo(creds, "pass", nested); err != nil {
		t.Fatalf("SaveCredentialsTo() error: %v", err)
	}

	if _, err := os.Stat(nested); err != nil {
		t.Errorf("expected file to exist at %s", nested)
	}
}
