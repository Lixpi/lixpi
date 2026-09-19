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
		return err
	}

	defer func() { result = errors.Join(result, zipped.Close()) }()

	root, err := os.OpenRoot(directory)
	if err != nil {
		return err
	}

	defer func() { result = errors.Join(result, root.Close()) }()
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

			return err
		}

		if err != nil {
			return err
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
				return err
			}
		case tar.TypeReg:
			if err := root.MkdirAll(filepath.Dir(name), 0o700); err != nil {
				return err
			}

			file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
			if err != nil {
				return err
			}

			_, copyErr := io.Copy(file, reader)
			if err := errors.Join(copyErr, file.Close()); err != nil {
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
			return walkErr
		}

		if path == filepath.Join(directory, "locks") && entry.IsDir() {
			return filepath.SkipDir
		}

		info, err := entry.Info()
		if err != nil {
			return err
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
			return err
		}

		header.Name, err = filepath.Rel(directory, path)
		if err != nil {
			return err
		}

		if err := writer.WriteHeader(header); err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		file, err := os.Open(path)
		if err != nil {
			return err
		}

		_, copyErr := io.Copy(writer, file)

		return errors.Join(copyErr, file.Close())
	})
	if err := errors.Join(err, writer.Close(), zipped.Close()); err != nil {
		return nil, err
	}

	if buffer.Len() > MaxArchiveBytes {
		return nil, errors.New("caddy state archive exceeds size limit")
	}

	return buffer.Bytes(), nil
}
