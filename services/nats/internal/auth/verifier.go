package auth

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
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
		return ErrDenied
	}

	if err := json.Unmarshal(data, &d.Seconds); err != nil {
		return err
	}

	d.Present = true

	return nil
}

func (v *Verifier) Evaluate(ctx context.Context, request *jwt.AuthorizationRequestClaims) (*Identity, error) {
	if err := ctx.Err(); err != nil {
		return nil, ErrUnavailable
	}

	options := request.ConnectOptions
	if options.Token != "" {
		return v.verifyToken(ctx, options.Token)
	}

	nonce := request.RequestNonce
	if nonce == "" {
		nonce = request.ClientInformation.Nonce
	}

	if nonce == "" || options.Nkey == "" || options.SignedNonce == "" {
		return nil, ErrDenied
	}

	for _, registration := range v.Registrations {
		if registration.PublicKey != options.Nkey {
			continue
		}

		key, err := nkeys.FromPublicKey(registration.PublicKey)
		if err != nil {
			return nil, ErrDenied
		}

		signature, err := base64.RawURLEncoding.DecodeString(options.SignedNonce)
		if err != nil {
			signature, err = base64.StdEncoding.DecodeString(options.SignedNonce)
		}

		if err != nil || key.Verify([]byte(nonce), signature) != nil {
			return nil, ErrDenied
		}

		return &Identity{Name: registration.UserID, Account: registration.Account, Permissions: registration.Permissions}, nil
	}

	return nil, ErrDenied
}

func (v *Verifier) verifyToken(ctx context.Context, token string) (*Identity, error) {
	if len(token) > 32768 {
		return nil, ErrDenied
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, ErrDenied
	}

	var header tokenHeader
	var claims tokenClaims

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(headerBytes, &header) != nil {
		return nil, ErrDenied
	}

	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(claimsBytes, &claims) != nil {
		return nil, ErrDenied
	}

	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || claims.Subject == "" {
		return nil, ErrDenied
	}

	now := float64(time.Now().UnixNano()) / 1e9
	if (claims.Expires.Present && claims.Expires.Seconds <= now) || (claims.NotBefore.Present && claims.NotBefore.Seconds > now) {
		return nil, ErrDenied
	}

	message := []byte(parts[0] + "." + parts[1])

	for _, registration := range v.Registrations {
		if claims.Issuer != registration.PublicKey {
			continue
		}

		if header.Algorithm != "EdDSA" || claims.Subject != registration.UserID {
			return nil, ErrDenied
		}

		key, err := nkeys.FromPublicKey(registration.PublicKey)
		if err != nil || key.Verify(message, signature) != nil {
			return nil, ErrDenied
		}

		return &Identity{Name: registration.UserID, Account: registration.Account, Permissions: registration.Permissions}, nil
	}

	if v.Policy == nil || v.Account == "" || header.Algorithm != "RS256" || claims.Issuer != v.Issuer ||
		!audienceMatches(claims.Audience, v.Audience) {
		return nil, ErrDenied
	}

	if v.Keys == nil {
		return nil, ErrUnavailable
	}

	key, err := v.Keys.Key(ctx, header.KeyID)
	if err != nil {
		return nil, err
	}

	digest := sha256.Sum256(message)
	if rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature) != nil {
		return nil, ErrDenied
	}

	if claims.Expires.Present && claims.Expires.Seconds <= float64(time.Now().UnixNano())/1e9 {
		return nil, ErrDenied
	}

	if ctx.Err() != nil {
		return nil, ErrUnavailable
	}

	permissions, err := v.Policy.BrowserPermissions(claims.Subject)
	if err != nil {
		return nil, ErrDenied
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
