package admission

import (
	"bytes"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/auth"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
)

func peerProtocol(t *testing.T) *auth.Protocol {
	t.Helper()

	signer, err := nkeys.CreateAccount()
	if err != nil {
		t.Fatal(err)
	}

	curve, err := nkeys.CreateCurveKeys()
	if err != nil {
		t.Fatal(err)
	}

	seed, err := signer.Seed()
	if err != nil {
		t.Fatal(err)
	}

	xseed, err := curve.Seed()
	if err != nil {
		t.Fatal(err)
	}

	p, err := auth.NewProtocol(string(seed), string(xseed))
	if err != nil {
		t.Fatal(err)
	}

	return p
}

func testIdentifier(t *testing.T) string {
	t.Helper()

	value, err := identifier()
	if err != nil {
		t.Fatal(err)
	}

	return value
}

func TestMembershipRejectsReplayConflictAndIncompatiblePeers(t *testing.T) {
	d := &Dispatcher{settings: Settings{Node: "local", Digest: "policy", Protocol: peerProtocol(t)}, peers: map[string]peer{}}
	member := membership{
		Kind:      "membership",
		Version:   1,
		Node:      "peer",
		Instance:  testIdentifier(t),
		Digest:    "policy",
		Sequence:  1,
		Capacity:  4,
		Available: true,
		SentAt:    time.Now().Unix(),
	}
	deliver := func(value membership) {
		t.Helper()

		encoded, err := sign(d.settings.Protocol, value)
		if err != nil {
			t.Fatal(err)
		}

		d.receiveMembership(&nats.Msg{Data: encoded})
	}
	deliver(member)

	if selected, ok := d.selectPeer(nil); !ok || selected.Node != member.Node {
		t.Fatal("valid member not selectable")
	}

	member.Available = false
	deliver(member)

	if _, ok := d.selectPeer(nil); !ok {
		t.Fatal("replayed sequence changed member availability")
	}

	member.Sequence++
	deliver(member)

	if _, ok := d.selectPeer(nil); ok {
		t.Fatal("withdrawn member selectable")
	}

	member.Available = true
	member.Sequence++
	member.Digest = "incompatible"
	deliver(member)

	if _, ok := d.selectPeer(nil); ok {
		t.Fatal("incompatible member selectable")
	}

	member.Sequence++
	member.Digest = "policy"
	member.Instance = testIdentifier(t)
	deliver(member)

	if _, ok := d.selectPeer(nil); ok {
		t.Fatal("duplicate live process identity selectable")
	}

	entry := d.peers[member.Node]
	entry.received = time.Now().Add(-2 * time.Second)
	d.peers[member.Node] = entry

	if _, ok := d.selectPeer(nil); ok || len(d.peers) != 0 {
		t.Fatal("expired peer retained")
	}

	member.Sequence++
	deliver(member)

	if _, ok := d.selectPeer(nil); !ok {
		t.Fatal("restarted member did not recover after expiry")
	}

	for _, offset := range []time.Duration{-10 * time.Second, 10 * time.Second} {
		member.Node = testIdentifier(t)
		member.SentAt = time.Now().Add(offset).Unix()
		deliver(member)

		if _, ok := d.peers[member.Node]; ok {
			t.Fatal("invalid membership timestamp accepted")
		}
	}
}

func TestPeerSelectionUsesUtilizationAndExcludesAttemptedWorkers(t *testing.T) {
	d := &Dispatcher{settings: Settings{Digest: "policy"}, peers: map[string]peer{}}

	for _, member := range []membership{
		{Node: "large", Capacity: 8, InFlight: 2},
		{Node: "small", Capacity: 2, InFlight: 1},
		{Node: "full", Capacity: 2, InFlight: 2},
	} {
		member.Digest, member.Available = "policy", true
		d.peers[member.Node] = peer{membership: member, received: time.Now()}
	}

	if selected, ok := d.selectPeer(nil); !ok || selected.Node != "large" {
		t.Fatal("lowest utilization worker not selected")
	}

	if selected, ok := d.selectPeer(map[string]bool{"large": true}); !ok || selected.Node != "small" {
		t.Fatal("attempted worker selected again")
	}

	if _, ok := d.selectPeer(map[string]bool{"large": true, "small": true}); ok {
		t.Fatal("saturated worker selected")
	}
}

func TestPeerEnvelopeRejectsTamperingAndOversizedPayloads(t *testing.T) {
	p := peerProtocol(t)

	encoded, err := sign(p, workReply{Kind: "result", Status: "deny"})
	if err != nil {
		t.Fatal(err)
	}

	var result workReply

	if err := verify(p, encoded, &result); err != nil {
		t.Fatal(err)
	}

	for _, invalid := range [][]byte{bytes.Replace(encoded, []byte("deny"), []byte("allow"), 1), bytes.Repeat([]byte("x"), 262145)} {
		if verify(p, invalid, &result) == nil {
			t.Fatal("invalid peer envelope accepted")
		}
	}

	if verify(peerProtocol(t), encoded, &result) == nil {
		t.Fatal("different cluster signer accepted")
	}
}
