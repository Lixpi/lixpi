package certificates_test

import (
	"crypto/x509"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/lixpi/caddy/internal/certificates"
	"github.com/lixpi/caddy/internal/testcert"
)

func TestServingCertificateValidation(t *testing.T) {
	ca := testcert.New(t)
	now := time.Now()
	valid := ca.Issue(t, "nats.example.test", now.Add(-time.Hour), now.Add(60*24*time.Hour))

	other := ca.Issue(t, "nats.example.test", now.Add(-time.Hour), now.Add(60*24*time.Hour))
	for _, test := range []struct {
		name   string
		pair   certificates.Pair
		domain string
		roots  *x509.CertPool
	}{
		{"wrong hostname", valid, "other.example.test", ca.Roots},
		{"mismatched key", certificates.Pair{Certificate: valid.Certificate, PrivateKey: other.PrivateKey}, "nats.example.test", ca.Roots},
		{"untrusted issuer", valid, "nats.example.test", x509.NewCertPool()},
		{"malformed", certificates.Pair{Certificate: "invalid", PrivateKey: valid.PrivateKey}, "nats.example.test", ca.Roots},
		{"expired", ca.Issue(t, "nats.example.test", now.Add(-48*time.Hour), now.Add(-time.Hour)), "nats.example.test", ca.Roots},
		{"not yet valid", ca.Issue(t, "nats.example.test", now.Add(time.Hour), now.Add(48*time.Hour)), "nats.example.test", ca.Roots},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := certificates.Validate(test.pair, test.domain, test.roots, now); err == nil {
				t.Fatal("invalid certificate accepted")
			}
		})
	}

	if _, err := certificates.Validate(valid, "nats.example.test", ca.Roots, now); err != nil {
		t.Fatal(err)
	}
}

func TestRenewalWindowAndARI(t *testing.T) {
	ca := testcert.New(t)

	now := time.Now()
	for _, test := range []struct {
		name       string
		start, end time.Time
		metadata   string
		ready      bool
	}{
		{"fresh", now.Add(-time.Hour), now.Add(60 * 24 * time.Hour), "{}", true},
		{"final third", now.Add(-60 * 24 * time.Hour), now.Add(10 * 24 * time.Hour), "{}", false},
		{"ARI selected", now.Add(-time.Hour), now.Add(60 * 24 * time.Hour), fmt.Sprintf(`{"issuer_data":{"renewal_info":{"_selectedTime":%q}}}`, now.Add(-time.Minute).Format(time.RFC3339)), false},
		{"ARI refresh", now.Add(-time.Hour), now.Add(60 * 24 * time.Hour), fmt.Sprintf(`{"issuer_data":{"renewal_info":{"_retryAfter":%q}}}`, now.Add(30*time.Second).Format(time.RFC3339)), false},
		{"ARI future", now.Add(-time.Hour), now.Add(60 * 24 * time.Hour), fmt.Sprintf(`{"issuer_data":{"renewal_info":{"_retryAfter":%q}}}`, now.Add(time.Hour).Format(time.RFC3339)), true},
		{"ARI zero", now.Add(-time.Hour), now.Add(60 * 24 * time.Hour), `{"issuer_data":{"renewal_info":{"_selectedTime":"0001-01-01T00:00:00Z"}}}`, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			testcert.Write(t, root, "*.example.test", ca.Issue(t, "*.example.test", test.start, test.end), test.metadata)

			candidate, err := certificates.Read(root, "*.example.test", ca.Roots, now)
			if err != nil {
				t.Fatal(err)
			}

			if candidate.Ready(now) != test.ready {
				t.Fatalf("ready=%v, want %v", candidate.Ready(now), test.ready)
			}
		})
	}
}

func TestDiscardOverlongLocal(t *testing.T) {
	ca := testcert.New(t)
	now := time.Now()

	for _, test := range []struct {
		name      string
		lifetime  time.Duration
		discarded int
	}{
		{"longer than Apple accepts", 2500 * 24 * time.Hour, 1},
		{"local leaf lifetime", certificates.LocalLeafLifetime, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			base := testcert.Write(t, root, "localhost", ca.Issue(t, "localhost", now.Add(-time.Hour), now.Add(test.lifetime-time.Hour)), "{}")

			discarded, err := certificates.DiscardOverlongLocal(root, "localhost")
			if err != nil {
				t.Fatal(err)
			}

			if discarded != test.discarded {
				t.Fatalf("discarded=%d, want %d", discarded, test.discarded)
			}

			for _, extension := range []string{".crt", ".key", ".json"} {
				_, err := os.Stat(base + extension)
				if exists := err == nil; exists == (test.discarded > 0) {
					t.Fatalf("%s exists=%v after discarding %d", extension, exists, discarded)
				}
			}
		})
	}

	discarded, err := certificates.DiscardOverlongLocal(t.TempDir(), "localhost")
	if err != nil || discarded != 0 {
		t.Fatalf("empty storage: discarded=%d, err=%v", discarded, err)
	}
}
