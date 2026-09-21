package maintenance

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
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
		return nil, fmt.Errorf("create snapshot directory: %w", err)
	}

	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, fmt.Errorf("open snapshot directory: %w", err)
	}

	return &DirectoryStore{Root: root}, nil
}

func (s *DirectoryStore) Put(ctx context.Context, key string, source io.Reader) (result error) {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("start snapshot write: %w", err)
	}

	if !filepath.IsLocal(key) {
		return errors.New("invalid snapshot path")
	}

	if err := s.Root.MkdirAll(filepath.Dir(key), 0o700); err != nil {
		return fmt.Errorf("create snapshot object directory for %q: %w", key, err)
	}

	temporary := filepath.Join(filepath.Dir(key), ".partial-"+rand.Text())

	file, err := s.Root.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("create temporary snapshot object for %q: %w", key, err)
	}

	defer func() {
		if err := s.Root.Remove(temporary); err != nil && !errors.Is(err, os.ErrNotExist) {
			result = errors.Join(result, fmt.Errorf("remove temporary snapshot object for %q: %w", key, err))
		}
	}()
	_, copyErr := io.Copy(file, &contextReader{ctx: ctx, source: source})
	syncErr := file.Sync()
	closeErr := file.Close()
	ctxErr := ctx.Err()

	if copyErr != nil {
		copyErr = fmt.Errorf("write snapshot object %q: %w", key, copyErr)
	}

	if syncErr != nil {
		syncErr = fmt.Errorf("sync snapshot object %q: %w", key, syncErr)
	}

	if closeErr != nil {
		closeErr = fmt.Errorf("close snapshot object %q: %w", key, closeErr)
	}

	if ctxErr != nil {
		ctxErr = fmt.Errorf("finish snapshot write %q: %w", key, ctxErr)
	}

	if err := errors.Join(copyErr, syncErr, closeErr, ctxErr); err != nil {
		return err
	}

	if err := s.Root.Rename(temporary, key); err != nil {
		return fmt.Errorf("commit snapshot object %q: %w", key, err)
	}

	directory, err := s.Root.Open(filepath.Dir(key))
	if err != nil {
		return fmt.Errorf("open snapshot object directory for %q: %w", key, err)
	}

	syncErr = directory.Sync()
	if syncErr != nil {
		syncErr = fmt.Errorf("sync snapshot object directory for %q: %w", key, syncErr)
	}

	closeErr = directory.Close()
	if closeErr != nil {
		closeErr = fmt.Errorf("close snapshot object directory for %q: %w", key, closeErr)
	}

	return errors.Join(syncErr, closeErr)
}

func (s *DirectoryStore) Get(ctx context.Context, key string, target io.Writer) (result error) {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("start snapshot read: %w", err)
	}

	if !filepath.IsLocal(key) {
		return errors.New("invalid snapshot path")
	}

	file, err := s.Root.Open(key)
	if err != nil {
		return fmt.Errorf("open snapshot object %q: %w", key, err)
	}

	defer func() {
		if err := file.Close(); err != nil {
			result = errors.Join(result, fmt.Errorf("close snapshot object %q: %w", key, err))
		}
	}()

	_, err = io.Copy(target, &contextReader{ctx: ctx, source: file})
	if err != nil {
		return fmt.Errorf("read snapshot object %q: %w", key, err)
	}

	return nil
}

type contextReader struct {
	ctx    context.Context
	source io.Reader
}

func (r *contextReader) Read(data []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, fmt.Errorf("read canceled source: %w", err)
	}

	count, err := r.source.Read(data)
	if errors.Is(err, io.EOF) {
		return count, io.EOF
	}

	if err != nil {
		return count, fmt.Errorf("read source: %w", err)
	}

	return count, nil
}

func CertificateFiles(certificatePath, keyPath string) CertificateSource {
	return func(ctx context.Context) ([]byte, []byte, error) {
		if err := ctx.Err(); err != nil {
			return nil, nil, fmt.Errorf("read certificate files: %w", err)
		}

		if certificatePath == "" || keyPath == "" {
			return nil, nil, errors.New("certificate and private key files are required")
		}

		certificate, err := os.ReadFile(certificatePath)
		if err != nil {
			return nil, nil, fmt.Errorf("read certificate file %q: %w", certificatePath, err)
		}

		key, err := os.ReadFile(keyPath)
		if err != nil {
			return nil, nil, fmt.Errorf("read private key file %q: %w", keyPath, err)
		}

		return certificate, key, nil
	}
}
