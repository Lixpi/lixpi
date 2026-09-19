package maintenance

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
)

func TestSnapshotCompatibilityWithNATSCLI(t *testing.T) {
	instance, err := server.NewServer(&server.Options{Host: "127.0.0.1", Port: -1, NoLog: true, NoSigs: true, JetStream: true, StoreDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}

	instance.Start()

	if !instance.ReadyForConnections(5 * time.Second) {
		t.Fatal("broker not ready")
	}

	t.Cleanup(func() { instance.Shutdown(); instance.WaitForShutdown() })

	connection, err := nats.Connect(instance.ClientURL())
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(connection.Close)

	js, err := connection.JetStream()
	if err != nil {
		t.Fatal(err)
	}

	if _, err := js.AddStream(&nats.StreamConfig{Name: "COMPAT", Subjects: []string{"compat"}, Storage: nats.FileStorage}); err != nil {
		t.Fatal(err)
	}

	if _, err := js.Publish("compat", []byte("compatible payload")); err != nil {
		t.Fatal(err)
	}

	if _, err := js.AddConsumer("COMPAT", &nats.ConsumerConfig{Durable: "saved", AckPolicy: nats.AckExplicitPolicy}); err != nil {
		t.Fatal(err)
	}

	runCLI := func(args ...string) {
		t.Helper()
		command := exec.CommandContext(t.Context(), "nats", append([]string{"--server", instance.ClientURL()}, args...)...)

		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("snapshot CLI: %v: %s", err, output)
		}
	}
	directory := t.TempDir()
	runCLI("stream", "backup", "COMPAT", directory)

	metadata, err := os.ReadFile(filepath.Join(directory, "backup.json"))
	if err != nil {
		t.Fatal(err)
	}

	var snapshot Snapshot

	if err := json.Unmarshal(metadata, &snapshot); err != nil {
		t.Fatal(err)
	}

	archive, err := os.Open(filepath.Join(directory, "stream.tar.s2"))
	if err != nil {
		t.Fatal(err)
	}

	defer func() { _ = archive.Close() }()

	if err := js.DeleteStream("COMPAT"); err != nil {
		t.Fatal(err)
	}

	p, err := policy.Transport()
	if err != nil {
		t.Fatal(err)
	}

	snapshots := &Snapshots{Connection: connection, Subjects: p.Subjects.Protocol.JetStream}

	if err := snapshots.Restore(t.Context(), snapshot, archive); err != nil {
		t.Fatal("Go could not restore CLI snapshot", err)
	}

	var goArchive bytes.Buffer

	goSnapshot, err := snapshots.Capture(t.Context(), "COMPAT", &goArchive)
	if err != nil {
		t.Fatal(err)
	}

	goMetadata, err := json.Marshal(goSnapshot)
	if err != nil {
		t.Fatal(err)
	}

	goDirectory := t.TempDir()

	if err := os.WriteFile(filepath.Join(goDirectory, "backup.json"), goMetadata, 0o600); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(goDirectory, "stream.tar.s2"), goArchive.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := js.DeleteStream("COMPAT"); err != nil {
		t.Fatal(err)
	}

	runCLI("stream", "restore", goDirectory)

	message, err := js.GetMsg("COMPAT", 1)
	if err != nil || string(message.Data) != "compatible payload" {
		t.Fatal("CLI restore lost payload", err)
	}

	consumer, err := js.ConsumerInfo("COMPAT", "saved")
	if err != nil || consumer.NumPending != 1 {
		t.Fatal("CLI restore lost consumer", err)
	}
}
