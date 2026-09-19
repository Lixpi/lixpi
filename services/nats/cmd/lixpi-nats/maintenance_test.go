package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
)

func TestNativeMaintenanceCommandsUseMountedDirectory(t *testing.T) {
	key, err := nkeys.CreateUser()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Wipe()

	public, err := key.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	seed, err := key.Seed()
	if err != nil {
		t.Fatal(err)
	}

	start := func() (*server.Server, nats.JetStreamContext) {
		t.Helper()

		instance, err := server.NewServer(
			&server.Options{
				Host:      "127.0.0.1",
				Port:      -1,
				NoSigs:    true,
				NoLog:     true,
				JetStream: true,
				StoreDir:  t.TempDir(),
				Nkeys:     []*server.NkeyUser{{Nkey: public}},
			},
		)
		if err != nil {
			t.Fatal(err)
		}

		instance.Start()

		if !instance.ReadyForConnections(5 * time.Second) {
			t.Fatal("broker failed to start")
		}

		t.Cleanup(func() { instance.Shutdown(); instance.WaitForShutdown() })

		connection, err := nats.Connect(instance.ClientURL(), nats.Nkey(public, key.Sign))
		if err != nil {
			t.Fatal(err)
		}

		t.Cleanup(connection.Close)

		js, err := connection.JetStream()
		if err != nil {
			t.Fatal(err)
		}

		return instance, js
	}
	source, sourceJS := start()

	if _, err := sourceJS.AddStream(&nats.StreamConfig{Name: "events", Subjects: []string{"events"}, Storage: nats.FileStorage}); err != nil {
		t.Fatal(err)
	}

	if _, err := sourceJS.Publish("events", []byte("persisted event")); err != nil {
		t.Fatal(err)
	}

	directory := t.TempDir()
	t.Setenv("NATS_URL", source.ClientURL())
	t.Setenv("NATS_BACKUP_NKEY_SEED", string(seed))
	t.Setenv("NATS_OPERATOR_NKEY_SEED", string(seed))
	t.Setenv("NATS_SNAPSHOT_DIR", directory)
	t.Setenv("NATS_BACKUP_SCRATCH", t.TempDir())

	if err := recovery(t.Context(), "backup", nil); err != nil {
		t.Fatal(err)
	}

	id, err := os.ReadFile(filepath.Join(directory, "LATEST"))
	if err != nil || strings.TrimSpace(string(id)) == "" {
		t.Fatal("backup did not publish LATEST", err)
	}

	target, targetJS := start()
	t.Setenv("NATS_URL", target.ClientURL())

	if err := recovery(t.Context(), "restore", nil); err != nil {
		t.Fatal(err)
	}

	message, err := targetJS.GetMsg("events", 1)
	if err != nil || string(message.Data) != "persisted event" {
		t.Fatal("native event was not restored", err)
	}

	if err := recovery(t.Context(), "restore", nil); err == nil {
		t.Fatal("restoration overwrote a nonempty account")
	}
}
