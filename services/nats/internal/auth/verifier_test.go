package auth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"maps"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nkeys"
)

func testToken(t *testing.T, header, claims any, sign func([]byte) ([]byte, error)) string {
	t.Helper()

	h, err := json.Marshal(header)
	if err != nil {
		t.Fatal(err)
	}

	c, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}

	message := base64.RawURLEncoding.EncodeToString(h) + "." + base64.RawURLEncoding.EncodeToString(c)

	signature, err := sign([]byte(message))
	if err != nil {
		t.Fatal(err)
	}

	return message + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func TestServiceJWTAndNKeyVerification(t *testing.T) {
	key, err := nkeys.CreateUser()
	if err != nil {
		t.Fatal(err)
	}

	public, err := key.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	p, err := policy.Transport()
	if err != nil {
		t.Fatal(err)
	}

	v := &Verifier{
		Policy: p,
		Registrations: []Registration{
			{
				UserID:    "svc:test",
				PublicKey: public,
				Account:   "AUTH",
				Permissions: jwt.Permissions{
					Pub: jwt.Permission{Allow: jwt.StringList{"unfamiliar.events"}},
					Sub: jwt.Permission{Deny: jwt.StringList{">"}},
				},
			},
		},
	}
	base := map[string]any{"iss": public, "sub": "svc:test", "exp": time.Now().Add(time.Hour).Unix()}

	for _, test := range []struct {
		name, algorithm string
		mutate          func(map[string]any)
		denied          bool
	}{
		{"valid", "EdDSA", func(map[string]any) {}, false},
		{"wrong algorithm", "none", func(map[string]any) {}, true},
		{"wrong subject", "EdDSA", func(c map[string]any) { c["sub"] = "svc:other" }, true},
		{"expired", "EdDSA", func(c map[string]any) { c["exp"] = time.Now().Add(-time.Second).Unix() }, true},
		{"not yet valid", "EdDSA", func(c map[string]any) { c["nbf"] = time.Now().Add(time.Hour).Unix() }, true},
		{"invalid numeric date", "EdDSA", func(c map[string]any) { c["exp"] = "tomorrow" }, true},
		{"null expiry", "EdDSA", func(c map[string]any) { c["exp"] = nil }, true},
		{"null not-before", "EdDSA", func(c map[string]any) { c["nbf"] = nil }, true},
		{"optional expiry", "EdDSA", func(c map[string]any) { delete(c, "exp") }, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			claims := make(map[string]any)

			maps.Copy(claims, base)

			test.mutate(claims)
			token := testToken(t, map[string]string{"typ": "JWT", "alg": test.algorithm}, claims, key.Sign)
			identity, err := v.Evaluate(
				t.Context(),
				&jwt.AuthorizationRequestClaims{ConnectOptions: jwt.ConnectOptions{Token: token}},
			)

			if test.denied {
				if !errors.Is(err, ErrDenied) {
					t.Fatalf("expected credential denial, got %v", err)
				}

				return
			}

			if err != nil || identity.Name != "svc:test" || identity.Account != "AUTH" {
				t.Fatalf("service verification failed: %v", err)
			}
		})
	}

	nonce := "server-generated-challenge"

	signature, err := key.Sign([]byte(nonce))
	if err != nil {
		t.Fatal(err)
	}

	request := &jwt.AuthorizationRequestClaims{
		ClientInformation: jwt.ClientInformation{Nonce: nonce},
		ConnectOptions:    jwt.ConnectOptions{Nkey: public, SignedNonce: base64.RawURLEncoding.EncodeToString(signature)},
	}

	if _, err := v.Evaluate(t.Context(), request); err != nil {
		t.Fatal(err)
	}

	request.ClientInformation.Nonce = "wrong-challenge"

	if _, err := v.Evaluate(t.Context(), request); !errors.Is(err, ErrDenied) {
		t.Fatal("wrong NKey challenge accepted")
	}

	request.ClientInformation.Nonce = nonce

	request.ConnectOptions.SignedNonce = base64.StdEncoding.EncodeToString(signature)
	if _, err := v.Evaluate(t.Context(), request); err != nil {
		t.Fatal("JavaScript client Base64 NKey signature rejected", err)
	}
}

func TestBrowserJWKSCacheRotationAndOutage(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	var fetches atomic.Int64
	var fail atomic.Bool
	var rotated atomic.Bool
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fetches.Add(1)

		if fail.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)

			return
		}

		id := "first"

		if rotated.Load() {
			id = "second"
		}

		err := json.NewEncoder(w).
			Encode(map[string]any{"keys": []any{map[string]string{"kid": id, "kty": "RSA", "use": "sig", "alg": "RS256", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}}})
		if err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(endpoint.Close)

	p, err := policy.Transport()
	if err != nil {
		t.Fatal(err)
	}

	keys := &JWKS{URL: endpoint.URL, Client: endpoint.Client()}
	v := &Verifier{Policy: p, Keys: keys, Issuer: "https://issuer.example/", Audience: "test-api", Account: "AUTH"}
	create := func(id, audience, issuer, algorithm string) *jwt.AuthorizationRequestClaims {
		token := testToken(
			t,
			map[string]string{"alg": algorithm, "typ": "JWT", "kid": id},
			map[string]any{"sub": "用户|123", "aud": []string{audience}, "iss": issuer, "exp": time.Now().Add(time.Hour).Unix()},
			func(message []byte) ([]byte, error) {
				digest := sha256.Sum256(message)

				return rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
			},
		)

		return &jwt.AuthorizationRequestClaims{ConnectOptions: jwt.ConnectOptions{Token: token}}
	}
	request := create("first", v.Audience, v.Issuer, "RS256")
	var pending sync.WaitGroup

	for range 20 {
		pending.Go(func() {
			if _, err := v.Evaluate(t.Context(), request); err != nil {
				t.Error(err)
			}
		})
	}

	pending.Wait()

	if fetches.Load() != 1 {
		t.Fatalf("concurrent misses fetched %d times", fetches.Load())
	}

	rotated.Store(true)

	if _, err := v.Evaluate(t.Context(), create("second", v.Audience, v.Issuer, "RS256")); err != nil {
		t.Fatal(err)
	}

	fail.Store(true)

	if _, err := v.Evaluate(t.Context(), create("second", v.Audience, v.Issuer, "RS256")); err != nil {
		t.Fatal("cached key unavailable during outage", err)
	}

	if _, err := v.Evaluate(t.Context(), create("missing", v.Audience, v.Issuer, "RS256")); !errors.Is(err, ErrUnavailable) {
		t.Fatal("provider outage was not operational failure")
	}

	for _, request := range []*jwt.AuthorizationRequestClaims{create("second", "wrong", v.Issuer, "RS256"), create("second", v.Audience, "https://wrong/", "RS256"), create("second", v.Audience, v.Issuer, "HS256")} {
		if _, err := v.Evaluate(t.Context(), request); !errors.Is(err, ErrDenied) {
			t.Fatal("invalid browser claims accepted")
		}
	}
}

func TestJWKSCancellationAndRateLimit(t *testing.T) {
	var fetches atomic.Int64
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fetches.Add(1); <-r.Context().Done() }))
	t.Cleanup(endpoint.Close)
	keys := &JWKS{URL: endpoint.URL, Client: endpoint.Client()}

	for range 15 {
		ctx, cancel := context.WithTimeout(t.Context(), 10*time.Millisecond)
		_, err := keys.Key(ctx, "unknown")
		cancel()

		if !errors.Is(err, ErrUnavailable) {
			t.Fatal("stalled JWKS fetch did not fail operationally")
		}
	}

	if fetches.Load() > 10 {
		t.Fatal("JWKS refresh rate exceeded ten per minute")
	}
}
