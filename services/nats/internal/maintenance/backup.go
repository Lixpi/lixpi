package maintenance

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
)

var snapshotName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`)

type Backup struct {
	Snapshots *Snapshots
	Store     SnapshotStore
	Scratch   string
}

func (b *Backup) Capture(ctx context.Context) (snapshotID string, result error) {
	directory, err := os.MkdirTemp(b.Scratch, "nats-backup.")
	if err != nil {
		return "", fmt.Errorf("create backup staging directory: %w", err)
	}

	defer func() {
		if err := os.RemoveAll(directory); err != nil {
			result = errors.Join(result, fmt.Errorf("remove backup staging directory: %w", err))
		}
	}()
	id := time.Now().UTC().Format("20060102T150405Z") + "-" + rand.Text()

	names, err := b.Snapshots.List(ctx)
	if err != nil {
		return "", fmt.Errorf("list streams before backup: %w", err)
	}

	var inventory bytes.Buffer
	files := []string{"inventory.jsonl"}

	for _, name := range names {
		streamDir := filepath.Join(directory, name)

		if err := os.Mkdir(streamDir, 0o700); err != nil {
			return "", fmt.Errorf("create backup directory for stream %q: %w", name, err)
		}

		archivePath := filepath.Join(streamDir, "stream.tar.s2")

		file, err := os.OpenFile(archivePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return "", fmt.Errorf("create snapshot archive for stream %q: %w", name, err)
		}

		snapshot, err := b.Snapshots.Capture(ctx, name, file)
		closeErr := file.Close()

		if err != nil {
			return "", fmt.Errorf("capture stream %q: %w", name, err)
		}

		if closeErr != nil {
			return "", fmt.Errorf("close snapshot archive for stream %q: %w", name, closeErr)
		}

		metadata, err := json.Marshal(snapshot)
		if err != nil {
			return "", fmt.Errorf("encode backup metadata for stream %q: %w", name, err)
		}

		if err := os.WriteFile(filepath.Join(streamDir, "backup.json"), metadata, 0o600); err != nil {
			return "", fmt.Errorf("write backup metadata for stream %q: %w", name, err)
		}

		snapshot.SnapshotID = id

		if err := json.NewEncoder(&inventory).Encode(snapshot); err != nil {
			return "", fmt.Errorf("encode backup inventory for stream %q: %w", name, err)
		}

		files = append(files, path.Join(name, "backup.json"), path.Join(name, "stream.tar.s2"))
	}

	after, err := b.Snapshots.List(ctx)
	if err != nil {
		return "", fmt.Errorf("list streams after backup: %w", err)
	}

	if !slices.Equal(names, after) {
		return "", errors.New("stream inventory changed during backup")
	}

	if err := os.WriteFile(filepath.Join(directory, "inventory.jsonl"), inventory.Bytes(), 0o600); err != nil {
		return "", fmt.Errorf("write backup inventory: %w", err)
	}

	var manifest strings.Builder

	for _, name := range files {
		digest, err := fileDigest(filepath.Join(directory, filepath.FromSlash(name)))
		if err != nil {
			return "", fmt.Errorf("digest backup file %q: %w", name, err)
		}

		_, _ = fmt.Fprintf(&manifest, "%s  %s\n", digest, name)
	}

	if err := os.WriteFile(filepath.Join(directory, "SHA256SUMS"), []byte(manifest.String()), 0o600); err != nil {
		return "", fmt.Errorf("write backup checksum manifest: %w", err)
	}

	for _, name := range append(files, "SHA256SUMS") {
		file, err := os.Open(filepath.Join(directory, filepath.FromSlash(name)))
		if err != nil {
			return "", fmt.Errorf("open backup file %q for upload: %w", name, err)
		}

		err = b.Store.Put(ctx, path.Join(id, name), file)
		closeErr := file.Close()

		if err != nil {
			return "", fmt.Errorf("upload backup file %q: %w", name, err)
		}

		if closeErr != nil {
			return "", fmt.Errorf("close uploaded backup file %q: %w", name, closeErr)
		}
	}

	if err := b.Store.Put(ctx, path.Join(id, "COMPLETE"), strings.NewReader(id+"\n")); err != nil {
		return "", fmt.Errorf("write backup completion marker: %w", err)
	}

	if err := b.Store.Put(ctx, "LATEST", strings.NewReader(id+"\n")); err != nil {
		return "", fmt.Errorf("write latest backup pointer: %w", err)
	}

	return id, nil
}

func fileDigest(name string) (digest string, result error) {
	file, err := os.Open(name)
	if err != nil {
		return "", fmt.Errorf("open file for digest: %w", err)
	}

	defer func() {
		if err := file.Close(); err != nil {
			result = errors.Join(result, fmt.Errorf("close digested file: %w", err))
		}
	}()
	hash := sha256.New()

	if _, err := io.Copy(hash, file); err != nil {
		return "", fmt.Errorf("read file for digest: %w", err)
	}

	return hex.EncodeToString(hash.Sum(nil)), nil
}

type limitedWriter struct {
	target    io.Writer
	remaining int64
}

func (w *limitedWriter) Write(data []byte) (int, error) {
	if int64(len(data)) > w.remaining {
		return 0, errors.New("object exceeds size limit")
	}

	count, err := w.target.Write(data)
	w.remaining -= int64(count)

	if err != nil {
		return count, fmt.Errorf("write limited object: %w", err)
	}

	return count, nil
}

func (b *Backup) readSmall(ctx context.Context, key string, limit int64) ([]byte, error) {
	var value bytes.Buffer

	err := b.Store.Get(ctx, key, &limitedWriter{target: &value, remaining: limit})
	if err != nil {
		return nil, fmt.Errorf("read backup object %q: %w", key, err)
	}

	return value.Bytes(), nil
}

func (b *Backup) Restore(ctx context.Context, id string) (result error) {
	if id == "" {
		latest, err := b.readSmall(ctx, "LATEST", 256)
		if err != nil {
			return fmt.Errorf("read latest backup pointer: %w", err)
		}

		id = strings.TrimSpace(string(latest))
	}

	if !snapshotName.MatchString(id) {
		return errors.New("invalid snapshot id")
	}

	complete, err := b.readSmall(ctx, path.Join(id, "COMPLETE"), 256)
	if err != nil {
		return fmt.Errorf("read backup completion marker: %w", err)
	}

	if strings.TrimSpace(string(complete)) != id {
		return errors.New("incomplete snapshot")
	}

	manifest, err := b.readSmall(ctx, path.Join(id, "SHA256SUMS"), 8*1024*1024)
	if err != nil {
		return fmt.Errorf("read backup checksum manifest: %w", err)
	}

	directory, err := os.MkdirTemp(b.Scratch, "nats-restore.")
	if err != nil {
		return fmt.Errorf("create restore staging directory: %w", err)
	}

	defer func() {
		if err := os.RemoveAll(directory); err != nil {
			result = errors.Join(result, fmt.Errorf("remove restore staging directory: %w", err))
		}
	}()
	files := map[string]bool{}
	scanner := bufio.NewScanner(bytes.NewReader(manifest))

	for scanner.Scan() {
		line := scanner.Text()
		if len(line) < 67 || line[64:66] != "  " {
			return errors.New("invalid checksum manifest")
		}

		expected, name := line[:64], line[66:]

		if _, err := hex.DecodeString(expected); err != nil {
			return errors.New("invalid checksum")
		}

		parts := strings.Split(name, "/")

		valid := name == "inventory.jsonl" ||
			(len(parts) == 2 && streamName.MatchString(parts[0]) && (parts[1] == "backup.json" || parts[1] == "stream.tar.s2"))
		if !valid || files[name] {
			return errors.New("unsafe or duplicate snapshot path")
		}

		files[name] = true
		local := filepath.Join(directory, filepath.FromSlash(name))

		if err := os.MkdirAll(filepath.Dir(local), 0o700); err != nil {
			return fmt.Errorf("create restore directory for %q: %w", name, err)
		}

		file, err := os.OpenFile(local, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return fmt.Errorf("create restored backup file %q: %w", name, err)
		}

		limit := int64(110 * 1024 * 1024 * 1024)

		if parts[len(parts)-1] != "stream.tar.s2" {
			limit = 8 * 1024 * 1024
		}

		err = b.Store.Get(ctx, path.Join(id, name), &limitedWriter{target: file, remaining: limit})
		closeErr := file.Close()

		if err != nil {
			return fmt.Errorf("download backup file %q: %w", name, err)
		}

		if closeErr != nil {
			return fmt.Errorf("close restored backup file %q: %w", name, closeErr)
		}

		actual, err := fileDigest(local)
		if err != nil {
			return fmt.Errorf("digest restored backup file %q: %w", name, err)
		}

		if actual != expected {
			return errors.New("snapshot checksum mismatch")
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read backup checksum manifest: %w", err)
	}

	if !files["inventory.jsonl"] {
		return errors.New("missing snapshot inventory")
	}

	inventory, err := os.ReadFile(filepath.Join(directory, "inventory.jsonl"))
	if err != nil {
		return fmt.Errorf("read restored backup inventory: %w", err)
	}

	var snapshots []Snapshot
	seen := map[string]bool{}
	decoder := json.NewDecoder(bytes.NewReader(inventory))

	for {
		var snapshot Snapshot

		err := decoder.Decode(&snapshot)
		if errors.Is(err, io.EOF) {
			break
		}

		if err != nil {
			return fmt.Errorf("decode backup inventory: %w", err)
		}

		name := snapshot.Config.Name
		if snapshot.SnapshotID != id || !streamName.MatchString(name) || seen[name] || !files[path.Join(name, "backup.json")] ||
			!files[path.Join(name, "stream.tar.s2")] {
			return errors.New("invalid snapshot inventory entry")
		}

		seen[name] = true

		metadata, err := os.ReadFile(filepath.Join(directory, name, "backup.json"))
		if err != nil {
			return fmt.Errorf("read backup metadata for stream %q: %w", name, err)
		}

		var saved Snapshot

		if err := json.Unmarshal(metadata, &saved); err != nil {
			return fmt.Errorf("decode backup metadata for stream %q: %w", name, err)
		}

		left, err := json.Marshal(Snapshot{Config: snapshot.Config, State: snapshot.State})
		if err != nil {
			return fmt.Errorf("encode inventory metadata for stream %q: %w", name, err)
		}

		right, err := json.Marshal(Snapshot{Config: saved.Config, State: saved.State})
		if err != nil {
			return fmt.Errorf("encode saved metadata for stream %q: %w", name, err)
		}

		if !bytes.Equal(left, right) {
			return errors.New("snapshot metadata differs from inventory")
		}

		stat, err := os.Stat(filepath.Join(directory, name, "stream.tar.s2"))
		if err != nil {
			return fmt.Errorf("inspect snapshot archive for stream %q: %w", name, err)
		}

		if stat.Size() == 0 {
			return errors.New("empty snapshot archive")
		}

		snapshots = append(snapshots, snapshot)
	}

	if len(files) != 1+2*len(snapshots) {
		return errors.New("snapshot contains unlisted streams")
	}

	names, err := b.Snapshots.List(ctx)
	if err != nil {
		return fmt.Errorf("list restore target streams: %w", err)
	}

	if len(names) != 0 {
		return errors.New("restore target account must contain no streams")
	}

	for _, snapshot := range snapshots {
		file, err := os.Open(filepath.Join(directory, snapshot.Config.Name, "stream.tar.s2"))
		if err != nil {
			return fmt.Errorf("open snapshot archive for stream %q: %w", snapshot.Config.Name, err)
		}

		err = b.Snapshots.Restore(ctx, snapshot, file)
		closeErr := file.Close()

		if err != nil {
			return fmt.Errorf("restore stream %q: %w", snapshot.Config.Name, err)
		}

		if closeErr != nil {
			return fmt.Errorf("close snapshot archive for stream %q: %w", snapshot.Config.Name, closeErr)
		}
	}

	return nil
}
