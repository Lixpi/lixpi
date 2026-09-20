package auth

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/jwt/v2"
)

func TestRuntimeBrowserUsesPinnedRegistration(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if err := json.NewEncoder(w).
			Encode(map[string]any{"keys": []any{map[string]string{"kid": "test", "kty": "RSA", "use": "sig", "alg": "RS256", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}}}); err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(endpoint.Close)
	snapshot := &policy.Snapshot{
		Browsers: []policy.Browser{
			{
				Issuer:   "https://arbitrary.example/",
				Audience: "independent-app",
				JWKSURL:  endpoint.URL,
				Account:  "CLIENTS",
				Permissions: []jwt.Permissions{
					{Pub: jwt.Permission{Allow: jwt.StringList{"events.{subjectToken}"}}, Sub: jwt.Permission{Deny: jwt.StringList{">"}}},
				},
			},
		},
	}
	token := testToken(
		t,
		map[string]string{"alg": "RS256", "kid": "test"},
		map[string]any{"iss": "https://arbitrary.example/", "aud": "independent-app", "sub": "user.*", "exp": time.Now().Add(time.Minute).Unix()},
		func(message []byte) ([]byte, error) {
			digest := sha256.Sum256(message)

			return rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
		},
	)
	request := &jwt.AuthorizationRequestClaims{ConnectOptions: jwt.ConnectOptions{Token: token}}
	verifier := &RuntimeVerifier{}
	pinned := policy.WithSnapshot(t.Context(), snapshot)

	identity, err := verifier.Evaluate(pinned, request)
	if err != nil || identity.Account != "CLIENTS" || identity.Permissions.Pub.Allow[0] != "events."+policy.UserToken("user.*") {
		t.Fatal("registered browser profile not applied", identity, err)
	}

	if _, err := verifier.Evaluate(t.Context(), request); !errors.Is(err, ErrUnavailable) {
		t.Fatal("missing authoritative snapshot accepted", err)
	}

	if _, err := verifier.Evaluate(policy.WithSnapshot(t.Context(), &policy.Snapshot{}), request); !errors.Is(err, ErrDenied) {
		t.Fatal("removed browser profile accepted", err)
	}

	if _, err := verifier.Evaluate(pinned, request); err != nil {
		t.Fatal("pinned request changed during registration update", err)
	}
}
