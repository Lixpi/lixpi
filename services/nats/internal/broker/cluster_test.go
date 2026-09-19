package broker

import (
	"fmt"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/auth"
	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
)

func TestClusterKeepsCalloutLocal(t *testing.T) {
	for _, count := range []int{3, 4} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			p, err := policy.Transport()
			if err != nil {
				t.Fatal(err)
			}

			signer, err := nkeys.CreateAccount()
			if err != nil {
				t.Fatal(err)
			}

			curve, err := nkeys.CreateCurveKeys()
			if err != nil {
				t.Fatal(err)
			}

			issuerSeed, err := signer.Seed()
			if err != nil {
				t.Fatal(err)
			}

			curveSeed, err := curve.Seed()
			if err != nil {
				t.Fatal(err)
			}

			protocol, err := auth.NewProtocol(string(issuerSeed), string(curveSeed))
			if err != nil {
				t.Fatal(err)
			}

			xkey, err := curve.PublicKey()
			if err != nil {
				t.Fatal(err)
			}

			instances := make([]*server.Server, count)
			connections := make([]*nats.Conn, count)
			evaluated := make([]atomic.Int64, count)

			for node := range count {
				options := &server.Options{
					Host: "127.0.0.1", Port: -1, NoLog: true, NoSigs: true,
					ServerName: fmt.Sprintf("proof-%d", node), AuthTimeout: 3,
					Accounts: []*server.Account{server.NewAccount("AUTH"), server.NewAccount("CALLOUT")},
					Cluster:  server.ClusterOpts{Name: "proof", Host: "127.0.0.1", Port: -1, PoolSize: -1},
				}

				if node > 0 {
					route, err := url.Parse("nats-route://" + instances[0].ClusterAddr().String())
					if err != nil {
						t.Fatal(err)
					}

					options.Routes = []*url.URL{route}
				}

				if err := ConfigureCallout(options, p, fmt.Sprint(node), "test-bootstrap", protocol.Issuer, xkey); err != nil {
					t.Fatal(err)
				}

				instance, err := Start(options)
				if err != nil {
					t.Fatal(err)
				}

				t.Cleanup(func() { instance.Shutdown(); instance.WaitForShutdown() })
				instances[node] = instance

				connection, err := nats.Connect(
					"",
					nats.InProcessServer(instance),
					nats.UserInfo("auth_callout", "test-bootstrap"),
					nats.NoReconnect(),
					nats.CustomInboxPrefix(p.Subjects.Protocol.Auth.Reply+"."+fmt.Sprint(node)),
				)
				if err != nil {
					t.Fatal(err)
				}

				t.Cleanup(connection.Close)
				connections[node] = connection

				_, err = connection.QueueSubscribe(p.Subjects.Protocol.Auth.Request, p.Subjects.Protocol.Auth.Queue, func(message *nats.Msg) {
					request, err := protocol.Open(message.Data, message.Header.Get("Nats-Server-Xkey"))
					if err != nil {
						t.Error(err)

						return
					}

					evaluated[node].Add(1)

					permissions, err := p.BrowserPermissions("proof-user")
					if err != nil {
						t.Error(err)

						return
					}

					response, err := protocol.Reply(request, &auth.Identity{Name: "proof-user", Account: "AUTH", Permissions: permissions}, "")
					if err != nil {
						t.Error(err)

						return
					}

					if err := message.Respond(response); err != nil {
						t.Error(err)
					}
				})
				if err != nil {
					t.Fatal(err)
				}

				_, err = connection.Subscribe(p.Subjects.Protocol.Auth.Worker+"."+fmt.Sprint(node), func(message *nats.Msg) {
					if err := message.Respond([]byte("peer-reachable")); err != nil {
						t.Error(err)
					}
				})
				if err != nil {
					t.Fatal(err)
				}

				if err := connection.Flush(); err != nil {
					t.Fatal(err)
				}
			}

			deadline := time.Now().Add(5 * time.Second)

			for instances[0].NumRoutes() < count-1 && time.Now().Before(deadline) {
				time.Sleep(10 * time.Millisecond)
			}

			if instances[0].NumRoutes() < count-1 {
				t.Fatal("cluster did not form")
			}

			// Remote worker request/reply proves route interest has propagated before admission assertions.
			for node := 1; node < count; node++ {
				var err error

				for time.Now().Before(deadline) {
					var message *nats.Msg

					message, err = connections[0].Request(p.Subjects.Protocol.Auth.Worker+"."+fmt.Sprint(node), nil, 100*time.Millisecond)
					if err == nil && string(message.Data) == "peer-reachable" {
						break
					}

					time.Sleep(10 * time.Millisecond)
				}

				if err != nil {
					t.Fatal(err)
				}
			}

			for node, instance := range instances {
				for range 12 {
					client, err := nats.Connect(instance.ClientURL(), nats.Token("proof"), nats.NoReconnect(), nats.Timeout(2*time.Second))
					if err != nil {
						t.Fatal(err)
					}

					client.Close()
				}

				if evaluated[node].Load() != 12 {
					t.Fatalf("node %d evaluated %d local admissions", node, evaluated[node].Load())
				}
			}

			for node := range instances {
				if evaluated[node].Load() != 12 {
					t.Fatalf("node %d received remote callouts", node)
				}
			}

			if external, err := nats.Connect(
				instances[0].ClientURL(),
				nats.UserInfo("auth_callout", "test-bootstrap"),
				nats.NoReconnect(),
				nats.Timeout(time.Second),
			); err == nil {
				external.Close()
				t.Fatal("external bootstrap credentials accepted")
			}
		})
	}
}
