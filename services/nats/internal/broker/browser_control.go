package broker

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/lixpi/lixpi/services/nats/internal/auth"
	"github.com/lixpi/lixpi/services/nats/internal/maintenance"
	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
)

const browserChangedSubject = "accounts.admission.changed.v1"

type browserChange struct {
	Version     int    `json:"version"`
	EventID     string `json:"eventId"`
	IdentityKey string `json:"identityKey"`
	Epoch       int64  `json:"epoch"`
	State       string `json:"state"`
}

type browserSession struct {
	identity string
	epoch    int64
	expires  int64
}

// Each accepting broker owns its connection index. A peer returns grant metadata
// in its signed result; only the accepting broker can register or close the CID.
type browserControls struct {
	deployment  *maintenance.DeploymentIdentity
	ctx         context.Context
	cancel      context.CancelFunc
	server      *server.Server
	mu          sync.Mutex
	connections map[string]*nats.Conn
	feeds       map[string]*browserControlFeed
}

func newBrowserControls(ctx context.Context, instance *server.Server) *browserControls {
	owned, cancel := context.WithCancel(ctx)

	return &browserControls{
		ctx:         owned,
		cancel:      cancel,
		server:      instance,
		connections: map[string]*nats.Conn{},
		feeds:       map[string]*browserControlFeed{},
	}
}

func (c *browserControls) register(account string, connection *nats.Conn) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.connections[account] = connection
}

func (c *browserControls) unavailable(account string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	for _, feed := range c.feeds {
		if feed.account == account {
			feed.setAvailable(false)
		}
	}
}

func (c *browserControls) stop() {
	c.cancel()
	c.mu.Lock()
	defer c.mu.Unlock()

	for _, feed := range c.feeds {
		feed.setAvailable(false)
	}
}

// Idle brokers still participate in enforcement. Resolve only signed policy and
// start replay before the first browser arrives, including after a restart.
func (c *browserControls) followPolicy(store *policy.Store) {
	if c.deployment == nil || store == nil {
		return
	}

	go func() {
		timer := time.NewTicker(time.Second)
		defer timer.Stop()

		for {
			check, cancel := context.WithTimeout(c.ctx, 2*time.Second)
			snapshot, err := store.Resolve(check, "")
			cancel()

			if err == nil {
				for _, browser := range snapshot.Browsers {
					if browser.Admission == nil {
						continue
					}

					if _, err := c.ensureFeed(browser.Account, browser.Admission.Stream); err != nil {
						c.unavailable(browser.Account)
					}
				}
			} else {
				c.mu.Lock()
				for _, feed := range c.feeds {
					feed.setAvailable(false)
				}

				c.mu.Unlock()
			}

			select {
			case <-c.ctx.Done():
				return
			case <-timer.C:
			}
		}
	}()
}

func (c *browserControls) ensureFeed(account, stream string) (*browserControlFeed, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	feedKey := account + "/" + stream
	if feed := c.feeds[feedKey]; feed != nil {
		return feed, nil
	}

	connection := c.connections[account]
	if connection == nil || !connection.IsConnected() || len(c.feeds) >= 128 || c.ctx.Err() != nil {
		return nil, fmt.Errorf("find browser control connection: %w", auth.ErrUnavailable)
	}

	feed := &browserControlFeed{
		deployment: c.deployment, account: account, stream: stream, connection: connection, server: c.server,
		watermarks: map[string]browserChange{}, sessions: map[uint64]browserSession{}, ready: make(chan struct{}),
	}
	c.feeds[feedKey] = feed
	go feed.run(c.ctx)

	return feed, nil
}

func (c *browserControls) accept(ctx context.Context, request *jwt.AuthorizationRequestClaims, grant *auth.BrowserGrant) error {
	snapshot := policy.ContextSnapshot(ctx)
	if snapshot == nil {
		return fmt.Errorf("require admission snapshot: %w", auth.ErrUnavailable)
	}

	var selected *policy.Browser
	var claims struct {
		Issuer  string `json:"iss"`
		Subject string `json:"sub"`
	}

	if token := request.ConnectOptions.Token; token != "" {
		parts := strings.Split(token, ".")
		if len(parts) != 3 {
			return fmt.Errorf("read approved token: %w", auth.ErrDenied)
		}

		payload, err := base64.RawURLEncoding.DecodeString(parts[1])
		if err != nil || json.Unmarshal(payload, &claims) != nil {
			return fmt.Errorf("read approved claims: %w", auth.ErrDenied)
		}

		for _, browser := range snapshot.Browsers {
			if browser.Issuer == claims.Issuer {
				selected = &browser

				break
			}
		}
	}

	if selected == nil || selected.Admission == nil {
		if grant != nil {
			return fmt.Errorf("reject unexpected browser grant: %w", auth.ErrDenied)
		}

		return nil
	}

	if grant == nil || request.Server.ID != c.server.ID() || request.ClientInformation.ID == 0 ||
		grant.Account != selected.Account || grant.Stream != selected.Admission.Stream || grant.Issuer != claims.Issuer || grant.Subject != claims.Subject ||
		grant.Epoch < 1 || grant.Epoch > 9007199254740991 || grant.ExpiresAt <= time.Now().Unix() || grant.ExpiresAt > time.Now().Add(60*time.Second).Unix() || ctx.Err() != nil {
		return fmt.Errorf("bind browser grant to accepting connection: %w", auth.ErrDenied)
	}

	if !utf8.ValidString(grant.Issuer) || !utf8.ValidString(grant.Subject) || grant.Subject == "" || len(grant.Issuer)+len(grant.Subject) > 1800 {
		return fmt.Errorf("validate browser identity: %w", auth.ErrDenied)
	}

	key := fmt.Sprintf("%d:%s%d:%s", len(grant.Issuer), grant.Issuer, len(grant.Subject), grant.Subject)

	feed, err := c.ensureFeed(grant.Account, grant.Stream)
	if err != nil {
		return fmt.Errorf("prepare browser control feed: %w", err)
	}

	select {
	case <-ctx.Done():
		return fmt.Errorf("wait for browser control replay: %w", ctx.Err())
	case <-c.ctx.Done():
		return fmt.Errorf("wait for browser control runtime: %w", c.ctx.Err())
	case <-feed.ready:
	}

	if err := feed.accept(
		ctx,
		request.ClientInformation.ID,
		browserSession{identity: key, epoch: grant.Epoch, expires: grant.ExpiresAt},
	); err != nil {
		return fmt.Errorf("accept browser session: %w", err)
	}

	return nil
}

type browserControlFeed struct {
	deployment   *maintenance.DeploymentIdentity
	consumer     string
	account      string
	stream       string
	connection   *nats.Conn
	server       *server.Server
	mu           sync.Mutex
	available    bool
	ready        chan struct{}
	readyOnce    sync.Once
	watermarks   map[string]browserChange
	sessions     map[uint64]browserSession
	created      time.Time
	lastSequence uint64
}

func (f *browserControlFeed) current(session browserSession) bool {
	change, exists := f.watermarks[session.identity]

	return !exists || change.Epoch < session.epoch || (change.State == "active" && change.Epoch == session.epoch)
}

func (f *browserControlFeed) accept(ctx context.Context, cid uint64, session browserSession) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if !f.available || !f.connection.IsConnected() || ctx.Err() != nil || !f.current(session) || session.expires <= time.Now().Unix() {
		return fmt.Errorf("register current browser session: %w", auth.ErrDenied)
	}

	f.sessions[cid] = session

	return nil
}

func (f *browserControlFeed) setAvailable(available bool) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.available = available && f.connection.IsConnected()
	if f.available {
		f.readyOnce.Do(func() { close(f.ready) })
	}

	if !f.available {
		for cid := range f.sessions {
			// A closed socket can disappear from the server before its lease expires.
			_ = f.server.DisconnectClientByID(cid)
			delete(f.sessions, cid)
		}
	}
}

func (f *browserControlFeed) apply(change browserChange) {
	f.mu.Lock()
	defer f.mu.Unlock()

	previous, exists := f.watermarks[change.IdentityKey]
	if exists && previous.Epoch > change.Epoch {
		return
	}

	if exists && previous.Epoch == change.Epoch && previous.State != change.State {
		change.State = "blocked"
	}

	f.watermarks[change.IdentityKey] = change
	for cid, session := range f.sessions {
		if (session.identity == change.IdentityKey && !f.current(session)) || session.expires <= time.Now().Unix() {
			_ = f.server.DisconnectClientByID(cid)
			delete(f.sessions, cid)
		}
	}
}

func (f *browserControlFeed) verifyStream(ctx context.Context, js nats.JetStreamContext) error {
	info, err := js.StreamInfo(f.stream, nats.Context(ctx))
	if err != nil {
		return fmt.Errorf("read browser control stream: %w", err)
	}

	if info.Config.Storage != nats.FileStorage || info.Config.Retention != nats.LimitsPolicy || len(info.Config.Subjects) != 1 ||
		info.Config.Subjects[0] != browserChangedSubject || info.Created.IsZero() || (!f.created.IsZero() && !f.created.Equal(info.Created)) || info.State.LastSeq < f.lastSequence {
		return errors.New("invalid browser control stream")
	}

	f.created = info.Created

	return nil
}

func (f *browserControlFeed) run(ctx context.Context) {
	defer f.setAvailable(false)

	for ctx.Err() == nil && f.connection.IsConnected() {
		err := f.consume(ctx)
		f.setAvailable(false)

		if ctx.Err() != nil {
			return
		}

		slog.Warn("browser control feed unavailable",
			"account", f.account,
			"stream", f.stream,
			"error", err,
		)

		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
	}
}

func (f *browserControlFeed) consume(ctx context.Context) error {
	js, err := f.connection.JetStream(nats.MaxWait(time.Second))
	if err != nil {
		return fmt.Errorf("open browser control JetStream: %w", err)
	}

	// A fresh consumer replays the retained control log after every broker start.
	if f.consumer == "" {
		f.consumer = "admission_broker_" + strings.TrimPrefix(nats.NewInbox(), "_INBOX.")
	}

	consumer := f.consumer
	var metadata map[string]string

	if f.deployment != nil {
		encoded, err := json.Marshal(f.deployment)
		if err != nil {
			return fmt.Errorf("encode broker deployment identity: %w", err)
		}

		metadata = map[string]string{
			"lixpi.enforcement.version":    "1",
			"lixpi.enforcement.role":       "broker",
			"lixpi.enforcement.deployment": string(encoded),
		}
	}

	if err := f.verifyStream(ctx, js); err != nil {
		return fmt.Errorf("verify browser control stream: %w", err)
	}

	_, err = js.AddConsumer(f.stream, &nats.ConsumerConfig{
		Durable:       consumer,
		Metadata:      metadata,
		DeliverPolicy: nats.DeliverAllPolicy,
		AckPolicy:     nats.AckExplicitPolicy,
		FilterSubject: browserChangedSubject,
		MaxAckPending: 128,
		AckWait:       10 * time.Second,
	}, nats.Context(ctx))
	if err != nil {
		return fmt.Errorf("create browser control consumer: %w", err)
	}

	sub, err := js.PullSubscribe(browserChangedSubject, consumer, nats.Bind(f.stream, consumer))
	if err != nil {
		return fmt.Errorf("subscribe browser control consumer: %w", err)
	}

	defer func() { _ = sub.Unsubscribe() }()

	for ctx.Err() == nil {
		info, err := js.ConsumerInfo(f.stream, consumer, nats.Context(ctx))
		if err != nil {
			return fmt.Errorf("read browser control consumer: %w", err)
		}

		if err := f.verifyStream(ctx, js); err != nil {
			return fmt.Errorf("verify browser control stream: %w", err)
		}

		if info.NumPending == 0 && info.NumAckPending == 0 {
			f.setAvailable(true)
		} else {
			// Catch-up blocks new grants. Existing sessions are cancelled by their
			// own events; an unrelated account change must not disconnect them.
			f.mu.Lock()
			f.available = false
			f.mu.Unlock()
		}

		messages, err := sub.Fetch(128, nats.MaxWait(250*time.Millisecond))
		if err != nil && !errors.Is(err, nats.ErrTimeout) {
			return fmt.Errorf("fetch browser control event: %w", err)
		}

		for _, message := range messages {
			var change browserChange

			metadata, err := message.Metadata()
			if err != nil || metadata.Sequence.Stream == 0 || message.Subject != browserChangedSubject || len(message.Data) > 4096 ||
				policy.Decode(message.Data, &change) != nil || !validBrowserChange(change) {
				return errors.New("invalid browser control event")
			}

			f.apply(change)
			f.lastSequence = max(f.lastSequence, metadata.Sequence.Stream)

			if err := message.AckSync(nats.Context(ctx)); err != nil {
				return fmt.Errorf("acknowledge browser control event: %w", err)
			}
		}

		f.mu.Lock()
		for cid, session := range f.sessions {
			if session.expires <= time.Now().Unix() {
				delete(f.sessions, cid)
			}
		}

		f.mu.Unlock()
	}

	return nil
}

func validBrowserChange(change browserChange) bool {
	if change.Version != 1 || len(change.EventID) != 36 || change.IdentityKey == "" || len(change.IdentityKey) > 2048 ||
		!utf8.ValidString(change.IdentityKey) || change.Epoch < 1 || change.Epoch > 9007199254740991 {
		return false
	}

	for i, c := range change.EventID {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}

			continue
		}

		if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return false
		}
	}

	return change.State == "active" || change.State == "blocked" || change.State == "reconciling" || change.State == "superseded"
}
