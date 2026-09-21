package admission

import (
	"bytes"
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/auth"
	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
)

func encryptedAdmission(t *testing.T, protocol *auth.Protocol) *nats.Msg {
	t.Helper()
	key := func(create func() (nkeys.KeyPair, error)) (nkeys.KeyPair, string) {
		t.Helper()

		pair, err := create()
		if err != nil {
			t.Fatal(err)
		}

		public, err := pair.PublicKey()
		if err != nil {
			t.Fatal(err)
		}

		return pair, public
	}
	serverKey, serverID := key(nkeys.CreateServer)
	serverCurve, serverXKey := key(nkeys.CreateCurveKeys)
	_, userID := key(nkeys.CreateUser)
	request := jwt.NewAuthorizationRequestClaims(protocol.Issuer)
	request.Audience = "nats-authorization-request"
	request.Expires = time.Now().Add(3 * time.Second).Unix()
	request.UserNkey = userID
	request.Server = jwt.ServerID{ID: serverID, XKey: serverXKey}

	encoded, err := request.Encode(serverKey)
	if err != nil {
		t.Fatal(err)
	}

	public, err := protocol.Curve.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	encrypted, err := serverCurve.Seal([]byte(encoded), public)
	if err != nil {
		t.Fatal(err)
	}

	return &nats.Msg{Data: encrypted, Header: nats.Header{"Nats-Server-Xkey": []string{serverXKey}}}
}

func TestCoordinatorRejectsStaleAndUnboundWorkerReplies(t *testing.T) {
	for _, mode := range []string{"node", "instance", "correlation", "attempt", "signature", "late", "deny"} {
		t.Run(mode, func(t *testing.T) {
			srv, err := server.NewServer(&server.Options{DontListen: true, NoSigs: true, NoLog: true})
			if err != nil {
				t.Fatal(err)
			}

			srv.Start()
			t.Cleanup(srv.Shutdown)

			if !srv.ReadyForConnections(time.Second) {
				t.Fatal("test broker unavailable")
			}

			connection, err := nats.Connect("", nats.InProcessServer(srv), nats.NoReconnect())
			if err != nil {
				t.Fatal(err)
			}

			t.Cleanup(connection.Close)

			p, err := policy.Transport()
			if err != nil {
				t.Fatal(err)
			}

			protocol := peerProtocol(t)

			worker, err := NewWorker(&stalledEvaluator{}, 1)
			if err != nil {
				t.Fatal(err)
			}

			worker.SetHealthy(false)
			d := &Dispatcher{ctx: t.Context(), settings: Settings{
				Node: "local", Digest: "policy", Policy: p, Protocol: protocol, Worker: worker, Connection: connection,
				MaxAttempts: 2, AttemptTimeout: 100 * time.Millisecond, AdmissionTimeout: time.Second, ResponseReserve: 50 * time.Millisecond,
			}, peers: map[string]peer{}}
			var firstReplies, secondReplies atomic.Int32

			for index, node := range []string{"first", "second"} {
				d.peers[node] = peer{
					Node: node, Instance: testIdentifier(t), Digest: "policy", Capacity: 2, InFlight: index, Available: true,
					received: time.Now(),
				}

				_, err := connection.Subscribe(p.Subjects.Protocol.Auth.Worker+"."+node, func(message *nats.Msg) {
					var work workRequest

					if err := verify(protocol, message.Data, &work); err != nil {
						t.Error(err)

						return
					}

					result := workReply{
						Kind:        "result",
						Node:        node,
						Instance:    work.Instance,
						Correlation: work.Correlation,
						Attempt:     work.Attempt,
						Status:      "allow",
						Response:    []byte(node),
					}

					if node == "first" {
						firstReplies.Add(1)

						switch mode {
						case "node":
							result.Node = "different-node"
						case "instance":
							result.Instance = testIdentifier(t)
						case "correlation":
							result.Correlation = "previous-admission"
						case "attempt":
							result.Attempt = testIdentifier(t)
						case "deny":
							result.Status = "deny"
						case "late":
							timer := time.NewTimer(200 * time.Millisecond)
							defer timer.Stop()

							select {
							case <-timer.C:
							case <-t.Context().Done():
								return
							}
						}
					} else {
						secondReplies.Add(1)
					}

					encoded, err := sign(protocol, result)
					if err != nil {
						t.Error(err)

						return
					}

					if mode == "signature" && node == "first" {
						encoded = bytes.Replace(encoded, []byte("allow"), []byte("deny"), 1)
					}

					_ = message.Respond(encoded)
				})
				if err != nil {
					t.Fatal(err)
				}
			}

			if err := connection.Flush(); err != nil {
				t.Fatal(err)
			}

			response := d.coordinate(encryptedAdmission(t, protocol))

			if mode == "deny" {
				if string(response) != "first" || secondReplies.Load() != 0 || d.Counters.Denied.Load() != 1 {
					t.Fatal("explicit remote denial was retried")
				}
			} else if string(response) != "second" || firstReplies.Load() != 1 || secondReplies.Load() != 1 || d.Counters.Retry.Load() != 1 {
				t.Fatal("invalid remote response was accepted or retry failed")
			}

			ctx, cancel := context.WithTimeout(t.Context(), time.Second)
			defer cancel()

			if mode == "late" {
				// Drain the test responder so its delayed reply cannot outlive this test.
				if err := connection.Drain(); err != nil {
					t.Fatal(err)
				}

				for !connection.IsClosed() {
					select {
					case <-ctx.Done():
						t.Fatal("late responder did not drain")
					case <-time.After(time.Millisecond):
					}
				}
			}
		})
	}
}
