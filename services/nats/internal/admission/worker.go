package admission

import (
	"context"
	"errors"
	"sync/atomic"

	"github.com/lixpi/lixpi/services/nats/internal/auth"
	"github.com/nats-io/jwt/v2"
)

var ErrBusy = errors.New("worker busy")

type Worker struct {
	evaluator auth.Evaluator
	slots     chan struct{}
	healthy   atomic.Bool
}

func NewWorker(evaluator auth.Evaluator, capacity int) (*Worker, error) {
	if evaluator == nil || capacity < 1 || capacity > 1024 {
		return nil, errors.New("invalid worker capacity or evaluator")
	}

	w := &Worker{evaluator: evaluator, slots: make(chan struct{}, capacity)}
	w.healthy.Store(true)

	return w, nil
}

func (w *Worker) Capacity() int           { return cap(w.slots) }
func (w *Worker) InFlight() int           { return len(w.slots) }
func (w *Worker) Available() bool         { return w.healthy.Load() && w.InFlight() < w.Capacity() }
func (w *Worker) SetHealthy(healthy bool) { w.healthy.Store(healthy) }

func (w *Worker) Evaluate(ctx context.Context, request *jwt.AuthorizationRequestClaims) (*auth.Identity, error) {
	if !w.healthy.Load() {
		return nil, auth.ErrUnavailable
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}

	select {
	case w.slots <- struct{}{}:
	default:
		return nil, ErrBusy
	}

	type result struct {
		identity *auth.Identity
		err      error
	}
	completed := make(chan result, 1)
	// A verifier that ignores cancellation retains its slot until it actually returns.
	go func() {
		defer func() { <-w.slots }()
		identity, err := w.evaluator.Evaluate(ctx, request)
		completed <- result{identity, err}
	}()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case result := <-completed:
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		return result.identity, result.err
	}
}
