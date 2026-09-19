package maintenance

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func testCertificate(t *testing.T, domain string, expiry time.Time) ([]byte, []byte) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		t.Fatal(err)
	}

	template := &x509.Certificate{
		SerialNumber: serial,
		DNSNames:     []string{domain},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     expiry,
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}

	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}

	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}

	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded})
}

func TestCertificateValidationAndRollback(t *testing.T) {
	valid, key := testCertificate(t, "localhost", time.Now().Add(48*time.Hour))
	candidate, candidateKey := valid, key
	certificates := Certificates{
		Root:        t.TempDir(),
		Domain:      "localhost",
		Local:       true,
		MinValidity: time.Hour,
		Source:      func(context.Context) ([]byte, []byte, error) { return candidate, candidateKey, nil },
	}

	if err := certificates.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}

	previous, err := os.Readlink(filepath.Join(certificates.Root, "current"))
	if err != nil {
		t.Fatal(err)
	}

	badDomain, badDomainKey := testCertificate(t, "other.test", time.Now().Add(48*time.Hour))
	expired, expiredKey := testCertificate(t, "localhost", time.Now().Add(-time.Minute))

	for _, replacement := range [][2][]byte{{valid, badDomainKey}, {badDomain, badDomainKey}, {expired, expiredKey}, {[]byte("malformed"), key}} {
		candidate, candidateKey = replacement[0], replacement[1]

		if err := certificates.Refresh(t.Context()); err == nil {
			t.Fatal("invalid certificate accepted")
		}

		current, _ := os.Readlink(filepath.Join(certificates.Root, "current"))
		if current != previous {
			t.Fatal("invalid replacement changed active certificate")
		}
	}

	candidate, candidateKey = testCertificate(t, "localhost", time.Now().Add(72*time.Hour))
	reloads := 0
	certificates.Reload = func(string, string) error {
		reloads++

		if reloads == 1 {
			return errors.New("reload failure")
		}

		return nil
	}

	if err := certificates.Refresh(t.Context()); err == nil {
		t.Fatal("reload failure succeeded")
	}

	current, _ := os.Readlink(filepath.Join(certificates.Root, "current"))
	if current != previous || reloads != 2 || !certificates.ValidFor(time.Hour) {
		t.Fatal("working certificate was not restored")
	}

	certificates.Reload = func(string, string) error { return nil }

	if err := certificates.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}

	current, _ = os.Readlink(filepath.Join(certificates.Root, "current"))
	if current == previous {
		t.Fatal("valid rotation did not replace certificate")
	}

	if _, err := os.Stat(previous); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("superseded version was not removed")
	}
}

func TestPersistentIdentityAndFailedFence(t *testing.T) {
	env := map[string]string{"NATS_SERVER_NAME": "first", "NATS_PERSIST_SERVER_NAME": "true", "NATS_PLACEMENT_ZONE": "zone-a"}
	lookup := func(name string) string { return env[name] }
	store := t.TempDir()

	first, err := Node(lookup, store)
	if err != nil {
		t.Fatal(err)
	}

	env["NATS_SERVER_NAME"] = "replacement-container"

	second, err := Node(lookup, store)
	if err != nil || first.Name != second.Name {
		t.Fatal("persistent identity changed", err)
	}

	if err := SetFence(store, true, func(bool) error { return errors.New("reload failed") }); err == nil {
		t.Fatal("failed fence succeeded")
	}

	if _, err := os.Stat(filepath.Join(store, "scale-in-fenced")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("failed fence persisted")
	}

	if err := SetFence(store, true, func(fenced bool) error {
		if len(first.Tags(fenced)) != 0 {
			t.Fatal("fenced node advertises placement tags")
		}

		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := SetFence(store, false, func(bool) error { return errors.New("reload failed") }); err == nil {
		t.Fatal("failed unfence succeeded")
	}

	if _, err := os.Stat(filepath.Join(store, "scale-in-fenced")); err != nil {
		t.Fatal("failed unfence removed marker")
	}
}
