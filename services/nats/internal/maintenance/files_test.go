package maintenance

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
)

type brokenReader struct{}

func (brokenReader) Read([]byte) (int, error) { return 0, errors.New("source failed") }

func TestDirectoryStoreAtomicWritesAndConfinement(t *testing.T) {
	directory := t.TempDir()

	store, err := OpenDirectoryStore(directory)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() { _ = store.Root.Close() })

	if err := store.Put(t.Context(), "LATEST", bytes.NewBufferString("working")); err != nil {
		t.Fatal(err)
	}

	if err := store.Put(t.Context(), "LATEST", brokenReader{}); err == nil {
		t.Fatal("failed write succeeded")
	}

	var data bytes.Buffer

	if err := store.Get(t.Context(), "LATEST", &data); err != nil || data.String() != "working" {
		t.Fatal("failed write replaced committed data", err)
	}

	outside := t.TempDir()

	if err := os.Symlink(outside, filepath.Join(directory, "escape")); err != nil {
		t.Fatal(err)
	}

	for _, key := range []string{"../escape", "/escape", "escape/file"} {
		if err := store.Put(t.Context(), key, bytes.NewBufferString("bad")); err == nil {
			t.Fatalf("write escaped directory: %s", key)
		}

		if err := store.Get(t.Context(), key, io.Discard); err == nil {
			t.Fatalf("read escaped directory: %s", key)
		}
	}

	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	if !errors.Is(store.Put(ctx, "cancelled", bytes.NewBufferString("bad")), context.Canceled) {
		t.Fatal("cancelled write succeeded")
	}

	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 2 {
		t.Fatal("temporary file leaked", err)
	}
}

func TestNativeBackupSurvivesDirectoryStoreReopen(t *testing.T) {
	source, js := snapshotServer(t)

	objects, err := js.CreateObjectStore(&nats.ObjectStoreConfig{Bucket: "files", Storage: nats.FileStorage})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := objects.PutBytes("asset", []byte("native content")); err != nil {
		t.Fatal(err)
	}

	directory := t.TempDir()

	store, err := OpenDirectoryStore(directory)
	if err != nil {
		t.Fatal(err)
	}

	backup := Backup{Snapshots: source, Store: store, Scratch: t.TempDir()}

	id, err := backup.Capture(t.Context())
	if err != nil {
		t.Fatal(err)
	}

	if err := store.Root.Close(); err != nil {
		t.Fatal(err)
	}

	store, err = OpenDirectoryStore(directory)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() { _ = store.Root.Close() })
	target, targetJS := snapshotServer(t)
	restore := Backup{Snapshots: target, Store: store, Scratch: t.TempDir()}

	if err := restore.Restore(t.Context(), id); err != nil {
		t.Fatal(err)
	}

	view, err := targetJS.ObjectStore("files")
	if err != nil {
		t.Fatal(err)
	}

	data, err := view.GetBytes("asset")
	if err != nil || string(data) != "native content" {
		t.Fatal("native object was not restored", err)
	}
}

func TestCertificateFilesAndExplicitNodeConfiguration(t *testing.T) {
	directory := t.TempDir()
	certificate, key := testCertificate(t, "localhost", time.Now().Add(48*time.Hour))
	certPath, keyPath := filepath.Join(directory, "cert.pem"), filepath.Join(directory, "key.pem")

	if err := os.WriteFile(certPath, certificate, 0o600); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(keyPath, key, 0o600); err != nil {
		t.Fatal(err)
	}

	certificates := Certificates{Root: t.TempDir(), Domain: "localhost", Local: true, Source: CertificateFiles(certPath, keyPath)}

	if err := certificates.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}

	if err := os.Remove(keyPath); err != nil {
		t.Fatal(err)
	}

	if err := certificates.Refresh(t.Context()); err == nil || !certificates.ValidFor(time.Hour) {
		t.Fatal("missing source replaced valid certificate")
	}

	configuration := filepath.Join(directory, "node.json")

	if err := os.WriteFile(configuration, []byte(`{"zone":"rack-a","advertiseIP":"192.0.2.1"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	env := map[string]string{"NATS_NODE_CONFIG_FILE": configuration, "NATS_SERVER_NAME": "test"}

	identity, err := Node(func(name string) string { return env[name] }, t.TempDir())
	if err != nil || identity.Zone != "rack-a" || identity.PrivateIP != "192.0.2.1" {
		t.Fatal("explicit node configuration not applied", identity, err)
	}

	if err := os.WriteFile(configuration, []byte(`{"zone":"rack-a","advertiseIP":"invalid"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := Node(func(name string) string { return env[name] }, t.TempDir()); err == nil {
		t.Fatal("invalid node configuration accepted")
	}
}
