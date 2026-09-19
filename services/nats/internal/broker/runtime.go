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

func StartRuntime(config RuntimeConfig) (*Runtime, error) {
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
		return nil, err
	}

	if err := ConfigureCallout(
		options,
		config.Admission.Policy,
		config.Admission.Node,
		config.Password,
		config.Admission.Protocol.Issuer,
		xkey,
	); err != nil {
		return nil, err
	}

	if config.Registration != nil {
		if err := ConfigureRegistration(options, *config.Registration, config.Password); err != nil {
			return nil, err
		}
	}

	_, err = os.Stat(filepath.Join(options.StoreDir, "scale-in-fenced"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
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
		return nil, err
	}

	r.Server = instance
	if err := r.startRegistry(); err != nil {
		instance.Shutdown()
		instance.WaitForShutdown()

		return nil, err
	}

	if err := r.startDispatcher(); err != nil {
		instance.Shutdown()
		instance.WaitForShutdown()

		return nil, err
	}

	if config.Certificates != nil {
		info, err := instance.Varz(nil)
		if err != nil {
			instance.Shutdown()
			r.close()

			return nil, err
		}

		config.Certificates.Reload = r.reloadCertificate
		config.Certificates.VerifyServed = maintenance.VerifyTLS(
			net.JoinHostPort("127.0.0.1", fmt.Sprint(info.Websocket.Port)),
			config.Certificates.Domain,
		)
	}

	if err := r.startHealth(); err != nil {
		instance.Shutdown()
		r.close()

		return nil, err
	}

	return r, nil
}

func (r *Runtime) startDispatcher() error {
	settings := r.config.Admission

	connection, err := nats.Connect("", nats.InProcessServer(r.Server), nats.UserInfo("auth_callout", r.config.Password),
		nats.CustomInboxPrefix(settings.Policy.Subjects.Protocol.Auth.Reply+"."+settings.Node), nats.NoReconnect(), nats.Timeout(time.Second),
		nats.ErrorHandler(func(_ *nats.Conn, _ *nats.Subscription, _ error) { slog.Error("admission subscription failed") }))
	if err != nil {
		return err
	}

	settings.Connection = connection

	dispatcher, err := admission.Start(settings)
	if err != nil {
		connection.Close()

		return err
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
		return err
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

	return maintenance.SetFence(r.options.StoreDir, enable, func(fenced bool) error {
		next := r.options.Clone()
		next.Tags = r.config.Identity.Tags(fenced)

		if err := r.Server.ReloadOptions(next); err != nil {
			return err
		}

		r.options = next

		return nil
	})
}

// Run recovers dispatch infrastructure independently of worker capacity and provider availability.
func (r *Runtime) Run(ctx context.Context) error {
	defer r.close()
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
				stopCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				_ = d.Stop(stopCtx)
				cancel()
			}

			if r.connection != nil {
				r.connection.Close()
			}

			if err := r.startDispatcher(); err != nil {
				slog.Error("admission dispatcher recovery failed")
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
			slog.Error("certificate refresh failed; retaining installed certificate")
		}

		r.certificateHealthy.Store(err == nil)

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (r *Runtime) close() {
	if !r.stopping.CompareAndSwap(false, true) {
		return
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
	}

	timer.Stop()
	r.Server.WaitForShutdown()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if d != nil {
		_ = d.Stop(ctx)
	}

	if r.connection != nil {
		r.connection.Close()
	}

	if r.registryConnection != nil {
		r.registryConnection.Close()
	}

	if r.health != nil {
		_ = r.health.Shutdown(ctx)
	}

	if r.control != nil {
		_ = r.control.Shutdown(ctx)
		_ = os.Remove(r.config.ControlSocket)
	}
}
