package policy

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
)

func TestRegistrationVersionsPersistenceAndAuthoritativeReads(t *testing.T) {
	trust, key, manifest := signedFixture(t)
	directory := t.TempDir()
	start := func() (*Store, func()) {
		t.Helper()

		srv, err := server.NewServer(&server.Options{Host: "127.0.0.1", Port: -1, NoLog: true, NoSigs: true, JetStream: true, StoreDir: directory})
		if err != nil {
			t.Fatal(err)
		}

		srv.Start()

		if !srv.ReadyForConnections(5 * time.Second) {
			t.Fatal("broker unavailable")
		}

		connection, err := nats.Connect(srv.ClientURL())
		if err != nil {
			t.Fatal(err)
		}

		js, err := connection.JetStream(nats.MaxWait(time.Second))
		if err != nil {
			t.Fatal(err)
		}

		return &Store{JS: js, Trust: trust, Replicas: 1}, func() { connection.Close(); srv.Shutdown(); srv.WaitForShutdown() }
	}
	store, stop := start()
	signed := signFixture(t, key, manifest)

	sequence, err := store.Apply(t.Context(), ApplyRequest{Registration: signed})
	if err != nil {
		stop()
		t.Fatal(err)
	}

	first, err := store.Resolve(t.Context(), "")
	if err != nil || first.Services[0].UserID != "unexpected-client" {
		stop()
		t.Fatal("registration not resolved", err)
	}

	if same, err := store.Apply(t.Context(), ApplyRequest{Registration: signed}); err != nil || same != sequence {
		stop()
		t.Fatal("registration not idempotent", err)
	}

	manifest.Version++
	manifest.Services[0].Permissions.Pub.Allow[0] = "changed.request"

	next := signFixture(t, key, manifest)
	if _, err := store.Apply(t.Context(), ApplyRequest{Registration: next}); err == nil {
		stop()
		t.Fatal("stale compare-and-swap accepted")
	}

	if _, err := store.Apply(t.Context(), ApplyRequest{Registration: next, ExpectedRevision: sequence}); err != nil {
		stop()
		t.Fatal(err)
	}

	if _, err := store.Apply(t.Context(), ApplyRequest{Registration: signed}); err == nil {
		stop()
		t.Fatal("old replica rolled policy back")
	}

	if _, err := store.Resolve(t.Context(), first.Revision); err == nil {
		stop()
		t.Fatal("peer evaluated changed revision")
	}

	stop()
	store, stop = start()
	defer stop()

	snapshot, err := store.Resolve(t.Context(), "")
	if err != nil || snapshot.Services[0].Permissions.Pub.Allow[0] != "changed.request" {
		t.Fatal("registration lost on restart", err)
	}

	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	if _, err := store.Resolve(ctx, ""); err == nil {
		t.Fatal("cached state bypassed authoritative read")
	}

	bad, err := json.Marshal([]SignedRegistration{{Issuer: "untrusted"}})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := store.JS.Publish(RegistrySubject, bad); err != nil {
		t.Fatal(err)
	}

	if _, err := store.Resolve(t.Context(), ""); err == nil {
		t.Fatal("corrupted durable state accepted")
	}
}
