package broker

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/admission"
	"github.com/lixpi/lixpi/services/nats/internal/auth"
	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
)

type faultEvaluator struct {
	mode        atomic.Int32
	count       atomic.Int64
	release     chan struct{}
	policy      *policy.Policy
	failProcess func()
}

func (e *faultEvaluator) Evaluate(ctx context.Context, request *jwt.AuthorizationRequestClaims) (*auth.Identity, error) {
	if request.ConnectOptions.Token == "hold" {
		<-e.release

		return nil, auth.ErrUnavailable
	}

	e.count.Add(1)

	switch e.mode.Load() {
	case 1:
		return nil, auth.ErrUnavailable
	case 2:
		return nil, auth.ErrDenied
	case 3:
		<-e.release

		return nil, auth.ErrUnavailable
	case 4:
		e.failProcess()

		return nil, auth.ErrUnavailable
	}

	permissions, err := e.policy.BrowserPermissions("verified-user")
	if err != nil {
		return nil, err
	}

	return &auth.Identity{Name: "verified-user", Account: "AUTH", Permissions: permissions}, nil
}

type admissionCluster struct {
	servers     []*server.Server
	connections []*nats.Conn
	dispatchers []*admission.Dispatcher
	workers     []*admission.Worker
	evaluators  []*faultEvaluator
}

func startAdmissionCluster(t *testing.T, count int, configure ...func(int, *admission.Settings)) *admissionCluster {
	t.Helper()

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

	signerSeed, err := signer.Seed()
	if err != nil {
		t.Fatal(err)
	}

	curveSeed, err := curve.Seed()
	if err != nil {
		t.Fatal(err)
	}

	protocol, err := auth.NewProtocol(string(signerSeed), string(curveSeed))
	if err != nil {
		t.Fatal(err)
	}

	xkey, err := curve.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	cluster := &admissionCluster{}

	for i := range count {
		node := fmt.Sprintf("node%d", i)
		options := &server.Options{
			Host: "127.0.0.1", Port: -1, ServerName: node, NoLog: true, NoSigs: true, AuthTimeout: 3,
			Accounts: []*server.Account{server.NewAccount("AUTH"), server.NewAccount("CALLOUT")},
			Cluster:  server.ClusterOpts{Name: "admission", Host: "127.0.0.1", Port: -1, PoolSize: -1},
		}

		if i > 0 {
			route, err := url.Parse("nats-route://" + cluster.servers[0].ClusterAddr().String())
			if err != nil {
				t.Fatal(err)
			}

			options.Routes = []*url.URL{route}
		}

		if err := ConfigureCallout(options, p, node, "bootstrap", protocol.Issuer, xkey); err != nil {
			t.Fatal(err)
		}

		instance, err := Start(options)
		if err != nil {
			t.Fatal(err)
		}

		t.Cleanup(func() { instance.Shutdown(); instance.WaitForShutdown() })

		connection, err := nats.Connect(
			"",
			nats.InProcessServer(instance),
			nats.UserInfo("auth_callout", "bootstrap"),
			nats.CustomInboxPrefix(p.Subjects.Protocol.Auth.Reply+"."+node),
			nats.NoReconnect(),
		)
		if err != nil {
			t.Fatal(err)
		}

		t.Cleanup(connection.Close)
		evaluator := &faultEvaluator{release: make(chan struct{}), policy: p}
		t.Cleanup(func() { close(evaluator.release) })

		worker, err := admission.NewWorker(evaluator, 2)
		if err != nil {
			t.Fatal(err)
		}

		settings := admission.Settings{
			Node:             node,
			Digest:           p.Digest,
			Policy:           p,
			Protocol:         protocol,
			Worker:           worker,
			Connection:       connection,
			MaxConcurrent:    16,
			MaxAttempts:      4,
			AttemptTimeout:   100 * time.Millisecond,
			AdmissionTimeout: 1500 * time.Millisecond,
			ResponseReserve:  50 * time.Millisecond,
		}

		for _, apply := range configure {
			apply(i, &settings)
		}

		dispatcher, err := admission.Start(settings)
		if err != nil {
			t.Fatal(err)
		}

		t.Cleanup(func() {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			_ = dispatcher.Stop(ctx)
		})
		cluster.servers = append(cluster.servers, instance)
		cluster.connections = append(cluster.connections, connection)
		cluster.dispatchers = append(cluster.dispatchers, dispatcher)
		cluster.workers = append(cluster.workers, worker)
		cluster.evaluators = append(cluster.evaluators, evaluator)
	}

	waitFor(t, func() bool {
		for i, instance := range cluster.servers {
			if instance.NumRoutes() < count-1 || !cluster.dispatchers[i].Ready() {
				return false
			}
		}

		return true
	})

	return cluster
}

func waitFor(t *testing.T, condition func() bool, timeout ...time.Duration) {
	t.Helper()
	limit := 5 * time.Second

	if len(timeout) > 0 {
		limit = timeout[0]
	}

	deadline := time.Now().Add(limit)

	for time.Now().Before(deadline) {
		if condition() {
			return
		}

		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("condition did not converge within %s", limit)
}

func connectAdmission(t *testing.T, instance *server.Server, allowed bool) {
	t.Helper()

	connection, err := nats.Connect(
		instance.ClientURL(),
		nats.Token("credential"),
		nats.NoReconnect(),
		nats.IgnoreDiscoveredServers(),
		nats.Timeout(2*time.Second),
	)
	if connection != nil {
		connection.Close()
	}

	if allowed && err != nil {
		t.Fatalf("original connection attempt failed: %v", err)
	}

	if !allowed && err == nil {
		t.Fatal("denied credential connected")
	}
}

func TestLocalFirstOverflowAndRetry(t *testing.T) {
	for _, count := range []int{3, 4} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			cluster := startAdmissionCluster(t, count)
			connectAdmission(t, cluster.servers[0], true)

			if cluster.evaluators[0].count.Load() != 1 || cluster.dispatchers[0].Counters.Remote.Load() != 0 {
				t.Fatal("healthy local work dispatched remotely")
			}

			cluster.evaluators[0].mode.Store(2)
			connectAdmission(t, cluster.servers[0], false)

			if cluster.dispatchers[0].Counters.Remote.Load() != 0 {
				t.Fatal("credential denial retried on a peer")
			}

			// Wait for authenticated advertisements before injecting operational failure.
			time.Sleep(300 * time.Millisecond)
			cluster.evaluators[0].mode.Store(3)
			started := time.Now()
			connectAdmission(t, cluster.servers[0], true)

			if time.Since(started) >= 1500*time.Millisecond || cluster.dispatchers[0].Counters.Retry.Load() == 0 {
				t.Fatal("stalled local worker was not retried inside the admission budget")
			}

			if cluster.workers[0].InFlight() != 1 {
				t.Fatal("cancel-ignoring verifier released its capacity early")
			}

			cluster.workers[0].SetHealthy(false)
			connectAdmission(t, cluster.servers[0], true)

			if cluster.dispatchers[0].Counters.Remote.Load() < 2 {
				t.Fatal("unhealthy local worker did not overflow")
			}

			for _, worker := range cluster.workers {
				worker.SetHealthy(false)
			}

			time.Sleep(300 * time.Millisecond)
			connectAdmission(t, cluster.servers[0], false)
		})
	}
}

func TestSelectedRemoteWorkerStallRetriesAnotherPeer(t *testing.T) {
	cluster := startAdmissionCluster(t, 3)
	cluster.workers[0].SetHealthy(false)
	cluster.evaluators[1].mode.Store(3)
	hold := &jwt.AuthorizationRequestClaims{ConnectOptions: jwt.ConnectOptions{Token: "hold"}}
	go func() { _, _ = cluster.workers[2].Evaluate(t.Context(), hold) }()
	waitFor(t, func() bool { return cluster.workers[2].InFlight() == 1 })
	time.Sleep(300 * time.Millisecond)
	connectAdmission(t, cluster.servers[0], true)

	if cluster.evaluators[1].count.Load() != 1 || cluster.evaluators[2].count.Load() != 1 {
		t.Fatal("remote stall did not retry the remaining peer")
	}

	if cluster.dispatchers[0].Counters.Remote.Load() != 2 {
		t.Fatal("unexpected remote attempt count")
	}
}

func TestPeerRejectsRegistrationRevisionChange(t *testing.T) {
	var changed atomic.Bool
	var peerReads atomic.Int64
	cluster := startAdmissionCluster(t, 2, func(node int, settings *admission.Settings) {
		settings.Resolve = func(_ context.Context, expected string) (*policy.Snapshot, error) {
			if node == 1 {
				peerReads.Add(1)

				if expected != "pinned" {
					return nil, errors.New("missing pinned revision")
				}

				if changed.Load() {
					return nil, errors.New("registration revision changed")
				}
			}

			return &policy.Snapshot{Revision: "pinned"}, nil
		}
	})
	cluster.workers[0].SetHealthy(false)
	time.Sleep(300 * time.Millisecond)
	connectAdmission(t, cluster.servers[0], true)

	if peerReads.Load() == 0 || cluster.evaluators[1].count.Load() != 1 {
		t.Fatal("peer did not resolve pinned registration")
	}

	changed.Store(true)
	connectAdmission(t, cluster.servers[0], false)

	if cluster.evaluators[1].count.Load() != 1 {
		t.Fatal("peer evaluated stale registration")
	}
}

func TestBootstrapRejectsOverlappingWildcard(t *testing.T) {
	cluster := startAdmissionCluster(t, 3)
	errorsSeen := make(chan error, 1)
	cluster.connections[0].SetErrorHandler(func(_ *nats.Conn, _ *nats.Subscription, err error) {
		select {
		case errorsSeen <- err:
		default:
		}
	})

	_, err := cluster.connections[0].SubscribeSync("$SYS.>")
	if err != nil {
		t.Fatal(err)
	}

	if err := cluster.connections[0].Flush(); err != nil {
		t.Fatal(err)
	}

	select {
	case <-errorsSeen:
	case <-time.After(time.Second):
		t.Fatal("overlapping bootstrap wildcard was not rejected")
	}
}

func TestSelectedRemoteProcessFailureRetriesOriginalConnection(t *testing.T) {
	cluster := startAdmissionCluster(t, 4)
	cluster.workers[0].SetHealthy(false)
	cluster.workers[3].SetHealthy(false)
	cluster.evaluators[1].failProcess = cluster.servers[1].Shutdown
	cluster.evaluators[1].mode.Store(4)
	hold := &jwt.AuthorizationRequestClaims{ConnectOptions: jwt.ConnectOptions{Token: "hold"}}
	go func() { _, _ = cluster.workers[2].Evaluate(t.Context(), hold) }()
	waitFor(t, func() bool { return cluster.workers[2].InFlight() == 1 })
	time.Sleep(300 * time.Millisecond)
	connectAdmission(t, cluster.servers[0], true)

	if cluster.evaluators[1].count.Load() != 1 || cluster.evaluators[2].count.Load() != 1 || cluster.dispatchers[0].Counters.Remote.Load() != 2 {
		t.Fatal("lost peer process did not retry within the original admission")
	}
}

func TestDispatcherFailureRejectsNewAdmissionsAndRetainsExistingSession(t *testing.T) {
	cluster := startAdmissionCluster(t, 3)

	client, err := nats.Connect(cluster.servers[0].ClientURL(), nats.Token("credential"), nats.NoReconnect(), nats.IgnoreDiscoveredServers())
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(client.Close)
	cluster.connections[0].Close()
	waitFor(t, func() bool { return !cluster.dispatchers[0].Ready() })
	connectAdmission(t, cluster.servers[0], false)

	if err := client.FlushTimeout(time.Second); err != nil {
		t.Fatal("dispatcher failure disconnected established session", err)
	}

	cluster.servers[0].Shutdown()
	waitFor(t, client.IsClosed)
	connectAdmission(t, cluster.servers[1], true)
}
