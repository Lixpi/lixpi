package broker

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/maintenance"
	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
)

func TestLiveScaleInPreservesSingleReplicaAndConcurrentWrites(t *testing.T) {
	var routes []string
	var ports []int

	for range 4 {
		listener, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}

		port := listener.Addr().(*net.TCPAddr).Port
		ports = append(ports, port)
		routes = append(routes, fmt.Sprintf("'nats://127.0.0.1:%d'", port))

		if err := listener.Close(); err != nil {
			t.Fatal(err)
		}
	}

	var instances []*server.Server
	var options []*server.Options

	for node := range 4 {
		root := t.TempDir()
		config := fmt.Sprintf(`server_name: node-%d
port: -1
server_tags: ["server:node-%d", "az:%d"]
jetstream { store_dir: '%s', unique_tag: 'az:' }
accounts { SYS { users: [{user: sys, password: test}] }, AUTH { jetstream: enabled, users: [{user: app, password: test}] } }
system_account: SYS
cluster { name: scaling, host: '127.0.0.1', port: %d, routes: [%s] }
`, node, node, node%3, filepath.Join(root, "data"), ports[node], strings.Join(routes, ","))
		file := filepath.Join(root, "nats.conf")

		if err := os.WriteFile(file, []byte(config), 0o600); err != nil {
			t.Fatal(err)
		}

		opts, err := server.ProcessConfigFile(file)
		if err != nil {
			t.Fatal(err)
		}

		opts.NoLog, opts.NoSigs = true, true

		instance, err := Start(opts)
		if err != nil {
			t.Fatal(err)
		}

		t.Cleanup(func() { instance.Shutdown(); instance.WaitForShutdown() })
		instances, options = append(instances, instance), append(options, opts)
	}

	connect := func(user string) *nats.Conn {
		t.Helper()

		connection, err := nats.Connect("", nats.InProcessServer(instances[0]), nats.UserInfo(user, "test"))
		if err != nil {
			t.Fatal(err)
		}

		t.Cleanup(connection.Close)

		return connection
	}

	js, err := connect("app").JetStream(nats.MaxWait(5 * time.Second))
	if err != nil {
		t.Fatal(err)
	}

	system := connect("sys")
	waitFor(t, func() bool {
		leader := ""

		for _, instance := range instances {
			info, err := instance.Jsz(nil)
			if err != nil || info.Meta == nil || info.Meta.Leader == "" || info.Meta.Size != 4 || !instance.JetStreamIsCurrent() {
				return false
			}

			if leader != "" && info.Meta.Leader != leader {
				return false
			}

			leader = info.Meta.Leader

			if instance.JetStreamIsLeader() {
				if len(info.Meta.Replicas) != 3 {
					return false
				}

				for _, peer := range info.Meta.Replicas {
					if !peer.Current || peer.Offline || peer.Pending {
						return false
					}
				}
			}
		}

		return true
	}, 15*time.Second)

	if _, err := js.AddStream(
		&nats.StreamConfig{
			Name:      "SINGLE",
			Subjects:  []string{"single"},
			Storage:   nats.FileStorage,
			Replicas:  1,
			Placement: &nats.Placement{Tags: []string{"server:node-3"}},
		},
	); err != nil {
		t.Fatal(err)
	}

	if _, err := js.AddStream(&nats.StreamConfig{Name: "LIVE", Subjects: []string{"live"}, Storage: nats.FileStorage, Replicas: 3}); err != nil {
		t.Fatal(err)
	}

	if _, err := js.Publish("single", []byte("retained-content")); err != nil {
		t.Fatal(err)
	}

	if _, err := js.AddConsumer("SINGLE", &nats.ConsumerConfig{Durable: "saved", AckPolicy: nats.AckExplicitPolicy}); err != nil {
		t.Fatal(err)
	}

	if _, err := js.UpdateStream(
		&nats.StreamConfig{Name: "SINGLE", Subjects: []string{"single"}, Storage: nats.FileStorage, Replicas: 1},
	); err != nil {
		t.Fatal(err)
	}

	runtime := &Runtime{
		Server:  instances[3],
		options: options[3],
		config:  RuntimeConfig{Identity: maintenance.NodeIdentity{Name: "node-3", Zone: "0"}},
	}

	if err := runtime.Fence(true); err != nil {
		t.Fatal(err)
	}

	waitFor(t, func() bool {
		_, err := js.AddStream(
			&nats.StreamConfig{
				Name:      "PROBE",
				Subjects:  []string{"probe"},
				Storage:   nats.FileStorage,
				Replicas:  1,
				MaxBytes:  1024,
				Placement: &nats.Placement{Tags: []string{"server:node-3"}},
			},
		)
		var apiError *nats.APIError

		if errors.As(err, &apiError) && apiError.ErrorCode == 10005 {
			return true
		}

		if err == nil {
			_ = js.DeleteStream("PROBE")
		}

		return false
	})

	p, err := policy.Transport()
	if err != nil {
		t.Fatal(err)
	}

	request := func(subject string) bool {
		t.Helper()

		message, err := system.Request(subject, []byte(`{"peer":"node-3"}`), 5*time.Second)
		if err != nil {
			t.Logf("%s: %v", subject, err)

			return false
		}

		var response struct {
			Success bool `json:"success"`
		}

		if err := json.Unmarshal(message.Data, &response); err != nil || !response.Success {
			t.Logf("%s: %s", subject, message.Data)

			return false
		}

		return true
	}
	if !request(p.Subjects.Protocol.JetStream.ServerEvacuate) {
		t.Fatal("evacuation rejected")
	}

	writes := 0
	waitFor(t, func() bool {
		if _, err := js.Publish("live", []byte("during-evacuation")); err != nil {
			t.Fatal(err)
		}

		writes++
		info, err := instances[3].Jsz(nil)

		return err == nil && info.Streams == 0 && info.Consumers == 0
	})
	waitFor(t, func() bool {
		info, err := js.StreamInfo("LIVE")
		if err != nil || info.Cluster == nil || len(info.Cluster.Replicas) != 2 {
			return false
		}

		for _, replica := range info.Cluster.Replicas {
			if !replica.Current || replica.Offline {
				return false
			}
		}

		return true
	})
	waitFor(t, func() bool {
		if request(p.Subjects.Protocol.JetStream.ServerRemove) {
			return true
		}

		info, err := instances[3].Jsz(nil)

		return err == nil && info.Disabled
	}, 15*time.Second)

	message, err := js.GetMsg("SINGLE", 1)
	if err != nil || string(message.Data) != "retained-content" {
		t.Fatal("R1 data lost during evacuation", err)
	}

	consumer, err := js.ConsumerInfo("SINGLE", "saved")
	if err != nil || consumer.NumPending != 1 {
		t.Fatal("consumer lost during evacuation", err)
	}

	if _, err := js.Publish("live", []byte("after-evacuation")); err != nil {
		t.Fatal(err)
	}

	if writes == 0 {
		t.Fatal("no concurrent writes")
	}
}
