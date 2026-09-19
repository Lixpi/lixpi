package maintenance

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/lixpi/caddy/internal/certificates"
	"github.com/lixpi/caddy/internal/state"
)

type Backend interface {
	Load(context.Context) ([]byte, bool, error)
	Save(context.Context, []byte) error
	Publish(context.Context, string, certificates.Pair) error
	Metrics(context.Context, float64) error
}

type Issuer interface {
	Maintain(context.Context, string, []string, func() error) error
}

type Manager struct {
	Backend Backend
	Issuer  Issuer
	Domains []string
	Timeout time.Duration
	Roots   *x509.CertPool
}

func (m Manager) Run(ctx context.Context) (result error) {
	root, err := os.MkdirTemp("", "lixpi-caddy-")
	if err != nil {
		return err
	}

	defer func() { result = errors.Join(result, os.RemoveAll(root)) }()

	data, exists, err := m.Backend.Load(ctx)
	if err != nil {
		return fmt.Errorf("restore Caddy state: %w", err)
	}

	if exists {
		if err := state.Restore(root, data); err != nil {
			return fmt.Errorf("restore Caddy archive: %w", err)
		}
	}

	ready := func() error {
		_, err := m.candidates(root)

		return err
	}
	if ready() != nil {
		deadline := time.Now().Add(m.Timeout)
		if invocationDeadline, ok := ctx.Deadline(); ok && invocationDeadline.Add(-time.Minute).Before(deadline) {
			deadline = invocationDeadline.Add(-time.Minute)
		}

		issueCtx, cancel := context.WithDeadline(ctx, deadline)
		issueErr := m.Issuer.Maintain(issueCtx, root, m.Domains, ready)
		cancel()
		// A failed issuance may still have created an ACME account or refreshed ARI.
		// Preserve that state before publishing any serving certificate.
		archive, archiveErr := state.Snapshot(root)
		if archiveErr != nil {
			return errors.Join(issueErr, fmt.Errorf("snapshot Caddy state: %w", archiveErr))
		}

		persistCtx, persistCancel := context.WithTimeout(context.WithoutCancel(ctx), time.Minute)
		saveErr := m.Backend.Save(persistCtx, archive)
		persistCancel()

		if err := errors.Join(issueErr, saveErr); err != nil {
			return fmt.Errorf("maintain and persist Caddy state: %w", err)
		}
	}

	candidates, err := m.candidates(root)
	if err != nil {
		return err
	}

	minimum := time.Until(candidates[0].Leaf.NotAfter).Seconds()
	for i, candidate := range candidates {
		if err := m.Backend.Publish(ctx, m.Domains[i], candidate.Pair); err != nil {
			return fmt.Errorf("publish certificate for %s: %w", m.Domains[i], err)
		}

		minimum = min(minimum, time.Until(candidate.Leaf.NotAfter).Seconds())
	}

	return m.Backend.Metrics(ctx, minimum)
}

func (m Manager) candidates(root string) ([]certificates.Candidate, error) {
	if len(m.Domains) == 0 {
		return nil, errors.New("no certificate domains configured")
	}

	now := time.Now()

	candidates := make([]certificates.Candidate, 0, len(m.Domains))
	for _, domain := range m.Domains {
		candidate, err := certificates.Read(root, domain, m.Roots, now)
		if err != nil {
			return nil, err
		}

		if !candidate.Ready(now) {
			return nil, fmt.Errorf("certificate or ARI maintenance is due for %s", domain)
		}

		candidates = append(candidates, candidate)
	}

	return candidates, nil
}
