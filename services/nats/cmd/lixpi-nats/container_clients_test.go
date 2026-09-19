package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/maintenance"
	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
)

func containerTargets(t *testing.T) ([]string, string) {
	t.Helper()

	targets, fixture := os.Getenv("NATS_TEST_TARGETS"), os.Getenv("NATS_TEST_CLIENT_FIXTURE")
	if targets == "" || fixture == "" {
		t.Skip("requires isolated production-image targets and synthetic fixture")
	}

	addresses := strings.Split(targets, ",")

	for _, address := range addresses {
		parsed, err := url.Parse(address)
		if err != nil || !strings.HasPrefix(parsed.Hostname(), "lixpi-nats-embedded-proof") {
			t.Fatal("container tests require explicitly named disposable proof brokers")
		}
	}

	connection, err := nats.Connect(
		strings.Join(addresses, ","),
		nats.UserInfo("registration", "synthetic-registration"),
		nats.CustomInboxPrefix(policy.RegistrationInbox),
		nats.Timeout(2*time.Second),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()

	registration, err := os.ReadFile(filepath.Join(fixture, "registration.json"))
	if err != nil {
		t.Fatal(err)
	}

	response, err := connection.Request(policy.RegistrationSubject, registration, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}

	var applied policy.ApplyResponse
	if err := json.Unmarshal(response.Data, &applied); err != nil || applied.Error != "" {
		t.Fatal("registration failed", applied.Error, err)
	}

	return addresses, fixture
}

func containerIdentity(t *testing.T, fixture, profile string, native bool) nats.Option {
	t.Helper()

	seed, err := os.ReadFile(filepath.Join(fixture, profile+".seed"))
	if err != nil {
		t.Fatal(err)
	}

	key, err := nkeys.FromSeed(seed)
	if err != nil {
		t.Fatal(err)
	}

	public, err := key.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	if native {
		return nats.Nkey(public, key.Sign)
	}

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"EdDSA","typ":"JWT"}`))

	claims, err := json.Marshal(
		map[string]any{
			"iss": public,
			"sub": "svc:" + strings.ReplaceAll(strings.ToLower(profile), "_", "-"),
			"exp": time.Now().Add(time.Minute).Unix(),
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	body := header + "." + base64.RawURLEncoding.EncodeToString(claims)

	signature, err := key.Sign([]byte(body))
	if err != nil {
		t.Fatal(err)
	}

	return nats.Token(body + "." + base64.RawURLEncoding.EncodeToString(signature))
}

func TestContainerServicePermissions(t *testing.T) {
	addresses, fixture := containerTargets(t)
	connect := func(profile string, native bool) *nats.Conn {
		connection, err := nats.Connect(
			strings.Join(addresses, ","),
			containerIdentity(t, fixture, profile, native),
			nats.NoReconnect(),
			nats.Timeout(2*time.Second),
		)
		if err != nil {
			t.Fatal(profile, err)
		}

		t.Cleanup(connection.Close)

		return connection
	}
	api := connect("API", false)
	worker := connect("FILE_CONVERSION", false)
	fidelity := connect("CHARACTER_FIDELITY", false)
	backup := connect("BACKUP", true)
	nex := connect("NEX_NODE", true)

	apiJS, err := api.JetStream()
	if err != nil {
		t.Fatal(err)
	}

	workerJS, err := worker.JetStream()
	if err != nil {
		t.Fatal(err)
	}

	fidelityJS, err := fidelity.JetStream()
	if err != nil {
		t.Fatal(err)
	}

	bucket := "embedded_proof"
	phase := os.Getenv("NATS_TEST_PHASE")
	var store nats.ObjectStore

	if phase == "verify" {
		store, err = apiJS.ObjectStore(bucket)
	} else {
		store, err = apiJS.CreateObjectStore(&nats.ObjectStoreConfig{Bucket: bucket, Replicas: 3, Storage: nats.FileStorage})
	}

	if err != nil {
		t.Fatal(err)
	}

	workerStore, err := workerJS.ObjectStore(bucket)
	if err != nil {
		t.Fatal(err)
	}

	if phase != "verify" {
		if _, err := workerStore.PutBytes("payload", []byte("auth-account-preserved")); err != nil {
			t.Fatal(err)
		}
	}

	for _, js := range []nats.JetStreamContext{apiJS, workerJS, fidelityJS} {
		view, err := js.ObjectStore(bucket)
		if err != nil {
			t.Fatal(err)
		}

		payload, err := view.GetBytes("payload")
		if err != nil || string(payload) != "auth-account-preserved" {
			t.Fatal("cross-service object read failed", err)
		}
	}

	if status, err := store.Status(); err != nil || status.BackingStore() != "JetStream" {
		t.Fatal("object store is not persistent", err)
	}

	p, err := policy.Transport()
	if err != nil {
		t.Fatal(err)
	}

	if _, err := backup.Request(p.Subjects.Protocol.JetStream.StreamList, []byte(`{}`), time.Second); err != nil {
		t.Fatal("backup inventory failed", err)
	}

	inbox := "_INBOX.account-isolation"

	sub, err := api.SubscribeSync(inbox)
	if err != nil {
		t.Fatal(err)
	}

	if err := api.Flush(); err != nil {
		t.Fatal(err)
	}

	if err := nex.Publish(inbox, []byte("must stay in NEX")); err != nil {
		t.Fatal(err)
	}

	if err := nex.Flush(); err != nil {
		t.Fatal(err)
	}

	if _, err := sub.NextMsg(100 * time.Millisecond); err == nil {
		t.Fatal("NEX leaked into AUTH")
	}

	errors := make(chan error, 1)
	api.SetErrorHandler(func(_ *nats.Conn, _ *nats.Subscription, err error) {
		select {
		case errors <- err:
		default:
		}
	})

	if _, err := api.SubscribeSync(p.Subjects.Protocol.Auth.Request); err != nil {
		t.Fatal(err)
	}

	if err := api.Flush(); err != nil {
		t.Fatal(err)
	}

	select {
	case <-errors:
	case <-time.After(time.Second):
		t.Fatal("service subscribed to auth callout")
	}

	if phase != "seed" {
		if err := apiJS.DeleteObjectStore(bucket); err != nil {
			t.Fatal(err)
		}
	}
}

func TestContainerAdmissionBurst(t *testing.T) {
	addresses, fixture := containerTargets(t)
	credential := containerIdentity(t, fixture, "API", false)
	var lock sync.Mutex
	var latencies []time.Duration
	failures := 0
	var group sync.WaitGroup
	started := time.Now()

	for range 16 {
		group.Go(func() {
			for attempt := range 16 {
				begin := time.Now()
				connection, err := nats.Connect(
					addresses[attempt%len(addresses)],
					credential,
					nats.NoReconnect(),
					nats.IgnoreDiscoveredServers(),
					nats.Timeout(2*time.Second),
				)
				elapsed := time.Since(begin)

				if connection != nil {
					connection.Close()
				}

				lock.Lock()
				if err != nil {
					failures++
				}

				latencies = append(latencies, elapsed)
				lock.Unlock()
			}
		})
	}

	group.Wait()
	slices.Sort(latencies)
	t.Logf(
		"Docker synthetic service-JWT admissions: attempts=%d concurrency=16 failures=%d elapsed=%s p50=%s p95=%s p99=%s",
		len(latencies),
		failures,
		time.Since(started),
		latencies[len(latencies)/2],
		latencies[len(latencies)*95/100],
		latencies[len(latencies)*99/100],
	)

	if failures != 0 {
		t.Fatal("admission burst failed")
	}
}

func TestContainerNativeBackupRestore(t *testing.T) {
	addresses, fixture := containerTargets(t)
	connect := func(profile string) *nats.Conn {
		t.Helper()

		connection, err := nats.Connect(
			strings.Join(addresses, ","),
			containerIdentity(t, fixture, profile, true),
			nats.NoReconnect(),
			nats.Timeout(2*time.Second),
		)
		if err != nil {
			t.Fatal(err)
		}

		t.Cleanup(connection.Close)

		return connection
	}
	operator, backup := connect("OPERATOR"), connect("BACKUP")

	js, err := operator.JetStream()
	if err != nil {
		t.Fatal(err)
	}

	name := "embedded_backup_proof"

	if _, err := js.AddStream(
		&nats.StreamConfig{Name: name, Subjects: []string{"$O." + name + ".C.proof"}, Replicas: 3, Storage: nats.FileStorage},
	); err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() { _ = js.DeleteStream(name) })

	if _, err := js.Publish("$O."+name+".C.proof", []byte("native-backup-payload")); err != nil {
		t.Fatal(err)
	}

	p, err := policy.Transport()
	if err != nil {
		t.Fatal(err)
	}

	source := &maintenance.Snapshots{Connection: backup, Subjects: p.Subjects.Protocol.JetStream}
	var archive bytes.Buffer

	snapshot, err := source.Capture(t.Context(), name, &archive)
	if err != nil {
		t.Fatal("scoped backup capture failed", err)
	}

	if err := js.DeleteStream(name); err != nil {
		t.Fatal(err)
	}

	target := &maintenance.Snapshots{Connection: operator, Subjects: p.Subjects.Protocol.JetStream}

	if err := target.Restore(t.Context(), *snapshot, &archive); err != nil {
		t.Fatal("scoped native restore failed", err)
	}

	message, err := js.GetMsg(name, 1)
	if err != nil || string(message.Data) != "native-backup-payload" {
		t.Fatal("native snapshot payload mismatch", err)
	}
}
