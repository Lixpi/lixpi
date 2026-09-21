package issuer

import (
	"context"
	"fmt"
	"io/fs"
	"sync"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/certmagic"
)

//nolint:gochecknoinits // Caddy discovers storage modules through process-wide static registration.
func init() {
	caddy.RegisterModule(&fileStorage{})
}

// Caddy cancels asynchronous certificate jobs during cleanup. Freezing writes
// also prevents a job finishing late from changing the tree being archived.
type fileStorage struct {
	Root    string `json:"root"`
	storage *frozenStorage
}

func (*fileStorage) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{ID: "caddy.storage.lixpi_file_system", New: func() caddy.Module { return &fileStorage{} }}
}

func (s *fileStorage) CertMagicStorage() (certmagic.Storage, error) {
	s.storage = &frozenStorage{FileStorage: &certmagic.FileStorage{Path: s.Root}}

	return s.storage, nil
}

func (s *fileStorage) Cleanup() error {
	if s.storage != nil {
		s.storage.freeze()
	}

	return nil
}

type frozenStorage struct {
	*certmagic.FileStorage
	mu     sync.Mutex
	closed bool
}

func (s *frozenStorage) Store(ctx context.Context, key string, value []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return fs.ErrClosed
	}

	if err := s.FileStorage.Store(ctx, key, value); err != nil {
		return fmt.Errorf("store Caddy file %q: %w", key, err)
	}

	return nil
}

func (s *frozenStorage) Delete(ctx context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return fs.ErrClosed
	}

	if err := s.FileStorage.Delete(ctx, key); err != nil {
		return fmt.Errorf("delete Caddy file %q: %w", key, err)
	}

	return nil
}

func (s *frozenStorage) freeze() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
}
