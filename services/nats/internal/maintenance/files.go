package maintenance

import (
	"context"
	"crypto/rand"
	"errors"
	"io"
	"os"
	"path/filepath"
)

// SnapshotStore contains backup files, independently of the broker's live storage.
type SnapshotStore interface {
	Put(context.Context, string, io.Reader) error
	Get(context.Context, string, io.Writer) error
}

type DirectoryStore struct{ Root *os.Root }

func OpenDirectoryStore(directory string) (*DirectoryStore, error) {
	if directory == "" {
		return nil, errors.New("snapshot directory is required")
	}

	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}

	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}

	return &DirectoryStore{Root: root}, nil
}

func (s *DirectoryStore) Put(ctx context.Context, key string, source io.Reader) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	if !filepath.IsLocal(key) {
		return errors.New("invalid snapshot path")
	}

	if err := s.Root.MkdirAll(filepath.Dir(key), 0o700); err != nil {
		return err
	}

	temporary := filepath.Join(filepath.Dir(key), ".partial-"+rand.Text())

	file, err := s.Root.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}

	defer func() { _ = s.Root.Remove(temporary) }()
	_, copyErr := io.Copy(file, &contextReader{ctx: ctx, source: source})
	syncErr := file.Sync()
	closeErr := file.Close()

	if err := errors.Join(copyErr, syncErr, closeErr, ctx.Err()); err != nil {
		return err
	}

	if err := s.Root.Rename(temporary, key); err != nil {
		return err
	}

	directory, err := s.Root.Open(filepath.Dir(key))
	if err != nil {
		return err
	}

	return errors.Join(directory.Sync(), directory.Close())
}

func (s *DirectoryStore) Get(ctx context.Context, key string, target io.Writer) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	if !filepath.IsLocal(key) {
		return errors.New("invalid snapshot path")
	}

	file, err := s.Root.Open(key)
	if err != nil {
		return err
	}

	defer func() { _ = file.Close() }()
	_, err = io.Copy(target, &contextReader{ctx: ctx, source: file})

	return err
}

type contextReader struct {
	ctx    context.Context
	source io.Reader
}

func (r *contextReader) Read(data []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}

	return r.source.Read(data)
}

func CertificateFiles(certificatePath, keyPath string) CertificateSource {
	return func(ctx context.Context) ([]byte, []byte, error) {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}

		if certificatePath == "" || keyPath == "" {
			return nil, nil, errors.New("certificate and private key files are required")
		}

		certificate, err := os.ReadFile(certificatePath)
		if err != nil {
			return nil, nil, err
		}

		key, err := os.ReadFile(keyPath)

		return certificate, key, err
	}
}
