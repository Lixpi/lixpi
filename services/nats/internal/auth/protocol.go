package auth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/policy"

	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nkeys"
)

type Protocol struct {
	Signer nkeys.KeyPair
	Curve  nkeys.KeyPair
	Issuer string
}

func NewProtocol(issuerSeed, curveSeed string) (*Protocol, error) {
	signer, err := nkeys.FromSeed([]byte(issuerSeed))
	if err != nil {
		return nil, errors.New("invalid callout issuer seed")
	}

	issuer, err := signer.PublicKey()
	if err != nil || !nkeys.IsValidPublicAccountKey(issuer) {
		return nil, errors.New("callout issuer must be an account key")
	}

	curve, err := nkeys.FromSeed([]byte(curveSeed))
	if err != nil {
		return nil, errors.New("invalid callout curve seed")
	}

	public, err := curve.PublicKey()
	if err != nil || !nkeys.IsValidPublicCurveKey(public) {
		return nil, errors.New("callout encryption requires a curve key")
	}

	return &Protocol{Signer: signer, Curve: curve, Issuer: issuer}, nil
}

func (p *Protocol) Open(payload []byte, serverXKey string) (*jwt.AuthorizationRequestClaims, error) {
	if !nkeys.IsValidPublicCurveKey(serverXKey) || len(payload) > 65536 {
		return nil, errors.New("invalid callout envelope")
	}

	plaintext, err := p.Curve.Open(payload, serverXKey)
	if err != nil {
		return nil, errors.New("invalid callout encryption")
	}

	parts := strings.Split(string(plaintext), ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid callout encoding")
	}

	var header struct {
		Algorithm string `json:"alg"`
		Type      string `json:"typ"`
	}

	encoded, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(encoded, &header) != nil || header.Algorithm != "ed25519-nkey" || header.Type != "JWT" {
		return nil, errors.New("invalid callout JWT header")
	}

	request, err := jwt.DecodeAuthorizationRequestClaims(string(plaintext))
	if err != nil {
		return nil, errors.New("invalid callout signature")
	}

	now := time.Now().Unix()
	if request.Issuer != request.Server.ID || !nkeys.IsValidPublicServerKey(request.Issuer) ||
		request.Subject != p.Issuer || request.Audience != "nats-authorization-request" ||
		request.Version != 2 || request.Type != jwt.AuthorizationRequestClaim ||
		request.Server.XKey != serverXKey || !nkeys.IsValidPublicUserKey(request.UserNkey) ||
		request.IssuedAt <= 0 || request.IssuedAt > now || request.Expires <= now ||
		request.Expires <= request.IssuedAt || request.NotBefore > now {
		return nil, errors.New("invalid callout claims or deadline")
	}

	return request, nil
}

type Identity struct {
	Name        string
	Account     string
	Permissions jwt.Permissions
}

func (p *Protocol) Reply(request *jwt.AuthorizationRequestClaims, identity *Identity, denial string) ([]byte, error) {
	response := jwt.NewAuthorizationResponseClaims(request.UserNkey)
	response.Audience = request.Server.ID
	response.Expires = request.Expires

	if identity != nil {
		if identity.Account == "" || identity.Account == "SYS" || identity.Account == "CALLOUT" || identity.Account == policy.RegistryAccount ||
			identity.Name == "" {
			return nil, errors.New("invalid application identity")
		}

		user := jwt.NewUserClaims(request.UserNkey)
		user.Name = identity.Name
		user.Audience = identity.Account
		user.Permissions = identity.Permissions

		encoded, err := user.Encode(p.Signer)
		if err != nil {
			return nil, err
		}

		response.Jwt = encoded
	} else {
		if denial == "" {
			denial = "authentication unavailable"
		}

		response.Error = denial
	}

	encoded, err := response.Encode(p.Signer)
	if err != nil {
		return nil, err
	}

	return p.Curve.Seal([]byte(encoded), request.Server.XKey)
}
