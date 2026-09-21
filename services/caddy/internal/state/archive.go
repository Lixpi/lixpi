package state

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const (
	Key              = "caddy-state.tar.gz"
	MaxArchiveBytes  = 64 << 20
	maxExpandedBytes = 256 << 20
)

// Restore accepts the tar.gz storage tree produced by existing deployments.
func Restore(directory string, data []byte) (result error) {
	if len(data) > MaxArchiveBytes {
		return errors.New("caddy state archive exceeds size limit")
	}

	zipped, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("open Caddy state archive: %w", err)
	}

	defer func() {
		if err := zipped.Close(); err != nil {
			result = errors.Join(result, fmt.Errorf("close Caddy state archive: %w", err))
		}
	}()

	root, err := os.OpenRoot(directory)
	if err != nil {
		return fmt.Errorf("open Caddy state directory: %w", err)
	}

	defer func() {
		if err := root.Close(); err != nil {
			result = errors.Join(result, fmt.Errorf("close Caddy state directory: %w", err))
		}
	}()
	reader := tar.NewReader(zipped)
	var expanded int64

	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			// Read through the gzip trailer so a damaged checksum fails restoration.
			tail, err := io.Copy(io.Discard, io.LimitReader(zipped, maxExpandedBytes-expanded+1))
			if expanded+tail > maxExpandedBytes {
				return errors.New("expanded caddy state exceeds size limit")
			}

			if err != nil {
				return fmt.Errorf("read Caddy archive trailer: %w", err)
			}

			return nil
		}

		if err != nil {
			return fmt.Errorf("read Caddy archive entry: %w", err)
		}

		name := filepath.Clean(header.Name)
		if !filepath.IsLocal(name) {
			return fmt.Errorf("unsafe Caddy archive path %q", header.Name)
		}

		expanded += header.Size
		if header.Size < 0 || expanded > maxExpandedBytes {
			return errors.New("expanded caddy state exceeds size limit")
		}

		// A restored Lambda invocation has its own storage tree and lock owner.
		if name == "locks" || strings.HasPrefix(name, "locks/") {
			continue
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := root.MkdirAll(name, 0o700); err != nil {
				return fmt.Errorf("create restored Caddy directory %q: %w", name, err)
			}
		case tar.TypeReg:
			if err := root.MkdirAll(filepath.Dir(name), 0o700); err != nil {
				return fmt.Errorf("create parent directory for restored Caddy file %q: %w", name, err)
			}

			file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
			if err != nil {
				return fmt.Errorf("create restored Caddy file %q: %w", name, err)
			}

			_, copyErr := io.Copy(file, reader)
			if copyErr != nil {
				copyErr = fmt.Errorf("restore Caddy file %q: %w", name, copyErr)
			}

			closeErr := file.Close()
			if closeErr != nil {
				closeErr = fmt.Errorf("close restored Caddy file %q: %w", name, closeErr)
			}

			if err := errors.Join(copyErr, closeErr); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unsupported Caddy archive entry %q", header.Name)
		}
	}
}

func Snapshot(directory string) ([]byte, error) {
	var buffer bytes.Buffer
	zipped := gzip.NewWriter(&buffer)
	writer := tar.NewWriter(zipped)
	var expanded int64

	err := filepath.WalkDir(directory, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return fmt.Errorf("walk Caddy state at %q: %w", path, walkErr)
		}

		if path == filepath.Join(directory, "locks") && entry.IsDir() {
			return filepath.SkipDir
		}

		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("read Caddy state file info for %q: %w", path, err)
		}

		if !info.IsDir() && !info.Mode().IsRegular() {
			return fmt.Errorf("unsupported Caddy state file %q", path)
		}

		expanded += info.Size()
		if expanded > maxExpandedBytes || buffer.Len() > MaxArchiveBytes {
			return errors.New("caddy state exceeds size limit")
		}

		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return fmt.Errorf("create Caddy archive header for %q: %w", path, err)
		}

		header.Name, err = filepath.Rel(directory, path)
		if err != nil {
			return fmt.Errorf("resolve Caddy archive path for %q: %w", path, err)
		}

		if err := writer.WriteHeader(header); err != nil {
			return fmt.Errorf("write Caddy archive header for %q: %w", path, err)
		}

		if info.IsDir() {
			return nil
		}

		file, err := os.Open(path)
		if err != nil {
			return fmt.Errorf("open Caddy state file %q: %w", path, err)
		}

		_, copyErr := io.Copy(writer, file)
		if copyErr != nil {
			copyErr = fmt.Errorf("archive Caddy state file %q: %w", path, copyErr)
		}

		closeErr := file.Close()
		if closeErr != nil {
			closeErr = fmt.Errorf("close Caddy state file %q: %w", path, closeErr)
		}

		return errors.Join(copyErr, closeErr)
	})
	if err != nil {
		err = fmt.Errorf("walk Caddy state directory: %w", err)
	}

	writerCloseErr := writer.Close()
	if writerCloseErr != nil {
		writerCloseErr = fmt.Errorf("close Caddy state archive writer: %w", writerCloseErr)
	}

	zippedCloseErr := zipped.Close()
	if zippedCloseErr != nil {
		zippedCloseErr = fmt.Errorf("close compressed Caddy state archive: %w", zippedCloseErr)
	}

	if err := errors.Join(err, writerCloseErr, zippedCloseErr); err != nil {
		return nil, err
	}

	if buffer.Len() > MaxArchiveBytes {
		return nil, errors.New("caddy state archive exceeds size limit")
	}

	return buffer.Bytes(), nil
}
