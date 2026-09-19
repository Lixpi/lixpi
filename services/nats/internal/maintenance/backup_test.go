package maintenance

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"path"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
)

type memoryStore struct {
	objects map[string][]byte
	fail    string
}

func (m *memoryStore) Put(_ context.Context, key string, source io.Reader) error {
	if path.Base(key) == m.fail {
		return errors.New("upload failed")
	}

	data, err := io.ReadAll(source)
	m.objects[key] = data

	return err
}

func (m *memoryStore) Get(_ context.Context, key string, target io.Writer) error {
	data, ok := m.objects[key]
	if !ok {
		return errors.New("missing object")
	}

	_, err := target.Write(data)

	return err
}

func snapshotServer(t *testing.T, enabled ...bool) (*Snapshots, nats.JetStreamContext) {
	t.Helper()
	jetstream := len(enabled) == 0 || enabled[0]

	instance, err := server.NewServer(
		&server.Options{Host: "127.0.0.1", Port: -1, NoLog: true, NoSigs: true, JetStream: jetstream, StoreDir: t.TempDir()},
	)
	if err != nil {
		t.Fatal(err)
	}

	instance.Start()

	if !instance.ReadyForConnections(5 * time.Second) {
		t.Fatal("broker did not start")
	}

	t.Cleanup(func() { instance.Shutdown(); instance.WaitForShutdown() })

	connection, err := nats.Connect("", nats.InProcessServer(instance))
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(connection.Close)

	js, err := connection.JetStream()
	if err != nil {
		t.Fatal(err)
	}

	p, err := policy.Transport()
	if err != nil {
		t.Fatal(err)
	}

	return &Snapshots{Connection: connection, Subjects: p.Subjects.Protocol.JetStream}, js
}

func TestBackupDuringWritesAndVerifiedRestore(t *testing.T) {
	source, js := snapshotServer(t)

	if _, err := js.AddStream(&nats.StreamConfig{Name: "messages", Subjects: []string{"messages"}, Storage: nats.FileStorage}); err != nil {
		t.Fatal(err)
	}

	if _, err := js.AddConsumer("messages", &nats.ConsumerConfig{Durable: "reader", AckPolicy: nats.AckExplicitPolicy}); err != nil {
		t.Fatal(err)
	}

	for range 100 {
		if _, err := js.Publish("messages", []byte("durable payload")); err != nil {
			t.Fatal(err)
		}
	}

	var writes atomic.Uint64
	ctx, stop := context.WithCancel(t.Context())
	var group sync.WaitGroup
	group.Go(func() {
		for ctx.Err() == nil {
			if _, err := js.Publish("messages", []byte("continuing write")); err != nil {
				return
			}

			writes.Add(1)
			time.Sleep(time.Millisecond)
		}
	})
	defer func() { stop(); group.Wait() }()
	store := &memoryStore{objects: map[string][]byte{}}
	backup := Backup{Snapshots: source, Store: store, Scratch: t.TempDir()}

	id, err := backup.Capture(t.Context())
	if err != nil {
		t.Fatal(err)
	}

	if writes.Load() == 0 {
		t.Fatal("writes did not continue during snapshot")
	}

	if string(store.objects["LATEST"]) != id+"\n" || string(store.objects[path.Join(id, "COMPLETE")]) != id+"\n" {
		t.Fatal("snapshot was not committed")
	}

	target, targetJS := snapshotServer(t)
	restore := Backup{Snapshots: target, Store: store, Scratch: t.TempDir()}

	if err := restore.Restore(t.Context(), ""); err != nil {
		t.Fatal(err)
	}

	info, err := targetJS.StreamInfo("messages")
	if err != nil || info.State.Msgs < 100 || info.State.Consumers != 1 {
		t.Fatalf("incomplete restored stream: %v %v", info, err)
	}

	message, err := targetJS.GetMsg("messages", 1)
	if err != nil || !bytes.Equal(message.Data, []byte("durable payload")) {
		t.Fatalf("payload mismatch: %v", err)
	}

	if err := restore.Restore(t.Context(), id); err == nil {
		t.Fatal("restore accepted a nonempty target")
	}

	clean, cleanJS := snapshotServer(t)
	restore.Snapshots = clean
	store.objects[path.Join(id, "messages", "stream.tar.s2")][0] ^= 1

	if err := restore.Restore(t.Context(), id); err == nil {
		t.Fatal("corrupt archive restored")
	}

	if _, err := cleanJS.StreamInfo("messages"); err == nil {
		t.Fatal("restore mutated target before checksum verification")
	}
}

func TestFailedUploadDoesNotAdvanceLatest(t *testing.T) {
	source, _ := snapshotServer(t)
	store := &memoryStore{objects: map[string][]byte{"LATEST": []byte("previous\n")}, fail: "COMPLETE"}
	backup := Backup{Snapshots: source, Store: store, Scratch: t.TempDir()}

	if _, err := backup.Capture(t.Context()); err == nil {
		t.Fatal("failed upload succeeded")
	}

	if string(store.objects["LATEST"]) != "previous\n" {
		t.Fatal("failed backup advanced LATEST")
	}
}

func TestInventoryPaginationAndInvalidPages(t *testing.T) {
	for _, mode := range []string{"valid", "duplicate", "no-progress", "unsafe-name"} {
		t.Run(mode, func(t *testing.T) {
			source, _ := snapshotServer(t, false)
			// Keep the fake inventory endpoint outside the broker's reserved JetStream service import.
			source.Subjects.StreamList = "test.inventory"
			var calls atomic.Int32

			_, err := source.Connection.Subscribe(source.Subjects.StreamList, func(message *nats.Msg) {
				calls.Add(1)
				var request struct {
					Offset int `json:"offset"`
				}

				if err := json.Unmarshal(message.Data, &request); err != nil {
					t.Error(err)

					return
				}

				names := []string{"first", "second", "third"}

				if mode == "duplicate" {
					names[2] = names[0]
				}

				if mode == "unsafe-name" {
					names[2] = "../outside"
				}

				page := names[request.Offset:min(request.Offset+2, len(names))]

				if mode == "no-progress" && request.Offset > 0 {
					page = nil
				}

				response := server.JSApiStreamListResponse{}
				response.Total, response.Offset, response.Limit = 3, request.Offset, 2

				for _, name := range page {
					response.Streams = append(
						response.Streams,
						&server.StreamInfo{Config: server.StreamConfig{Name: name, Storage: server.FileStorage}},
					)
				}

				encoded, err := json.Marshal(response)
				if err != nil {
					t.Error(err)

					return
				}

				if err := message.Respond(encoded); err != nil {
					t.Error(err)
				}
			})
			if err != nil {
				t.Fatal(err)
			}

			if err := source.Connection.Flush(); err != nil {
				t.Fatal(err)
			}

			ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
			defer cancel()
			names, err := source.List(ctx)

			if mode == "valid" {
				if err != nil || len(names) != 3 || calls.Load() != 2 {
					t.Fatal("paginated inventory failed", err)
				}
			} else if err == nil {
				t.Fatal("invalid inventory accepted")
			}
		})
	}
}
