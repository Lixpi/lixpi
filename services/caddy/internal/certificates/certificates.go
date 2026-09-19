package certificates

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/caddyserver/certmagic"
)

// Pair is the serving-secret wire format consumed by the NATS deployment adapter.
type Pair struct {
	Certificate string `json:"certificate"`
	PrivateKey  string `json:"private_key"`
}

type Candidate struct {
	Pair
	Leaf    *x509.Certificate
	RenewAt time.Time
}

func (c Candidate) Ready(now time.Time) bool {
	return now.Before(c.Leaf.NotAfter.Add(-c.Leaf.NotAfter.Sub(c.Leaf.NotBefore)/3)) &&
		(c.RenewAt.IsZero() || c.RenewAt.After(now.Add(time.Minute)))
}

// Read searches issuer directories because Caddy can fall back to another CA.
func Read(root, domain string, roots *x509.CertPool, now time.Time) (Candidate, error) {
	var best Candidate
	var failures []error
	filename := certmagic.StorageKeys.Safe(domain) + ".crt"

	err := filepath.WalkDir(filepath.Join(root, "certificates"), func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}

		if entry.Type().IsRegular() && entry.Name() == filename {
			candidate, err := readCandidate(path, domain, roots, now)
			if err != nil {
				failures = append(failures, err)

				return nil
			}

			if best.Leaf == nil || candidate.Leaf.NotAfter.After(best.Leaf.NotAfter) {
				best = candidate
			}
		}

		return nil
	})
	if err != nil {
		return Candidate{}, fmt.Errorf("read certificate for %s: %w", domain, err)
	}

	if best.Leaf == nil {
		return Candidate{}, fmt.Errorf("no valid certificate for %s: %w", domain, errors.Join(append(failures, fs.ErrNotExist)...))
	}

	return best, nil
}

func readCandidate(path, domain string, roots *x509.CertPool, now time.Time) (Candidate, error) {
	certificate, err := os.ReadFile(path)
	if err != nil {
		return Candidate{}, err
	}

	base := strings.TrimSuffix(path, ".crt")

	key, err := os.ReadFile(base + ".key")
	if err != nil {
		return Candidate{}, err
	}

	pair := Pair{Certificate: string(certificate), PrivateKey: string(key)}

	leaf, err := Validate(pair, domain, roots, now)
	if err != nil {
		return Candidate{}, err
	}

	renewAt, err := renewalTime(base + ".json")
	if err != nil {
		return Candidate{}, err
	}

	return Candidate{Pair: pair, Leaf: leaf, RenewAt: renewAt}, nil
}

func Validate(pair Pair, domain string, roots *x509.CertPool, now time.Time) (*x509.Certificate, error) {
	keyPair, err := tls.X509KeyPair([]byte(pair.Certificate), []byte(pair.PrivateKey))
	if err != nil {
		return nil, fmt.Errorf("invalid certificate/key pair for %s: %w", domain, err)
	}

	leaf, err := x509.ParseCertificate(keyPair.Certificate[0])
	if err != nil {
		return nil, err
	}

	intermediates := x509.NewCertPool()

	for _, der := range keyPair.Certificate[1:] {
		cert, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, err
		}

		intermediates.AddCert(cert)
	}

	_, err = leaf.Verify(x509.VerifyOptions{
		DNSName: domain, Roots: roots, Intermediates: intermediates, CurrentTime: now,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	})
	if err != nil {
		return nil, fmt.Errorf("verify certificate for %s: %w", domain, err)
	}

	return leaf, nil
}

func renewalTime(path string) (time.Time, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return time.Time{}, nil
	}

	if err != nil {
		return time.Time{}, err
	}

	var metadata struct {
		IssuerData struct {
			RenewalInfo struct {
				SelectedTime time.Time `json:"_selectedTime"`
				RetryAfter   time.Time `json:"_retryAfter"`
			} `json:"renewal_info"`
		} `json:"issuer_data"`
	}
	if err := json.Unmarshal(data, &metadata); err != nil {
		return time.Time{}, fmt.Errorf("invalid renewal metadata: %w", err)
	}

	selected := metadata.IssuerData.RenewalInfo.SelectedTime

	retry := metadata.IssuerData.RenewalInfo.RetryAfter
	if selected.IsZero() || (!retry.IsZero() && retry.Before(selected)) {
		return retry, nil
	}

	return selected, nil
}

func LocalRoots(root string) (*x509.CertPool, []byte, error) {
	data, err := os.ReadFile(filepath.Join(root, "pki", "authorities", "local", "root.crt"))
	if err != nil {
		return nil, nil, err
	}

	block, _ := pem.Decode(data)
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, nil, errors.New("invalid local CA certificate")
	}

	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(data) {
		return nil, nil, errors.New("cannot load local CA certificate")
	}

	return pool, data, nil
}

func ExportLocal(root string, now time.Time) error {
	roots, ca, err := LocalRoots(root)
	if err != nil {
		return err
	}

	candidate, err := Read(root, "localhost", roots, now)
	if err != nil {
		return err
	}

	for _, file := range []struct {
		name string
		data []byte
		mode fs.FileMode
	}{
		{"ca.crt", ca, 0o644},
		{"localhost.crt", []byte(candidate.Certificate), 0o644},
		{"localhost.key", []byte(candidate.PrivateKey), 0o600},
	} {
		if err := os.WriteFile(filepath.Join(root, file.name), file.data, file.mode); err != nil {
			return err
		}

		if err := os.Chmod(filepath.Join(root, file.name), file.mode); err != nil {
			return err
		}
	}

	return nil
}
