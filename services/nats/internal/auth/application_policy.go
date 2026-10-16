package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
)

type PolicyRequest struct {
	ApplicationRevision string          `json:"applicationRevision"`
	Version             int             `json:"version"`
	Nonce               string          `json:"nonce"`
	Revision            string          `json:"revision"`
	UserNkey            string          `json:"userNKey"`
	Issuer              string          `json:"issuer"`
	Subject             string          `json:"subject"`
	Audience            string          `json:"audience"`
	Claim               json.RawMessage `json:"claim"`
	TokenExpiresAt      int64           `json:"tokenExpiresAt"`
	GrantExpiresAt      int64           `json:"grantExpiresAt"`
}

type PolicyDecision struct {
	ApplicationRevision string `json:"applicationRevision"`
	Version             int    `json:"version"`
	Nonce               string `json:"nonce"`
	Revision            string `json:"revision"`
	UserNkey            string `json:"userNKey"`
	Subject             string `json:"subject"`
	Allowed             bool   `json:"allowed"`
	Epoch               int64  `json:"epoch"`
	ExpiresAt           int64  `json:"expiresAt"`
}

type BrowserGrant struct {
	Account   string `json:"account"`
	Stream    string `json:"stream"`
	Issuer    string `json:"issuer"`
	Subject   string `json:"subject"`
	Epoch     int64  `json:"epoch"`
	ExpiresAt int64  `json:"expiresAt"`
}

type ApplicationPolicy struct {
	mu          sync.RWMutex
	connections map[string]*nats.Conn
}

func (p *ApplicationPolicy) Register(account string, connection *nats.Conn) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.connections == nil {
		p.connections = map[string]*nats.Conn{}
	}

	p.connections[account] = connection
}

func (p *ApplicationPolicy) Check(
	ctx context.Context,
	browser policy.Browser,
	revision string,
	request *jwt.AuthorizationRequestClaims,
	claims map[string]json.RawMessage,
	identity *Identity,
) error {
	if browser.Admission == nil {
		return nil
	}

	var epoch struct {
		Version int   `json:"v"`
		Epoch   int64 `json:"epoch"`
	}
	claim := claims[browser.Admission.Claim]

	var tokenExpiry int64
	if browser.Admission.Subject != policy.BrowserAdmissionSubject || json.Unmarshal(claim, &epoch) != nil || epoch.Version != 1 ||
		epoch.Epoch < 1 || epoch.Epoch > 9007199254740991 || json.Unmarshal(claims["exp"], &tokenExpiry) != nil || tokenExpiry <= time.Now().Unix() ||
		!nkeys.IsValidPublicUserKey(request.UserNkey) || len(revision) != 64 || len(browser.RegistrationDigest) != 64 {
		return fmt.Errorf("validate browser admission inputs: %w", ErrDenied)
	}

	p.mu.RLock()
	connection := p.connections[browser.Account]
	p.mu.RUnlock()

	if connection == nil || !connection.IsConnected() {
		return fmt.Errorf("find application policy connection: %w", ErrUnavailable)
	}

	var nonce [32]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return fmt.Errorf("create application policy nonce: %w", err)
	}

	query := PolicyRequest{
		ApplicationRevision: browser.RegistrationDigest,
		Version:             1,
		Nonce:               hex.EncodeToString(nonce[:]),
		Revision:            revision,
		UserNkey:            request.UserNkey,
		Issuer:              browser.Issuer,
		Subject:             identity.Name,
		Audience:            browser.Audience,
		Claim:               claim,
		TokenExpiresAt:      tokenExpiry,
		GrantExpiresAt:      identity.Expires,
	}

	encoded, err := json.Marshal(query)
	if err != nil {
		return fmt.Errorf("encode application policy request: %w", err)
	}

	reply, err := connection.RequestWithContext(ctx, browser.Admission.Subject, encoded)
	if err != nil {
		return fmt.Errorf("request application policy: %w", ErrUnavailable)
	}

	var decision PolicyDecision
	if len(reply.Data) > 8192 || policy.Decode(reply.Data, &decision) != nil || decision.Version != 1 || decision.Nonce != query.Nonce ||
		decision.Revision != query.Revision || decision.ApplicationRevision != query.ApplicationRevision || decision.UserNkey != query.UserNkey || decision.Subject != query.Subject || !decision.Allowed ||
		decision.Epoch != epoch.Epoch || decision.ExpiresAt <= time.Now().Unix() || decision.ExpiresAt > identity.Expires || ctx.Err() != nil {
		return fmt.Errorf("validate application policy decision: %w", ErrDenied)
	}

	identity.Expires = decision.ExpiresAt
	identity.Admission = &BrowserGrant{
		Account:   browser.Account,
		Stream:    browser.Admission.Stream,
		Issuer:    query.Issuer,
		Subject:   query.Subject,
		Epoch:     decision.Epoch,
		ExpiresAt: decision.ExpiresAt,
	}

	return nil
}
