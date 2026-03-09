// Package config provides encrypted credential management.
package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/crypto/pbkdf2"
)

const (
	// CredentialsFile is the name of the encrypted credentials file.
	CredentialsFile = "credentials.enc"
	// SaltSize is the size of the PBKDF2 salt in bytes.
	SaltSize = 32
	// PBKDF2Iterations is the number of iterations for key derivation.
	PBKDF2Iterations = 600000
	// KeySize is the AES-256 key size in bytes.
	KeySize = 32
	// NonceSize is the AES-GCM nonce size in bytes.
	NonceSize = 12
)

// Credentials holds decrypted secret values.
type Credentials struct {
	AnthropicAPIKey string `json:"anthropic_api_key,omitempty"`
	GithubToken     string `json:"github_token,omitempty"`
}

// CredentialsPath returns the path to the credentials file.
func CredentialsPath() (string, error) {
	dir, err := ConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, CredentialsFile), nil
}

// SaveCredentials encrypts and saves credentials to the default location.
func SaveCredentials(creds *Credentials, passphrase string) error {
	path, err := CredentialsPath()
	if err != nil {
		return err
	}
	return SaveCredentialsTo(creds, passphrase, path)
}

// SaveCredentialsTo encrypts and saves credentials to the given path.
func SaveCredentialsTo(creds *Credentials, passphrase string, path string) error {
	plaintext, err := json.Marshal(creds)
	if err != nil {
		return fmt.Errorf("marshal credentials: %w", err)
	}

	salt := make([]byte, SaltSize)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return fmt.Errorf("generate salt: %w", err)
	}

	key := deriveKey(passphrase, salt)

	block, err := aes.NewCipher(key)
	if err != nil {
		return fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return fmt.Errorf("create GCM: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return fmt.Errorf("generate nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)

	// File format: [32-byte salt][nonce + ciphertext]
	output := append(salt, ciphertext...)

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create credentials directory: %w", err)
	}

	if err := os.WriteFile(path, output, 0o600); err != nil {
		return fmt.Errorf("write credentials file: %w", err)
	}

	return nil
}

// LoadCredentials decrypts and loads credentials from the default location.
func LoadCredentials(passphrase string) (*Credentials, error) {
	path, err := CredentialsPath()
	if err != nil {
		return nil, err
	}
	return LoadCredentialsFrom(passphrase, path)
}

// LoadCredentialsFrom decrypts and loads credentials from the given path.
func LoadCredentialsFrom(passphrase string, path string) (*Credentials, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read credentials file: %w", err)
	}

	if len(data) < SaltSize+NonceSize {
		return nil, fmt.Errorf("credentials file too short")
	}

	salt := data[:SaltSize]
	ciphertext := data[SaltSize:]

	key := deriveKey(passphrase, salt)

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertextBody := ciphertext[:nonceSize], ciphertext[nonceSize:]

	plaintext, err := gcm.Open(nil, nonce, ciphertextBody, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt credentials (wrong passphrase?): %w", err)
	}

	var creds Credentials
	if err := json.Unmarshal(plaintext, &creds); err != nil {
		return nil, fmt.Errorf("parse credentials: %w", err)
	}

	return &creds, nil
}

// CredentialsExist checks if the credentials file exists.
func CredentialsExist() (bool, error) {
	path, err := CredentialsPath()
	if err != nil {
		return false, err
	}
	_, err = os.Stat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("stat credentials file: %w", err)
	}
	return true, nil
}

// deriveKey uses PBKDF2 with SHA-256 to derive an AES-256 key.
func deriveKey(passphrase string, salt []byte) []byte {
	return pbkdf2.Key([]byte(passphrase), salt, PBKDF2Iterations, KeySize, sha256.New)
}
