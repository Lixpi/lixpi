package broker

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/nats-io/nats-server/v2/server"
)

func (r *Runtime) HealthHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /live", func(w http.ResponseWriter, _ *http.Request) {
		if !r.Server.Running() {
			http.Error(w, "broker stopped", http.StatusServiceUnavailable)

			return
		}

		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("GET /broker", func(w http.ResponseWriter, _ *http.Request) {
		if !r.Server.Running() || r.stopping.Load() || r.Server.Healthz(&server.HealthzOptions{}).Status != "ok" {
			http.Error(w, "broker unavailable", http.StatusServiceUnavailable)

			return
		}

		w.WriteHeader(http.StatusOK)
	})
	protected := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, request *http.Request) {
			if subtle.ConstantTimeCompare([]byte(request.Header.Get("Authorization")), []byte("Bearer "+r.config.Password)) != 1 {
				http.Error(w, "unauthorized", http.StatusUnauthorized)

				return
			}

			next(w, request)
		}
	}
	mux.HandleFunc("GET /ready", protected(func(w http.ResponseWriter, _ *http.Request) {
		if !r.Ready() {
			http.Error(w, "admission unavailable", http.StatusServiceUnavailable)

			return
		}

		w.WriteHeader(http.StatusOK)
	}))
	mux.HandleFunc("GET /metrics", protected(func(w http.ResponseWriter, _ *http.Request) {
		d := r.dispatcher.Load()
		w.Header().Set("Content-Type", "application/json")
		values := map[string]any{
			"ready":          r.Ready(),
			"workerCapacity": r.config.Admission.Worker.Capacity(),
			"workerInFlight": r.config.Admission.Worker.InFlight(),
		}
		values["serverName"] = r.config.Identity.Name

		if r.config.Certificates != nil {
			values["certificateRefreshHealthy"] = r.certificateHealthy.Load()
			values["certificateValidBeyondSevenDays"] = r.config.Certificates.ValidFor(7 * 24 * time.Hour)
		}

		if d != nil {
			values["completed"] = d.Counters.Completed.Load()
			values["elapsedNanoseconds"] = d.Counters.ElapsedNanoseconds.Load()
			values["local"] = d.Counters.Local.Load()
			values["remote"] = d.Counters.Remote.Load()
			values["retry"] = d.Counters.Retry.Load()
			values["denied"] = d.Counters.Denied.Load()
			values["timeout"] = d.Counters.Timeout.Load()
			values["busy"] = d.Counters.Busy.Load()
		}

		if err := json.NewEncoder(w).Encode(values); err != nil {
			slog.Error("health metrics response failed", "error", err)
		}
	}))

	return mux
}

func (r *Runtime) startHealth(ctx context.Context) error {
	start := func(listener net.Listener, handler http.Handler) *http.Server {
		srv := &http.Server{
			Handler:           handler,
			ReadHeaderTimeout: time.Second,
			ReadTimeout:       2 * time.Second,
			WriteTimeout:      2 * time.Second,
			IdleTimeout:       5 * time.Second,
			MaxHeaderBytes:    4096,
		}
		go func() {
			if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
				slog.Error("runtime control listener failed", "error", err)
				r.Server.Shutdown()
			}
		}()

		return srv
	}

	if r.config.HealthAddress != "" {
		listener, err := (&net.ListenConfig{}).Listen(ctx, "tcp", r.config.HealthAddress)
		if err != nil {
			return fmt.Errorf("listen for broker health on %q: %w", r.config.HealthAddress, err)
		}

		r.health = start(listener, r.HealthHandler())
	}

	if r.config.ControlSocket != "" {
		if err := os.MkdirAll(filepath.Dir(r.config.ControlSocket), 0o700); err != nil {
			return fmt.Errorf("create control socket directory: %w", err)
		}

		if info, err := os.Lstat(r.config.ControlSocket); err == nil {
			if info.Mode()&os.ModeSocket == 0 {
				return errors.New("control socket path contains a regular file")
			}

			if err := os.Remove(r.config.ControlSocket); err != nil {
				return fmt.Errorf("remove stale control socket: %w", err)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("inspect control socket: %w", err)
		}

		listener, err := (&net.ListenConfig{}).Listen(ctx, "unix", r.config.ControlSocket)
		if err != nil {
			return fmt.Errorf("listen on control socket %q: %w", r.config.ControlSocket, err)
		}

		if err := os.Chmod(r.config.ControlSocket, 0o600); err != nil {
			closeErr := listener.Close()
			if closeErr != nil {
				closeErr = fmt.Errorf("close control socket listener: %w", closeErr)
			}

			return errors.Join(fmt.Errorf("set control socket permissions: %w", err), closeErr)
		}

		mux := http.NewServeMux()
		mux.HandleFunc("POST /fence/{mode}", func(w http.ResponseWriter, request *http.Request) {
			mode := request.PathValue("mode")
			if mode != "enable" && mode != "disable" {
				http.Error(w, "invalid fence mode", http.StatusBadRequest)

				return
			}

			if err := r.Fence(mode == "enable"); err != nil {
				http.Error(w, "fence reload failed", http.StatusInternalServerError)

				return
			}

			_, _ = fmt.Fprintln(w, "ok")
		})
		r.control = start(listener, mux)
	}

	return nil
}
