package admission

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/auth"
	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/nats.go"
)

type Settings struct {
	Resolve          func(context.Context, string) (*policy.Snapshot, error)
	Node             string
	Digest           string
	Policy           *policy.Policy
	Protocol         *auth.Protocol
	Worker           *Worker
	Connection       *nats.Conn
	MaxConcurrent    int
	MaxAttempts      int
	AttemptTimeout   time.Duration
	AdmissionTimeout time.Duration
	ResponseReserve  time.Duration
}

type Counters struct {
	Completed          atomic.Uint64
	ElapsedNanoseconds atomic.Uint64
	Local              atomic.Uint64
	Remote             atomic.Uint64
	Retry              atomic.Uint64
	Denied             atomic.Uint64
	Timeout            atomic.Uint64
	Busy               atomic.Uint64
}

type Dispatcher struct {
	settings      Settings
	instance      string
	ctx           context.Context
	cancel        context.CancelFunc
	slots         chan struct{}
	rpcSlots      chan struct{}
	subscriptions []*nats.Subscription
	mu            sync.Mutex
	peers         map[string]peer
	sequence      atomic.Uint64
	ready         atomic.Bool
	healthy       atomic.Bool
	withdrawing   atomic.Bool
	stopping      atomic.Bool
	loopDone      chan struct{}
	Counters      Counters
}

func Start(ctx context.Context, settings Settings) (*Dispatcher, error) {
	if settings.Node == "" || settings.Digest == "" || settings.Policy == nil || settings.Protocol == nil || settings.Worker == nil ||
		settings.Connection == nil ||
		settings.MaxConcurrent < 1 ||
		settings.MaxConcurrent > 4096 ||
		settings.MaxAttempts < 1 ||
		settings.MaxAttempts > 32 ||
		settings.AttemptTimeout <= 0 ||
		settings.AdmissionTimeout <= 0 ||
		settings.AdmissionTimeout > 1500*time.Millisecond ||
		settings.ResponseReserve < 25*time.Millisecond {
		return nil, errors.New("invalid admission settings")
	}

	instance, err := identifier()
	if err != nil {
		return nil, fmt.Errorf("create admission dispatcher identifier: %w", err)
	}

	ownedCtx, cancel := context.WithCancel(ctx)
	d := &Dispatcher{
		settings: settings,
		instance: instance,
		ctx:      ownedCtx,
		cancel:   cancel,
		slots:    make(chan struct{}, settings.MaxConcurrent),
		rpcSlots: make(chan struct{}, settings.Worker.Capacity()),
		peers:    map[string]peer{},
		loopDone: make(chan struct{}),
	}
	protocol := settings.Policy.Subjects.Protocol.Auth
	bindings := []struct {
		subject, queue string
		handler        nats.MsgHandler
	}{
		{protocol.Request, protocol.Queue, d.dispatch},
		{protocol.Membership, "", d.receiveMembership},
		{protocol.Discover, "", d.receiveDiscovery},
		{protocol.Worker + "." + settings.Node, "", d.receiveWork},
		{protocol.Probe + "." + settings.Node, "", func(message *nats.Msg) { _ = message.Respond([]byte(d.instance)) }},
	}

	for _, binding := range bindings {
		sub, err := settings.Connection.QueueSubscribe(binding.subject, binding.queue, binding.handler)
		if err != nil {
			d.closeSubscriptions()
			cancel()

			return nil, fmt.Errorf("subscribe to admission subject %q: %w", binding.subject, err)
		}

		if err := sub.SetPendingLimits(settings.MaxConcurrent*2, 2*1024*1024); err != nil {
			_ = sub.Unsubscribe()
			d.closeSubscriptions()
			cancel()

			return nil, fmt.Errorf("set admission subscription limits for %q: %w", binding.subject, err)
		}

		d.subscriptions = append(d.subscriptions, sub)
	}

	if err := settings.Connection.FlushTimeout(time.Second); err != nil {
		d.closeSubscriptions()
		cancel()

		return nil, fmt.Errorf("flush admission subscriptions: %w", err)
	}

	if err := settings.Connection.LastError(); err != nil {
		d.closeSubscriptions()
		cancel()

		return nil, fmt.Errorf("check admission connection: %w", err)
	}

	d.advertise(false)

	discover, err := sign(
		settings.Protocol,
		membership{Kind: "discover", Version: 1, Node: settings.Node, Instance: d.instance, Digest: settings.Digest, SentAt: time.Now().Unix()},
	)
	if err != nil {
		d.closeSubscriptions()
		cancel()

		return nil, fmt.Errorf("sign admission discovery: %w", err)
	}

	if err := settings.Connection.Publish(protocol.Discover, discover); err != nil {
		d.closeSubscriptions()
		cancel()

		return nil, fmt.Errorf("publish admission discovery: %w", err)
	}

	go d.supervise(ownedCtx)

	return d, nil
}

func (d *Dispatcher) Ready() bool {
	return d.ready.Load() && !d.stopping.Load() && !d.withdrawing.Load() && d.settings.Connection.IsConnected()
}

func (d *Dispatcher) Healthy() bool {
	return !d.stopping.Load() && d.healthy.Load() && d.settings.Connection.IsConnected()
}

func (d *Dispatcher) Withdraw() { d.withdrawing.Store(true); d.advertise(true) }

func (d *Dispatcher) Stop(ctx context.Context) error {
	if d.stopping.CompareAndSwap(false, true) {
		d.advertise(true)
		d.cancel()
		d.closeSubscriptions()
	}

	select {
	case <-d.loopDone:
	case <-ctx.Done():
		return fmt.Errorf("stop admission supervisor: %w", ctx.Err())
	}

	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	for len(d.slots) > 0 || len(d.rpcSlots) > 0 {
		select {
		case <-ctx.Done():
			return fmt.Errorf("drain admission work: %w", ctx.Err())
		case <-ticker.C:
		}
	}

	return nil
}

func (d *Dispatcher) closeSubscriptions() {
	for _, subscription := range d.subscriptions {
		_ = subscription.Unsubscribe()
	}
}

func (d *Dispatcher) dispatch(message *nats.Msg) {
	if d.stopping.Load() {
		_ = message.Respond(nil)

		return
	}

	select {
	case d.slots <- struct{}{}:
	default:
		d.Counters.Busy.Add(1)
		_ = message.Respond(nil)

		return
	}

	go func() {
		defer func() { <-d.slots }()
		response := d.coordinate(message)
		_ = message.Respond(response)
	}()
}

func (d *Dispatcher) coordinate(message *nats.Msg) []byte {
	started := time.Now()
	defer func() {
		d.Counters.Completed.Add(1)
		d.Counters.ElapsedNanoseconds.Add(uint64(time.Since(started)))
	}()
	settings := d.settings
	xkey := message.Header.Get("Nats-Server-Xkey")

	request, err := settings.Protocol.Open(message.Data, xkey)
	if err != nil {
		d.Counters.Denied.Add(1)

		return nil
	}

	deadline := time.Unix(request.Expires, 0).Add(-settings.ResponseReserve)
	if maximum := time.Now().Add(settings.AdmissionTimeout); maximum.Before(deadline) {
		deadline = maximum
	}

	ctx, cancel := context.WithDeadline(d.ctx, deadline)
	defer cancel()
	revision := ""

	if settings.Resolve != nil {
		snapshot, err := settings.Resolve(ctx, "")
		if err != nil {
			d.Counters.Timeout.Add(1)

			return nil
		}

		revision = snapshot.Revision
		ctx = policy.WithSnapshot(ctx, snapshot)
	}

	attempts := 0

	if settings.Worker.Available() {
		attempts++
		d.Counters.Local.Add(1)
		attemptCtx, stop := context.WithTimeout(ctx, settings.AttemptTimeout)
		identity, err := settings.Worker.Evaluate(attemptCtx, request)
		stop()

		if err == nil || errors.Is(err, auth.ErrDenied) {
			if errors.Is(err, auth.ErrDenied) {
				identity = nil
				d.Counters.Denied.Add(1)
			}

			if ctx.Err() != nil {
				return nil
			}

			response, err := settings.Protocol.Reply(request, identity, "credentials denied")
			if err != nil {
				return nil
			}

			return response
		}
	}

	tried := map[string]bool{settings.Node: true}

	for attempts < settings.MaxAttempts && ctx.Err() == nil {
		candidate, exists := d.selectPeer(tried)
		if !exists {
			break
		}

		tried[candidate.Node] = true

		if attempts > 0 {
			d.Counters.Retry.Add(1)
		}

		attempts++
		d.Counters.Remote.Add(1)
		attemptCtx, stop := context.WithTimeout(ctx, settings.AttemptTimeout)
		attemptDeadline, _ := attemptCtx.Deadline()

		attempt, err := identifier()
		if err != nil {
			stop()

			break
		}

		work := workRequest{
			Revision: revision,
			Kind:     "evaluate",
			Version:  1,
			Node:     candidate.Node,
			Instance: candidate.Instance,
			Digest:   settings.Digest,
			Correlation: correlation(
				message.Data,
				xkey,
			),
			Attempt:    attempt,
			Deadline:   attemptDeadline.UnixNano(),
			ServerXKey: xkey,
			Encrypted:  message.Data,
		}

		encoded, err := sign(settings.Protocol, work)
		if err != nil {
			stop()

			break
		}

		reply, err := settings.Connection.RequestWithContext(attemptCtx, settings.Policy.Subjects.Protocol.Auth.Worker+"."+candidate.Node, encoded)
		attemptExpired := attemptCtx.Err() != nil
		stop()

		if err != nil || attemptExpired || ctx.Err() != nil {
			continue
		}

		var result workReply

		if verify(settings.Protocol, reply.Data, &result) != nil || result.Kind != "result" || result.Node != candidate.Node ||
			result.Instance != candidate.Instance ||
			result.Correlation != work.Correlation ||
			result.Attempt != work.Attempt {
			continue
		}

		if result.Status == "allow" || result.Status == "deny" {
			if len(result.Response) == 0 {
				continue
			}

			if result.Status == "deny" {
				d.Counters.Denied.Add(1)
			}

			return result.Response
		}
	}

	d.Counters.Timeout.Add(1)

	return nil
}

func (d *Dispatcher) selectPeer(tried map[string]bool) (peer, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	now := time.Now()
	var candidates []peer

	for node, candidate := range d.peers {
		if now.Sub(candidate.received) > 1500*time.Millisecond {
			delete(d.peers, node)

			continue
		}

		if tried[node] || candidate.Digest != d.settings.Digest || !candidate.Available || candidate.Capacity < 1 ||
			candidate.InFlight >= candidate.Capacity ||
			now.Before(candidate.conflictUntil) {
			continue
		}

		candidates = append(candidates, candidate)
	}

	if len(candidates) == 0 {
		return peer{}, false
	}

	rand.Shuffle(len(candidates), func(i, j int) { candidates[i], candidates[j] = candidates[j], candidates[i] })
	slices.SortStableFunc(candidates, func(a, b peer) int { return a.InFlight*b.Capacity - b.InFlight*a.Capacity })

	return candidates[0], true
}
