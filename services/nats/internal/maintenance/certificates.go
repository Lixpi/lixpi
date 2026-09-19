package maintenance

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type CertificateSource func(context.Context) ([]byte, []byte, error)

type Certificates struct {
	Root         string
	Domain       string
	Local        bool
	Roots        *x509.CertPool
	MinValidity  time.Duration
	Source       CertificateSource
	Reload       func(string, string) error
	VerifyServed func(context.Context, [32]byte) error
	mu           sync.Mutex
	active       *x509.Certificate
}

func (c *Certificates) Refresh(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	certificate, key, err := c.Source(ctx)
	if err != nil {
		return err
	}

	pair, err := tls.X509KeyPair(certificate, key)
	if err != nil {
		return errors.New("invalid TLS certificate/key pair")
	}

	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return errors.New("invalid TLS leaf certificate")
	}

	now := time.Now()
	if now.Before(leaf.NotBefore) || leaf.NotAfter.Before(now.Add(c.MinValidity)) {
		return errors.New("TLS certificate outside required validity window")
	}

	if err := leaf.VerifyHostname(c.Domain); err != nil {
		return errors.New("TLS certificate hostname mismatch")
	}

	if !c.Local || c.Roots != nil {
		intermediates := x509.NewCertPool()

		for _, der := range pair.Certificate[1:] {
			cert, err := x509.ParseCertificate(der)
			if err != nil {
				return err
			}

			intermediates.AddCert(cert)
		}

		if _, err := leaf.Verify(
			x509.VerifyOptions{
				DNSName:       c.Domain,
				Roots:         c.Roots,
				Intermediates: intermediates,
				KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
			},
		); err != nil {
			return errors.New("untrusted TLS certificate chain")
		}
	}

	if err := os.MkdirAll(c.Root, 0o700); err != nil {
		return err
	}

	current := filepath.Join(c.Root, "current")
	previous, _ := os.Readlink(current)
	oldCert, _ := os.ReadFile(filepath.Join(current, "server.crt"))
	oldKey, _ := os.ReadFile(filepath.Join(current, "server.key"))
	fingerprint := sha256.Sum256(leaf.Raw)

	if bytes.Equal(oldCert, certificate) && bytes.Equal(oldKey, key) {
		c.active = leaf

		if c.VerifyServed != nil {
			return c.VerifyServed(ctx, fingerprint)
		}

		return nil
	}

	version, err := os.MkdirTemp(c.Root, "version.")
	if err != nil {
		return err
	}

	installed := false
	defer func() {
		if !installed {
			_ = os.RemoveAll(version)
		}
	}()

	if err := os.WriteFile(filepath.Join(version, "server.crt"), certificate, 0o600); err != nil {
		return err
	}

	if err := os.WriteFile(filepath.Join(version, "server.key"), key, 0o600); err != nil {
		return err
	}

	switchTo := func(target string) error {
		next := filepath.Join(c.Root, "next")
		_ = os.Remove(next)

		if err := os.Symlink(target, next); err != nil {
			return err
		}

		return os.Rename(next, current)
	}

	if err := switchTo(version); err != nil {
		return err
	}

	certPath, keyPath := filepath.Join(current, "server.crt"), filepath.Join(current, "server.key")

	if c.Reload != nil {
		err = c.Reload(certPath, keyPath)
	}

	if err == nil && c.VerifyServed != nil {
		err = c.VerifyServed(ctx, fingerprint)
	}

	if err != nil {
		if previous != "" {
			rollback := switchTo(previous)
			if rollback == nil && c.Reload != nil {
				rollback = c.Reload(certPath, keyPath)
			}

			if rollback != nil {
				installed = true // Preserve both versions when rollback cannot establish a working target.

				return fmt.Errorf("certificate reload and rollback failed: %w", rollback)
			}
		} else {
			_ = os.Remove(current)
		}

		return err
	}

	installed = true
	c.active = leaf

	if previous != "" && filepath.Dir(previous) == filepath.Clean(c.Root) {
		_ = os.RemoveAll(previous)
	}

	return nil
}

func (c *Certificates) ValidFor(duration time.Duration) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	return c.active != nil && c.active.NotAfter.After(time.Now().Add(duration))
}

func VerifyTLS(address, domain string) func(context.Context, [32]byte) error {
	return func(ctx context.Context, expected [32]byte) error {
		dialer := tls.Dialer{Config: &tls.Config{ServerName: domain, MinVersion: tls.VersionTLS12, InsecureSkipVerify: true}}
		// Chain and hostname validation precede installation; this probe compares the served leaf exactly.
		connection, err := dialer.DialContext(ctx, "tcp", address)
		if err != nil {
			return err
		}

		defer func() { _ = connection.Close() }()

		peer := connection.(*tls.Conn).ConnectionState().PeerCertificates
		if len(peer) == 0 || sha256.Sum256(peer[0].Raw) != expected {
			return errors.New("served TLS certificate differs from installed leaf")
		}

		return nil
	}
}
