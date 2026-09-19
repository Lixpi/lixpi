package testcert

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/caddyserver/certmagic"
	"github.com/lixpi/caddy/internal/certificates"
)

// Authority generates disposable certificates; it never reads application keys.
type Authority struct {
	Certificate *x509.Certificate
	Key         *ecdsa.PrivateKey
	Roots       *x509.CertPool
}

func New(t *testing.T) Authority {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Caddy test CA"},
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
		NotBefore: time.Now().Add(-365 * 24 * time.Hour), NotAfter: time.Now().Add(365 * 24 * time.Hour),
	}

	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}

	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}

	roots := x509.NewCertPool()
	roots.AddCert(certificate)

	return Authority{Certificate: certificate, Key: key, Roots: roots}
}

func (a Authority) Issue(t *testing.T, domain string, start, end time.Time) certificates.Pair {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	if err != nil {
		t.Fatal(err)
	}

	template := &x509.Certificate{
		SerialNumber: serial, DNSNames: []string{domain}, NotBefore: start, NotAfter: end,
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}

	der, err := x509.CreateCertificate(rand.Reader, template, a.Certificate, &key.PublicKey, a.Key)
	if err != nil {
		t.Fatal(err)
	}

	private, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}

	return certificates.Pair{
		Certificate: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})),
		PrivateKey:  string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private})),
	}
}

func Write(t *testing.T, root, domain string, pair certificates.Pair, metadata string) string {
	t.Helper()
	name := certmagic.StorageKeys.Safe(domain)

	base := filepath.Join(root, "certificates", "test-ca", name, name)
	if err := os.MkdirAll(filepath.Dir(base), 0o700); err != nil {
		t.Fatal(err)
	}

	for extension, data := range map[string]string{".crt": pair.Certificate, ".key": pair.PrivateKey, ".json": metadata} {
		if err := os.WriteFile(base+extension, []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	return base
}
