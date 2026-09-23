package auth

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nkeys"
)

var (
	ErrDenied      = errors.New("credentials denied")
	ErrUnavailable = errors.New("verification unavailable")
)

type Evaluator interface {
	Evaluate(context.Context, *jwt.AuthorizationRequestClaims) (*Identity, error)
}

type Verifier struct {
	Policy        *policy.Policy
	Registrations []Registration
	Keys          *JWKS
	Issuer        string
	Audience      string
	Account       string
}

type tokenHeader struct {
	Algorithm string `json:"alg"`
	Type      string `json:"typ"`
	KeyID     string `json:"kid"`
}
type tokenClaims struct {
	Issuer    string          `json:"iss"`
	Subject   string          `json:"sub"`
	Audience  json.RawMessage `json:"aud"`
	Expires   numericDate     `json:"exp"`
	NotBefore numericDate     `json:"nbf"`
}

type numericDate struct {
	Seconds float64
	Present bool
}

func (d *numericDate) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		return fmt.Errorf("decode null numeric date: %w", ErrDenied)
	}

	if err := json.Unmarshal(data, &d.Seconds); err != nil {
		return fmt.Errorf("decode numeric date: %w", err)
	}

	d.Present = true

	return nil
}

func (v *Verifier) Evaluate(ctx context.Context, request *jwt.AuthorizationRequestClaims) (*Identity, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("start credential verification: %w", ErrUnavailable)
	}

	options := request.ConnectOptions
	if options.Token != "" {
		identity, err := v.verifyToken(ctx, options.Token)
		if err != nil {
			return nil, fmt.Errorf("verify connect token: %w", err)
		}

		return identity, nil
	}

	nonce := request.RequestNonce
	if nonce == "" {
		nonce = request.ClientInformation.Nonce
	}

	if nonce == "" || options.Nkey == "" || options.SignedNonce == "" {
		return nil, fmt.Errorf("read nonce credentials: %w", ErrDenied)
	}

	for _, registration := range v.Registrations {
		if registration.PublicKey != options.Nkey {
			continue
		}

		key, err := nkeys.FromPublicKey(registration.PublicKey)
		if err != nil {
			return nil, fmt.Errorf("decode registered key for service %q: %w", registration.UserID, ErrDenied)
		}

		signature, err := base64.RawURLEncoding.DecodeString(options.SignedNonce)
		if err != nil {
			signature, err = base64.StdEncoding.DecodeString(options.SignedNonce)
		}

		if err != nil || key.Verify([]byte(nonce), signature) != nil {
			return nil, fmt.Errorf("verify nonce signature for service %q: %w", registration.UserID, ErrDenied)
		}

		return &Identity{Name: registration.UserID, Account: registration.Account, Permissions: registration.Permissions}, nil
	}

	return nil, fmt.Errorf("find registered service key: %w", ErrDenied)
}

func (v *Verifier) verifyToken(ctx context.Context, token string) (*Identity, error) {
	if len(token) > 32768 {
		return nil, fmt.Errorf("check token size: %w", ErrDenied)
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("split token: %w", ErrDenied)
	}

	var header tokenHeader
	var claims tokenClaims

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(headerBytes, &header) != nil {
		return nil, fmt.Errorf("decode token header: %w", ErrDenied)
	}

	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(claimsBytes, &claims) != nil {
		return nil, fmt.Errorf("decode token claims: %w", ErrDenied)
	}

	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || claims.Subject == "" {
		return nil, fmt.Errorf("read token signature and subject: %w", ErrDenied)
	}

	now := float64(time.Now().UnixNano()) / 1e9
	if (claims.Expires.Present && claims.Expires.Seconds <= now) || (claims.NotBefore.Present && claims.NotBefore.Seconds > now) {
		return nil, fmt.Errorf("check token validity window: %w", ErrDenied)
	}

	message := []byte(parts[0] + "." + parts[1])

	for _, registration := range v.Registrations {
		if claims.Issuer != registration.PublicKey {
			continue
		}

		if header.Algorithm != "EdDSA" || claims.Subject != registration.UserID {
			return nil, fmt.Errorf("match service token algorithm and subject: %w", ErrDenied)
		}

		key, err := nkeys.FromPublicKey(registration.PublicKey)
		if err != nil || key.Verify(message, signature) != nil {
			return nil, fmt.Errorf("verify service token signature for %q: %w", registration.UserID, ErrDenied)
		}

		return &Identity{Name: registration.UserID, Account: registration.Account, Permissions: registration.Permissions}, nil
	}

	if v.Policy == nil || v.Account == "" || header.Algorithm != "RS256" || claims.Issuer != v.Issuer ||
		!audienceMatches(claims.Audience, v.Audience) {
		return nil, fmt.Errorf("match browser token profile: %w", ErrDenied)
	}

	if v.Keys == nil {
		return nil, fmt.Errorf("find browser key set: %w", ErrUnavailable)
	}

	key, err := v.Keys.Key(ctx, header.KeyID)
	if err != nil {
		return nil, fmt.Errorf("load browser signing key: %w", err)
	}

	digest := sha256.Sum256(message)
	if rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature) != nil {
		return nil, fmt.Errorf("verify browser token signature: %w", ErrDenied)
	}

	if claims.Expires.Present && claims.Expires.Seconds <= float64(time.Now().UnixNano())/1e9 {
		return nil, fmt.Errorf("check browser token expiry: %w", ErrDenied)
	}

	if ctx.Err() != nil {
		return nil, fmt.Errorf("finish browser token verification: %w", ErrUnavailable)
	}

	permissions, err := v.Policy.BrowserPermissions(claims.Subject)
	if err != nil {
		return nil, fmt.Errorf("resolve browser permissions: %w", ErrDenied)
	}

	return &Identity{Name: claims.Subject, Account: v.Account, Permissions: permissions}, nil
}

func audienceMatches(encoded json.RawMessage, expected string) bool {
	if expected == "" {
		return false
	}

	var single string

	if json.Unmarshal(encoded, &single) == nil {
		return single == expected
	}

	var multiple []string

	if json.Unmarshal(encoded, &multiple) != nil {
		return false
	}

	return slices.Contains(multiple, expected)
}
