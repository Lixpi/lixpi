package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"

	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/jwt/v2"
)

type Registration = policy.Service

// RuntimeVerifier uses the snapshot pinned by the originating coordinator.
type RuntimeVerifier struct {
	mu   sync.Mutex
	keys map[string]*JWKS
}

func (v *RuntimeVerifier) Evaluate(ctx context.Context, request *jwt.AuthorizationRequestClaims) (*Identity, error) {
	snapshot := policy.ContextSnapshot(ctx)
	if snapshot == nil {
		return nil, ErrUnavailable
	}

	verifier := &Verifier{Registrations: snapshot.Services}

	if token := request.ConnectOptions.Token; token != "" {
		if len(token) > 32768 {
			return nil, ErrDenied
		}

		parts := strings.Split(token, ".")
		if len(parts) != 3 {
			return nil, ErrDenied
		}

		encoded, err := base64.RawURLEncoding.DecodeString(parts[1])

		var claims tokenClaims
		if err != nil || json.Unmarshal(encoded, &claims) != nil {
			return nil, ErrDenied
		}

		for _, browser := range snapshot.Browsers {
			if browser.Issuer != claims.Issuer {
				continue
			}

			verifier.Issuer, verifier.Audience, verifier.Account = browser.Issuer, browser.Audience, browser.Account
			verifier.Policy = &policy.Policy{Browser: browser.Permissions}
			verifier.Keys = v.jwks(browser.JWKSURL, snapshot.Browsers)

			break
		}
	}

	return verifier.Evaluate(ctx, request)
}

func (v *RuntimeVerifier) jwks(address string, profiles []policy.Browser) *JWKS {
	v.mu.Lock()
	defer v.mu.Unlock()

	if v.keys == nil {
		v.keys = map[string]*JWKS{}
	}

	active := map[string]bool{}

	for _, profile := range profiles {
		active[profile.JWKSURL] = true
	}

	for address := range v.keys {
		if !active[address] {
			delete(v.keys, address)
		}
	}

	if v.keys[address] == nil {
		v.keys[address] = &JWKS{URL: address}
	}

	return v.keys[address]
}
