package policy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

const (
	RegistryBucket  = "TRANSPORT_REGISTRATIONS"
	RegistryStream  = "KV_" + RegistryBucket
	RegistrySubject = "$KV." + RegistryBucket + ".state"
)

type Store struct {
	JS       nats.JetStreamContext
	Trust    Trust
	Replicas int
	mu       sync.Mutex
	cached   []byte
	snapshot *Snapshot
}

type ApplyRequest struct {
	Registration     SignedRegistration `json:"registration"`
	ExpectedRevision uint64             `json:"expectedRevision"`
}

type ApplyResponse struct {
	Revision uint64 `json:"revision,omitempty"`
	Error    string `json:"error,omitempty"`
}

func (s *Store) read(ctx context.Context) ([]SignedRegistration, uint64, []byte, error) {
	// The management API is handled by the stream leader. KV.Get's direct follower read is unsuitable here.
	message, err := s.JS.GetLastMsg(RegistryStream, RegistrySubject, nats.Context(ctx))
	if errors.Is(err, nats.ErrMsgNotFound) {
		return nil, 0, []byte("[]"), nil
	}

	if err != nil {
		return nil, 0, nil, fmt.Errorf("read registration state: %w", err)
	}

	var registrations []SignedRegistration
	if err := Decode(message.Data, &registrations); err != nil {
		return nil, 0, nil, fmt.Errorf("decode registration state: %w", err)
	}

	return registrations, message.Sequence, message.Data, nil
}

func (s *Store) Resolve(ctx context.Context, revision string) (*Snapshot, error) {
	registrations, _, encoded, err := s.read(ctx)
	if err != nil {
		return nil, fmt.Errorf("registration state unavailable: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.snapshot == nil || !bytes.Equal(s.cached, encoded) {
		snapshot, err := s.Trust.Compile(registrations)
		if err != nil {
			return nil, fmt.Errorf("compile registration state: %w", err)
		}

		s.cached, s.snapshot = slices.Clone(encoded), snapshot
	}

	if revision != "" && s.snapshot.Revision != revision {
		return nil, errors.New("registration revision changed")
	}

	return s.snapshot, nil
}

func (s *Store) Apply(ctx context.Context, request ApplyRequest) (uint64, error) {
	if err := ctx.Err(); err != nil {
		return 0, fmt.Errorf("apply registration: %w", err)
	}

	manifest, err := s.Trust.Verify(request.Registration)
	if err != nil {
		return 0, fmt.Errorf("verify registration: %w", err)
	}

	if s.Replicas < 1 || s.Replicas > 5 {
		return 0, errors.New("invalid registry replica count")
	}

	if _, err := s.JS.CreateKeyValue(
		&nats.KeyValueConfig{
			Bucket:       RegistryBucket,
			History:      1,
			Storage:      nats.FileStorage,
			Replicas:     s.Replicas,
			MaxBytes:     8 * 1024 * 1024,
			MaxValueSize: 1024 * 1024,
		},
	); err != nil {
		return 0, fmt.Errorf("create registration key-value bucket: %w", err)
	}

	registrations, sequence, _, err := s.read(ctx)
	if err != nil {
		return 0, fmt.Errorf("load registrations before update: %w", err)
	}

	index := -1

	for i, current := range registrations {
		old, err := s.Trust.Verify(current)
		if err != nil {
			return 0, fmt.Errorf("verify stored registration: %w", err)
		}

		if old.Owner != manifest.Owner {
			continue
		}

		if bytes.Equal(current.Payload, request.Registration.Payload) && current.Issuer == request.Registration.Issuer {
			return sequence, nil
		}

		if manifest.Version <= old.Version {
			return 0, errors.New("registration version must increase")
		}

		index = i
	}

	if request.ExpectedRevision != sequence {
		return 0, errors.New("registration revision conflict")
	}

	if index < 0 {
		registrations = append(registrations, request.Registration)
	} else {
		registrations[index] = request.Registration
	}

	if _, err := s.Trust.Compile(registrations); err != nil {
		return 0, fmt.Errorf("compile updated registrations: %w", err)
	}

	encoded, err := json.Marshal(registrations)
	if err != nil {
		return 0, fmt.Errorf("encode updated registrations: %w", err)
	}

	if len(encoded) > 1024*1024 {
		return 0, errors.New("registry exceeds size limit")
	}

	ack, err := s.JS.Publish(RegistrySubject, encoded, nats.Context(ctx), nats.ExpectLastSequencePerSubject(sequence))
	if errors.Is(err, nats.ErrKeyExists) {
		return 0, errors.New("registration revision conflict")
	}

	if err != nil {
		return 0, fmt.Errorf("publish registration update: %w", err)
	}

	return ack.Sequence, nil
}

func (s *Store) Subscribe(ctx context.Context, connection *nats.Conn) (*nats.Subscription, error) {
	subscription, err := connection.QueueSubscribe(RegistrationSubject, "registration", func(message *nats.Msg) {
		var request ApplyRequest
		response := ApplyResponse{}
		requestCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()

		err := Decode(message.Data, &request)
		if err == nil {
			response.Revision, err = s.Apply(requestCtx, request)
		}

		if err != nil {
			response.Error = err.Error()
			// Only the sequence is exposed to bootstrap clients, never registered identities or grants.
			_, response.Revision, _, _ = s.read(requestCtx)
		}

		encoded, err := json.Marshal(response)
		if err == nil {
			_ = message.Respond(encoded)
		}
	})
	if err != nil {
		return nil, fmt.Errorf("subscribe to registration updates: %w", err)
	}

	if err := subscription.SetPendingLimits(32, 4*1024*1024); err != nil {
		unsubscribeErr := subscription.Unsubscribe()
		if unsubscribeErr != nil {
			unsubscribeErr = fmt.Errorf("unsubscribe failed registration subscription: %w", unsubscribeErr)
		}

		return nil, errors.Join(fmt.Errorf("set registration subscription limits: %w", err), unsubscribeErr)
	}

	return subscription, nil
}
