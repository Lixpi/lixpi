package broker

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/admission"
	"github.com/lixpi/lixpi/services/nats/internal/maintenance"
	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
)

type RuntimeConfig struct {
	Registration        *RegistrationConfig
	Options             *server.Options
	Admission           admission.Settings
	Password            string
	Identity            maintenance.NodeIdentity
	Certificates        *maintenance.Certificates
	HealthAddress       string
	ControlSocket       string
	CertificateInterval time.Duration
}

type Runtime struct {
	Registry           *policy.Store
	registryConnection *nats.Conn
	Server             *server.Server
	config             RuntimeConfig
	options            *server.Options
	reloadMu           sync.Mutex
	dispatcher         atomic.Pointer[admission.Dispatcher]
	certificate        atomic.Pointer[tls.Certificate]
	certificateHealthy atomic.Bool
	connection         *nats.Conn
	stopping           atomic.Bool
	health             *http.Server
	control            *http.Server
}

func StartRuntime(ctx context.Context, config RuntimeConfig) (*Runtime, error) {
	if config.Options == nil || config.Admission.Policy == nil || config.Admission.Protocol == nil || config.Admission.Worker == nil ||
		config.Password == "" {
		return nil, errors.New("incomplete runtime configuration")
	}

	options := config.Options.Clone()
	options.NoSigs = true
	options.LameDuckDuration = 80 * time.Second
	options.LameDuckGracePeriod = 2 * time.Second

	xkey, err := config.Admission.Protocol.Curve.PublicKey()
	if err != nil {
		return nil, fmt.Errorf("read callout encryption public key: %w", err)
	}

	if err := ConfigureCallout(
		options,
		config.Admission.Policy,
		config.Admission.Node,
		config.Password,
		config.Admission.Protocol.Issuer,
		xkey,
	); err != nil {
		return nil, fmt.Errorf("configure broker auth callout: %w", err)
	}

	if config.Registration != nil {
		if err := ConfigureRegistration(options, *config.Registration, config.Password); err != nil {
			return nil, fmt.Errorf("configure broker registration: %w", err)
		}
	}

	_, err = os.Stat(filepath.Join(options.StoreDir, "scale-in-fenced"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read broker placement fence: %w", err)
	}

	options.Tags = config.Identity.Tags(err == nil)
	r := &Runtime{config: config, options: options}

	if options.Websocket.TLSConfig != nil && len(options.Websocket.TLSConfig.Certificates) > 0 {
		initial := options.Websocket.TLSConfig.Certificates[0]
		r.certificate.Store(&initial)
		options.Websocket.TLSConfig = options.Websocket.TLSConfig.Clone()
		options.Websocket.TLSConfig.Certificates = nil
		options.Websocket.TLSConfig.GetCertificate = func(*tls.ClientHelloInfo) (*tls.Certificate, error) { return r.certificate.Load(), nil }
	}

	instance, err := Start(options)
	if err != nil {
		return nil, fmt.Errorf("start embedded broker: %w", err)
	}

	r.Server = instance
	if err := r.startRegistry(ctx); err != nil {
		instance.Shutdown()
		instance.WaitForShutdown()

		return nil, fmt.Errorf("start registration store: %w", err)
	}

	if err := r.startDispatcher(ctx); err != nil {
		instance.Shutdown()
		instance.WaitForShutdown()

		return nil, fmt.Errorf("start admission dispatcher: %w", err)
	}

	if config.Certificates != nil {
		info, err := instance.Varz(nil)
		if err != nil {
			instance.Shutdown()

			return nil, errors.Join(fmt.Errorf("read broker listener state: %w", err), r.shutdown(ctx))
		}

		config.Certificates.Reload = r.reloadCertificate
		config.Certificates.VerifyServed = maintenance.VerifyTLS(
			net.JoinHostPort("127.0.0.1", fmt.Sprint(info.Websocket.Port)),
			config.Certificates.Domain,
		)
	}

	if err := r.startHealth(ctx); err != nil {
		instance.Shutdown()

		return nil, errors.Join(fmt.Errorf("start broker health listeners: %w", err), r.shutdown(ctx))
	}

	return r, nil
}

func (r *Runtime) startDispatcher(ctx context.Context) error {
	settings := r.config.Admission

	connection, err := nats.Connect("", nats.InProcessServer(r.Server), nats.UserInfo("auth_callout", r.config.Password),
		nats.CustomInboxPrefix(settings.Policy.Subjects.Protocol.Auth.Reply+"."+settings.Node), nats.NoReconnect(), nats.Timeout(time.Second),
		nats.ErrorHandler(func(_ *nats.Conn, _ *nats.Subscription, err error) {
			slog.Error("admission subscription failed", "error", err)
		}))
	if err != nil {
		return fmt.Errorf("connect admission dispatcher: %w", err)
	}

	settings.Connection = connection

	dispatcher, err := admission.Start(ctx, settings)
	if err != nil {
		connection.Close()

		return fmt.Errorf("start admission dispatcher: %w", err)
	}

	r.connection = connection
	r.dispatcher.Store(dispatcher)

	return nil
}

func (r *Runtime) Dispatcher() *admission.Dispatcher { return r.dispatcher.Load() }

func (r *Runtime) Ready() bool {
	d := r.dispatcher.Load()

	return !r.stopping.Load() && r.Server.Running() && d != nil && d.Ready() && (r.registryConnection == nil || r.registryConnection.IsConnected())
}

func (r *Runtime) reloadCertificate(certPath, keyPath string) error {
	pair, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return fmt.Errorf("load replacement TLS certificate: %w", err)
	}

	if r.certificate.Load() == nil {
		return errors.New("WebSocket TLS configuration missing")
	}

	// Full server reload reauthorizes callout sessions. The TLS callback replaces only
	// the certificate used by subsequent handshakes, preserving existing sessions.
	r.certificate.Store(&pair)

	return nil
}

func (r *Runtime) Fence(enable bool) error {
	r.reloadMu.Lock()
	defer r.reloadMu.Unlock()

	err := maintenance.SetFence(r.options.StoreDir, enable, func(fenced bool) error {
		next := r.options.Clone()
		next.Tags = r.config.Identity.Tags(fenced)

		if err := r.Server.ReloadOptions(next); err != nil {
			return fmt.Errorf("reload broker placement options: %w", err)
		}

		r.options = next

		return nil
	})
	if err != nil {
		return fmt.Errorf("set broker placement fence: %w", err)
	}

	return nil
}

// Run recovers dispatch infrastructure independently of worker capacity and provider availability.
func (r *Runtime) Run(ctx context.Context) (result error) {
	defer func() { result = errors.Join(result, r.shutdown(ctx)) }()
	maintenanceCtx, cancelMaintenance := context.WithCancel(ctx)
	var maintenanceGroup sync.WaitGroup

	if r.config.Certificates != nil {
		maintenanceGroup.Go(func() { r.watchCertificates(maintenanceCtx) })
	}

	defer func() { cancelMaintenance(); maintenanceGroup.Wait() }()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	unhealthy := 0
	var recoveries []time.Time

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if !r.Server.Running() {
				return errors.New("embedded broker stopped")
			}

			if r.registryConnection != nil && !r.registryConnection.IsConnected() {
				return errors.New("registration connection stopped")
			}

			d := r.dispatcher.Load()
			if d != nil && d.Healthy() {
				unhealthy = 0

				continue
			}

			unhealthy++

			if unhealthy < 3 {
				continue
			}

			now := time.Now()

			for len(recoveries) > 0 && now.Sub(recoveries[0]) > time.Minute {
				recoveries = recoveries[1:]
			}

			if len(recoveries) >= 3 {
				return errors.New("admission dispatcher recovery exhausted")
			}

			recoveries = append(recoveries, now)
			r.dispatcher.Store(nil)

			if d != nil {
				stopCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
				if err := d.Stop(stopCtx); err != nil {
					slog.Warn("previous admission dispatcher did not stop cleanly", "error", err)
				}

				cancel()
			}

			if r.connection != nil {
				r.connection.Close()
			}

			if err := r.startDispatcher(ctx); err != nil {
				slog.Error("admission dispatcher recovery failed", "error", err)
			} else {
				unhealthy = 0
				slog.Info("admission dispatcher recovered")
			}
		}
	}
}

func (r *Runtime) watchCertificates(ctx context.Context) {
	interval := r.config.CertificateInterval
	if interval <= 0 {
		interval = time.Minute
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		refreshCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		err := r.config.Certificates.Refresh(refreshCtx)
		cancel()

		if err != nil {
			slog.Error("certificate refresh failed; retaining installed certificate", "error", err)
		}

		r.certificateHealthy.Store(err == nil)

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// shutdown wraps the close error and returns nil when close succeeds, so callers can join it with their own error.
func (r *Runtime) shutdown(ctx context.Context) error {
	if err := r.close(ctx); err != nil {
		return fmt.Errorf("close broker runtime: %w", err)
	}

	return nil
}

func (r *Runtime) close(ctx context.Context) (result error) {
	if !r.stopping.CompareAndSwap(false, true) {
		return nil
	}

	d := r.dispatcher.Load()
	if d != nil {
		d.Withdraw()
	}

	// Lame duck closes listeners before its grace period. Keep the dispatcher alive for pending admissions.
	drained := make(chan struct{})
	go func() { r.Server.LameDuckShutdown(); close(drained) }()
	timer := time.NewTimer(90 * time.Second)

	select {
	case <-drained:
	case <-timer.C:
		r.Server.Shutdown()
		result = errors.New("broker drain timed out")
	}

	timer.Stop()
	r.Server.WaitForShutdown()
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()

	if d != nil {
		if err := d.Stop(shutdownCtx); err != nil {
			result = errors.Join(result, fmt.Errorf("stop admission dispatcher: %w", err))
		}
	}

	if r.connection != nil {
		r.connection.Close()
	}

	if r.registryConnection != nil {
		r.registryConnection.Close()
	}

	if r.health != nil {
		if err := r.health.Shutdown(shutdownCtx); err != nil {
			result = errors.Join(result, fmt.Errorf("stop health listener: %w", err))
		}
	}

	if r.control != nil {
		if err := r.control.Shutdown(shutdownCtx); err != nil {
			result = errors.Join(result, fmt.Errorf("stop control listener: %w", err))
		}

		if err := os.Remove(r.config.ControlSocket); err != nil && !errors.Is(err, os.ErrNotExist) {
			result = errors.Join(result, fmt.Errorf("remove control socket: %w", err))
		}
	}

	return result
}
