package admission

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/auth"
	"github.com/nats-io/jwt/v2"
)

type stalledEvaluator struct{ release chan struct{} }

func (s *stalledEvaluator) Evaluate(context.Context, *jwt.AuthorizationRequestClaims) (*auth.Identity, error) {
	<-s.release

	return nil, auth.ErrUnavailable
}

func TestWorkerRetainsSlotsAfterTimeout(t *testing.T) {
	evaluator := &stalledEvaluator{release: make(chan struct{})}
	t.Cleanup(func() { close(evaluator.release) })

	worker, err := NewWorker(evaluator, 2)
	if err != nil {
		t.Fatal(err)
	}

	for range 2 {
		ctx, cancel := context.WithTimeout(t.Context(), 10*time.Millisecond)
		_, err := worker.Evaluate(ctx, &jwt.AuthorizationRequestClaims{})
		cancel()

		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatal("stalled worker did not time out")
		}
	}

	for range 100 {
		if _, err := worker.Evaluate(t.Context(), &jwt.AuthorizationRequestClaims{}); !errors.Is(err, ErrBusy) {
			t.Fatal("replacement verifier admitted after capacity exhausted")
		}
	}

	if worker.InFlight() != 2 || worker.Available() {
		t.Fatal("bounded capacity was not retained")
	}
}
