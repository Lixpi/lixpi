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

func (c *Certificates) Refresh(ctx context.Context) (result error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	certificate, key, err := c.Source(ctx)
	if err != nil {
		return fmt.Errorf("read delivered TLS certificate: %w", err)
	}

	pair, err := tls.X509KeyPair(certificate, key)
	if err != nil {
		return fmt.Errorf("parse TLS certificate/key pair: %w", err)
	}

	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return fmt.Errorf("parse TLS leaf certificate: %w", err)
	}

	now := time.Now()
	if now.Before(leaf.NotBefore) || leaf.NotAfter.Before(now.Add(c.MinValidity)) {
		return errors.New("TLS certificate outside required validity window")
	}

	if err := leaf.VerifyHostname(c.Domain); err != nil {
		return fmt.Errorf("verify TLS certificate hostname %q: %w", c.Domain, err)
	}

	if !c.Local || c.Roots != nil {
		intermediates := x509.NewCertPool()

		for _, der := range pair.Certificate[1:] {
			cert, err := x509.ParseCertificate(der)
			if err != nil {
				return fmt.Errorf("parse TLS intermediate certificate: %w", err)
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
			return fmt.Errorf("verify TLS certificate chain: %w", err)
		}
	}

	if err := os.MkdirAll(c.Root, 0o700); err != nil {
		return fmt.Errorf("create installed certificate directory: %w", err)
	}

	current := filepath.Join(c.Root, "current")
	previous, _ := os.Readlink(current)
	oldCert, _ := os.ReadFile(filepath.Join(current, "server.crt"))
	oldKey, _ := os.ReadFile(filepath.Join(current, "server.key"))
	fingerprint := sha256.Sum256(leaf.Raw)

	if bytes.Equal(oldCert, certificate) && bytes.Equal(oldKey, key) {
		c.active = leaf

		if c.VerifyServed != nil {
			if err := c.VerifyServed(ctx, fingerprint); err != nil {
				return fmt.Errorf("verify unchanged served certificate: %w", err)
			}
		}

		return nil
	}

	version, err := os.MkdirTemp(c.Root, "version.")
	if err != nil {
		return fmt.Errorf("create certificate version directory: %w", err)
	}

	installed := false
	defer func() {
		if !installed {
			if err := os.RemoveAll(version); err != nil {
				result = errors.Join(result, fmt.Errorf("remove incomplete certificate version: %w", err))
			}
		}
	}()

	if err := os.WriteFile(filepath.Join(version, "server.crt"), certificate, 0o600); err != nil {
		return fmt.Errorf("write certificate version: %w", err)
	}

	if err := os.WriteFile(filepath.Join(version, "server.key"), key, 0o600); err != nil {
		return fmt.Errorf("write certificate key version: %w", err)
	}

	switchTo := func(target string) error {
		next := filepath.Join(c.Root, "next")
		if err := os.Remove(next); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove stale certificate link: %w", err)
		}

		if err := os.Symlink(target, next); err != nil {
			return fmt.Errorf("create next certificate link: %w", err)
		}

		if err := os.Rename(next, current); err != nil {
			return fmt.Errorf("activate certificate link: %w", err)
		}

		return nil
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

				return errors.Join(fmt.Errorf("certificate reload failed: %w", err), fmt.Errorf("certificate rollback failed: %w", rollback))
			}
		} else {
			if removeErr := os.Remove(current); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
				return errors.Join(fmt.Errorf("certificate reload failed: %w", err), fmt.Errorf("remove failed certificate link: %w", removeErr))
			}
		}

		return fmt.Errorf("reload installed certificate: %w", err)
	}

	installed = true
	c.active = leaf

	if previous != "" && filepath.Dir(previous) == filepath.Clean(c.Root) {
		if err := os.RemoveAll(previous); err != nil {
			return fmt.Errorf("remove previous certificate version: %w", err)
		}
	}

	return nil
}

func (c *Certificates) ValidFor(duration time.Duration) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	return c.active != nil && c.active.NotAfter.After(time.Now().Add(duration))
}

func VerifyTLS(address, domain string) func(context.Context, [32]byte) error {
	return func(ctx context.Context, expected [32]byte) (result error) {
		dialer := tls.Dialer{Config: &tls.Config{ServerName: domain, MinVersion: tls.VersionTLS12, InsecureSkipVerify: true}}
		// Chain and hostname validation precede installation; this probe compares the served leaf exactly.
		connection, err := dialer.DialContext(ctx, "tcp", address)
		if err != nil {
			return fmt.Errorf("connect to TLS listener %q: %w", address, err)
		}

		defer func() {
			if err := connection.Close(); err != nil {
				result = errors.Join(result, fmt.Errorf("close TLS probe connection: %w", err))
			}
		}()

		tlsConnection, ok := connection.(*tls.Conn)
		if !ok {
			return errors.New("TLS probe returned a non-TLS connection")
		}

		peer := tlsConnection.ConnectionState().PeerCertificates
		if len(peer) == 0 || sha256.Sum256(peer[0].Raw) != expected {
			return errors.New("served TLS certificate differs from installed leaf")
		}

		return nil
	}
}
