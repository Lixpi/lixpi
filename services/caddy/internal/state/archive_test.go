package state

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

func TestSnapshotPreservesCompleteState(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "locks"), 0o700); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(root, "locks", "issue.lock"), []byte("invocation lock"), 0o600); err != nil {
		t.Fatal(err)
	}

	files := []string{
		"acme/ca/users/account.json",
		"certificates/ca/name/name.key",
		"certificates/ca/name/name.json",
		"pki/authorities/local/root.crt",
	}
	for _, path := range files {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(root, path)), 0o700); err != nil {
			t.Fatal(err)
		}

		if err := os.WriteFile(filepath.Join(root, path), []byte(path), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	data, err := Snapshot(root)
	if err != nil {
		t.Fatal(err)
	}

	restored := t.TempDir()
	if err := Restore(restored, data); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(restored, "locks")); !os.IsNotExist(err) {
		t.Fatal("transient lock was persisted")
	}

	for _, path := range files {
		content, err := os.ReadFile(filepath.Join(restored, path))
		if err != nil || string(content) != path {
			t.Fatalf("state lost: %s: %v", path, err)
		}

		info, err := os.Stat(filepath.Join(restored, path))
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("private state permissions: %v", err)
		}
	}
}

func archive(t *testing.T, name string, kind byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	zipped := gzip.NewWriter(&buffer)

	writer := tar.NewWriter(zipped)
	if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Typeflag: kind, Linkname: "outside"}); err != nil {
		t.Fatal(err)
	}

	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	if err := zipped.Close(); err != nil {
		t.Fatal(err)
	}

	return buffer.Bytes()
}

func TestArchiveRejectsUnsafeAndDamagedState(t *testing.T) {
	for _, test := range []struct {
		name string
		kind byte
	}{
		{"../outside", tar.TypeReg}, {"/outside", tar.TypeReg}, {"link", tar.TypeSymlink}, {"hardlink", tar.TypeLink},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := Restore(t.TempDir(), archive(t, test.name, test.kind)); err == nil {
				t.Fatal("unsafe archive accepted")
			}
		})
	}

	data := archive(t, "./account.json", tar.TypeReg)
	if err := Restore(t.TempDir(), data); err != nil {
		t.Fatalf("existing GNU tar path format rejected: %v", err)
	}

	oldState := t.TempDir()
	if err := Restore(oldState, archive(t, "./locks/old.lock", tar.TypeReg)); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(oldState, "locks")); !os.IsNotExist(err) {
		t.Fatal("previous invocation lock was restored")
	}

	data[len(data)-8] ^= 0xff
	if err := Restore(t.TempDir(), data); err == nil {
		t.Fatal("damaged gzip checksum accepted")
	}
}
