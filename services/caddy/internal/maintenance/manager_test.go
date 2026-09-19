package maintenance

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lixpi/caddy/internal/certificates"
	"github.com/lixpi/caddy/internal/state"
	"github.com/lixpi/caddy/internal/testcert"
)

type memoryBackend struct {
	data                                    []byte
	loadErr, saveErr, publishErr, metricErr error
	saves, publishes, metrics               int
	pair                                    certificates.Pair
}

func (b *memoryBackend) Load(context.Context) ([]byte, bool, error) {
	return b.data, b.data != nil, b.loadErr
}

func (b *memoryBackend) Save(_ context.Context, data []byte) error {
	b.saves++
	if b.saveErr == nil {
		b.data = data
	}

	return b.saveErr
}

func (b *memoryBackend) Publish(_ context.Context, _ string, pair certificates.Pair) error {
	b.publishes++
	b.pair = pair

	return b.publishErr
}

func (b *memoryBackend) Metrics(context.Context, float64) error {
	b.metrics++

	return b.metricErr
}

type issueFunc func(context.Context, string, []string, func() error) error

func (f issueFunc) Maintain(ctx context.Context, root string, domains []string, ready func() error) error {
	return f(ctx, root, domains, ready)
}

func TestMaintenanceRestoresStateAndSkipsFreshIssuance(t *testing.T) {
	ca := testcert.New(t)
	pair := ca.Issue(t, "nats.example.test", time.Now().Add(-time.Hour), time.Now().Add(60*24*time.Hour))
	backend := &memoryBackend{}
	issuances := 0
	manager := Manager{
		Backend: backend, Domains: []string{"nats.example.test"}, Roots: ca.Roots, Timeout: time.Second,
		Issuer: issueFunc(func(_ context.Context, root string, _ []string, ready func() error) error {
			issuances++
			testcert.Write(t, root, "nats.example.test", pair, "{}")

			if err := os.MkdirAll(filepath.Join(root, "acme"), 0o700); err != nil {
				return err
			}

			if err := os.WriteFile(filepath.Join(root, "acme", "account.json"), []byte("account"), 0o600); err != nil {
				return err
			}

			return ready()
		}),
	}

	for range 2 {
		if err := manager.Run(t.Context()); err != nil {
			t.Fatal(err)
		}
	}

	if issuances != 1 || backend.saves != 1 || backend.metrics != 2 || backend.pair != pair {
		t.Fatalf("issuances=%d, saves=%d, metrics=%d", issuances, backend.saves, backend.metrics)
	}

	restored := t.TempDir()
	if err := state.Restore(restored, backend.data); err != nil {
		t.Fatal(err)
	}

	if data, err := os.ReadFile(filepath.Join(restored, "acme", "account.json")); err != nil || string(data) != "account" {
		t.Fatal("ACME account was not preserved")
	}
}

func TestMaintenanceFailuresDoNotPublish(t *testing.T) {
	ca := testcert.New(t)
	pair := ca.Issue(t, "nats.example.test", time.Now().Add(-time.Hour), time.Now().Add(60*24*time.Hour))

	failure := errors.New("injected failure")
	for _, test := range []struct {
		name                string
		backend             memoryBackend
		issueErr            error
		wantIssue, wantSave int
	}{
		{"state read", memoryBackend{loadErr: failure}, nil, 0, 0},
		{"corrupt archive", memoryBackend{data: []byte("damaged")}, nil, 0, 0},
		{"state write", memoryBackend{saveErr: failure}, nil, 1, 1},
		{"issuance failure", memoryBackend{}, failure, 1, 1},
		{"cancelled issuance", memoryBackend{}, context.DeadlineExceeded, 1, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			backend := test.backend
			issued := 0

			manager := Manager{
				Backend: &backend, Domains: []string{"nats.example.test"}, Roots: ca.Roots, Timeout: time.Second,
				Issuer: issueFunc(func(_ context.Context, root string, _ []string, _ func() error) error {
					issued++
					testcert.Write(t, root, "nats.example.test", pair, "{}")

					return test.issueErr
				}),
			}
			if err := manager.Run(t.Context()); err == nil {
				t.Fatal("failure accepted")
			}

			if issued != test.wantIssue || backend.saves != test.wantSave || backend.publishes != 0 || backend.metrics != 0 {
				t.Fatalf("issued=%d, saved=%d, published=%d, metrics=%d", issued, backend.saves, backend.publishes, backend.metrics)
			}
		})
	}
}

func TestMaintenanceRenewsLifetimeAndARI(t *testing.T) {
	ca := testcert.New(t)

	now := time.Now()
	for _, test := range []struct {
		name, metadata string
		start, end     time.Time
	}{
		{"lifetime", "{}", now.Add(-60 * 24 * time.Hour), now.Add(10 * 24 * time.Hour)},
		{"ARI", `{"issuer_data":{"renewal_info":{"_retryAfter":"2020-01-01T00:00:00Z"}}}`, now.Add(-time.Hour), now.Add(60 * 24 * time.Hour)},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			testcert.Write(t, root, "nats.example.test", ca.Issue(t, "nats.example.test", test.start, test.end), test.metadata)

			data, err := state.Snapshot(root)
			if err != nil {
				t.Fatal(err)
			}

			backend := &memoryBackend{data: data}
			fresh := ca.Issue(t, "nats.example.test", now.Add(-time.Hour), now.Add(90*24*time.Hour))

			manager := Manager{
				Backend: backend, Domains: []string{"nats.example.test"}, Roots: ca.Roots, Timeout: time.Second,
				Issuer: issueFunc(func(_ context.Context, root string, _ []string, ready func() error) error {
					testcert.Write(t, root, "nats.example.test", fresh, "{}")

					return ready()
				}),
			}
			if err := manager.Run(t.Context()); err != nil {
				t.Fatal(err)
			}

			if backend.saves != 1 || backend.pair != fresh {
				t.Fatal("renewed certificate was not persisted and published")
			}
		})
	}
}
