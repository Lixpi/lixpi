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

func (b *Backup) Capture(ctx context.Context) (string, error) {
	directory, err := os.MkdirTemp(b.Scratch, "nats-backup.")
	if err != nil {
		return "", err
	}

	defer func() { _ = os.RemoveAll(directory) }()
	id := time.Now().UTC().Format("20060102T150405Z") + "-" + rand.Text()

	names, err := b.Snapshots.List(ctx)
	if err != nil {
		return "", err
	}

	var inventory bytes.Buffer
	files := []string{"inventory.jsonl"}

	for _, name := range names {
		streamDir := filepath.Join(directory, name)

		if err := os.Mkdir(streamDir, 0o700); err != nil {
			return "", err
		}

		archivePath := filepath.Join(streamDir, "stream.tar.s2")

		file, err := os.OpenFile(archivePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return "", err
		}

		snapshot, err := b.Snapshots.Capture(ctx, name, file)
		closeErr := file.Close()

		if err != nil {
			return "", err
		}

		if closeErr != nil {
			return "", closeErr
		}

		metadata, err := json.Marshal(snapshot)
		if err != nil {
			return "", err
		}

		if err := os.WriteFile(filepath.Join(streamDir, "backup.json"), metadata, 0o600); err != nil {
			return "", err
		}

		snapshot.SnapshotID = id

		if err := json.NewEncoder(&inventory).Encode(snapshot); err != nil {
			return "", err
		}

		files = append(files, path.Join(name, "backup.json"), path.Join(name, "stream.tar.s2"))
	}

	after, err := b.Snapshots.List(ctx)
	if err != nil {
		return "", err
	}

	if !slices.Equal(names, after) {
		return "", errors.New("stream inventory changed during backup")
	}

	if err := os.WriteFile(filepath.Join(directory, "inventory.jsonl"), inventory.Bytes(), 0o600); err != nil {
		return "", err
	}

	var manifest strings.Builder

	for _, name := range files {
		digest, err := fileDigest(filepath.Join(directory, filepath.FromSlash(name)))
		if err != nil {
			return "", err
		}

		_, _ = fmt.Fprintf(&manifest, "%s  %s\n", digest, name)
	}

	if err := os.WriteFile(filepath.Join(directory, "SHA256SUMS"), []byte(manifest.String()), 0o600); err != nil {
		return "", err
	}

	for _, name := range append(files, "SHA256SUMS") {
		file, err := os.Open(filepath.Join(directory, filepath.FromSlash(name)))
		if err != nil {
			return "", err
		}

		err = b.Store.Put(ctx, path.Join(id, name), file)
		closeErr := file.Close()

		if err != nil {
			return "", err
		}

		if closeErr != nil {
			return "", closeErr
		}
	}

	if err := b.Store.Put(ctx, path.Join(id, "COMPLETE"), strings.NewReader(id+"\n")); err != nil {
		return "", err
	}

	if err := b.Store.Put(ctx, "LATEST", strings.NewReader(id+"\n")); err != nil {
		return "", err
	}

	return id, nil
}

func fileDigest(name string) (string, error) {
	file, err := os.Open(name)
	if err != nil {
		return "", err
	}

	defer func() { _ = file.Close() }()
	hash := sha256.New()

	if _, err := io.Copy(hash, file); err != nil {
		return "", err
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

	return count, err
}

func (b *Backup) readSmall(ctx context.Context, key string, limit int64) ([]byte, error) {
	var value bytes.Buffer
	err := b.Store.Get(ctx, key, &limitedWriter{target: &value, remaining: limit})

	return value.Bytes(), err
}

func (b *Backup) Restore(ctx context.Context, id string) error {
	if id == "" {
		latest, err := b.readSmall(ctx, "LATEST", 256)
		if err != nil {
			return err
		}

		id = strings.TrimSpace(string(latest))
	}

	if !snapshotName.MatchString(id) {
		return errors.New("invalid snapshot id")
	}

	complete, err := b.readSmall(ctx, path.Join(id, "COMPLETE"), 256)
	if err != nil {
		return err
	}

	if strings.TrimSpace(string(complete)) != id {
		return errors.New("incomplete snapshot")
	}

	manifest, err := b.readSmall(ctx, path.Join(id, "SHA256SUMS"), 8*1024*1024)
	if err != nil {
		return err
	}

	directory, err := os.MkdirTemp(b.Scratch, "nats-restore.")
	if err != nil {
		return err
	}

	defer func() { _ = os.RemoveAll(directory) }()
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
			return err
		}

		file, err := os.OpenFile(local, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}

		limit := int64(110 * 1024 * 1024 * 1024)

		if parts[len(parts)-1] != "stream.tar.s2" {
			limit = 8 * 1024 * 1024
		}

		err = b.Store.Get(ctx, path.Join(id, name), &limitedWriter{target: file, remaining: limit})
		closeErr := file.Close()

		if err != nil {
			return err
		}

		if closeErr != nil {
			return closeErr
		}

		actual, err := fileDigest(local)
		if err != nil {
			return err
		}

		if actual != expected {
			return errors.New("snapshot checksum mismatch")
		}
	}

	if err := scanner.Err(); err != nil {
		return err
	}

	if !files["inventory.jsonl"] {
		return errors.New("missing snapshot inventory")
	}

	inventory, err := os.ReadFile(filepath.Join(directory, "inventory.jsonl"))
	if err != nil {
		return err
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
			return err
		}

		name := snapshot.Config.Name
		if snapshot.SnapshotID != id || !streamName.MatchString(name) || seen[name] || !files[path.Join(name, "backup.json")] ||
			!files[path.Join(name, "stream.tar.s2")] {
			return errors.New("invalid snapshot inventory entry")
		}

		seen[name] = true

		metadata, err := os.ReadFile(filepath.Join(directory, name, "backup.json"))
		if err != nil {
			return err
		}

		var saved Snapshot

		if json.Unmarshal(metadata, &saved) != nil {
			return errors.New("invalid snapshot metadata")
		}

		left, _ := json.Marshal(Snapshot{Config: snapshot.Config, State: snapshot.State})

		right, _ := json.Marshal(Snapshot{Config: saved.Config, State: saved.State})
		if !bytes.Equal(left, right) {
			return errors.New("snapshot metadata differs from inventory")
		}

		stat, err := os.Stat(filepath.Join(directory, name, "stream.tar.s2"))
		if err != nil {
			return err
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
		return err
	}

	if len(names) != 0 {
		return errors.New("restore target account must contain no streams")
	}

	for _, snapshot := range snapshots {
		file, err := os.Open(filepath.Join(directory, snapshot.Config.Name, "stream.tar.s2"))
		if err != nil {
			return err
		}

		err = b.Snapshots.Restore(ctx, snapshot, file)
		closeErr := file.Close()

		if err != nil {
			return err
		}

		if closeErr != nil {
			return closeErr
		}
	}

	return nil
}
