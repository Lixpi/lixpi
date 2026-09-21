package admission

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/auth"
	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/nats.go"
)

func (d *Dispatcher) advertise(withdraw bool) {
	worker := d.settings.Worker
	member := membership{
		Kind:     "membership",
		Version:  1,
		Node:     d.settings.Node,
		Instance: d.instance,
		Digest:   d.settings.Digest,
		Sequence: d.sequence.Add(
			1,
		),
		Capacity:  worker.Capacity(),
		InFlight:  worker.InFlight(),
		Available: worker.Available() && !withdraw,
		SentAt:    time.Now().Unix(),
	}

	encoded, err := sign(d.settings.Protocol, member)
	if err == nil {
		_ = d.settings.Connection.Publish(d.settings.Policy.Subjects.Protocol.Auth.Membership, encoded)
	}
}

func (d *Dispatcher) receiveMembership(message *nats.Msg) {
	var member membership

	if verify(d.settings.Protocol, message.Data, &member) != nil || member.Kind != "membership" || member.Version != 1 ||
		member.Node == "" || member.Node == d.settings.Node || strings.ContainsAny(member.Node, " .*>{}\t\r\n") || len(member.Node) > 128 ||
		len(member.Instance) != 32 || member.Capacity < 1 || member.Capacity > 1024 || member.InFlight < 0 || member.InFlight > member.Capacity ||
		member.SentAt < time.Now().Add(-5*time.Second).Unix() || member.SentAt > time.Now().Add(5*time.Second).Unix() {
		return
	}

	d.mu.Lock()
	defer d.mu.Unlock()
	previous, exists := d.peers[member.Node]
	now := time.Now()

	if exists && previous.Instance == member.Instance && member.Sequence <= previous.Sequence {
		return
	}

	if !exists && len(d.peers) >= 1024 {
		return
	}

	conflict := previous.conflictUntil

	if exists && previous.Instance != member.Instance && now.Sub(previous.received) < 1500*time.Millisecond {
		conflict = now.Add(1500 * time.Millisecond)
	}

	d.peers[member.Node] = peer{membership: member, received: now, conflictUntil: conflict}
}

func (d *Dispatcher) receiveDiscovery(message *nats.Msg) {
	var member membership

	if verify(d.settings.Protocol, message.Data, &member) != nil || member.Kind != "discover" || member.Version != 1 ||
		member.Node == d.settings.Node ||
		member.SentAt < time.Now().Add(-5*time.Second).Unix() ||
		member.SentAt > time.Now().Add(5*time.Second).Unix() {
		return
	}

	d.advertise(d.stopping.Load() || d.withdrawing.Load())
}

func (d *Dispatcher) receiveWork(message *nats.Msg) {
	var work workRequest

	if verify(d.settings.Protocol, message.Data, &work) != nil || work.Kind != "evaluate" || work.Version != 1 || work.Node != d.settings.Node ||
		work.Instance != d.instance || work.Digest != d.settings.Digest || len(work.Attempt) != 32 || work.Correlation != correlation(work.Encrypted, work.ServerXKey) {
		return
	}

	if d.stopping.Load() || d.withdrawing.Load() {
		d.replyBusy(message, work)

		return
	}

	select {
	case d.rpcSlots <- struct{}{}:
	default:
		d.replyBusy(message, work)

		return
	}

	go func() {
		defer func() { <-d.rpcSlots }()

		request, err := d.settings.Protocol.Open(work.Encrypted, work.ServerXKey)
		if err != nil {
			return
		}

		deadline := time.Unix(0, work.Deadline)
		if !deadline.After(time.Now()) || deadline.After(time.Unix(request.Expires, 0)) {
			return
		}

		ctx, cancel := context.WithDeadline(d.ctx, deadline)
		defer cancel()

		if d.settings.Resolve != nil {
			if work.Revision == "" {
				return
			}

			snapshot, err := d.settings.Resolve(ctx, work.Revision)
			if err != nil {
				return
			}

			ctx = policy.WithSnapshot(ctx, snapshot)
		}

		result := workReply{
			Kind:        "result",
			Node:        d.settings.Node,
			Instance:    d.instance,
			Correlation: work.Correlation,
			Attempt:     work.Attempt,
			Status:      "unavailable",
		}
		identity, err := d.settings.Worker.Evaluate(ctx, request)

		switch {
		case errors.Is(err, ErrBusy):
			result.Status = "busy"
		case errors.Is(err, auth.ErrDenied):
			result.Status = "deny"
		case err == nil:
			result.Status = "allow"
		}

		if result.Status == "allow" || result.Status == "deny" {
			if result.Status == "deny" {
				identity = nil
			}

			result.Response, err = d.settings.Protocol.Reply(request, identity, "credentials denied")
			if err != nil {
				return
			}
		}

		if ctx.Err() != nil {
			return
		}

		encoded, err := sign(d.settings.Protocol, result)
		if err == nil {
			_ = message.Respond(encoded)
		}
	}()
}

func (d *Dispatcher) replyBusy(message *nats.Msg, work workRequest) {
	result := workReply{
		Kind:        "result",
		Node:        d.settings.Node,
		Instance:    d.instance,
		Correlation: work.Correlation,
		Attempt:     work.Attempt,
		Status:      "busy",
	}

	encoded, err := sign(d.settings.Protocol, result)
	if err == nil {
		_ = message.Respond(encoded)
	}
}

func (d *Dispatcher) supervise(ctx context.Context) {
	defer close(d.loopDone)
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	for {
		probeCtx, cancel := context.WithTimeout(ctx, 150*time.Millisecond)
		message, err := d.settings.Connection.RequestWithContext(probeCtx, d.settings.Policy.Subjects.Protocol.Auth.Probe+"."+d.settings.Node, nil)
		cancel()
		local := d.settings.Worker.Available()
		_, remote := d.selectPeer(map[string]bool{d.settings.Node: true})
		healthy := err == nil && string(message.Data) == d.instance && d.settings.Connection.LastError() == nil

		for _, subscription := range d.subscriptions {
			healthy = healthy && subscription.IsValid()
		}

		d.healthy.Store(healthy)
		d.ready.Store(healthy && (local || remote))
		d.advertise(d.stopping.Load() || d.withdrawing.Load())

		select {
		case <-ctx.Done():
			d.ready.Store(false)

			return
		case <-ticker.C:
		}
	}
}
