package auth

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nkeys"
)

func protocolFixture(t *testing.T) (*Protocol, nkeys.KeyPair, nkeys.KeyPair, *jwt.AuthorizationRequestClaims) {
	t.Helper()

	issuer, err := nkeys.CreateAccount()
	if err != nil {
		t.Fatal(err)
	}

	curve, err := nkeys.CreateCurveKeys()
	if err != nil {
		t.Fatal(err)
	}

	issuerSeed, err := issuer.Seed()
	if err != nil {
		t.Fatal(err)
	}

	curveSeed, err := curve.Seed()
	if err != nil {
		t.Fatal(err)
	}

	protocol, err := NewProtocol(string(issuerSeed), string(curveSeed))
	if err != nil {
		t.Fatal(err)
	}

	serverKey, err := nkeys.CreateServer()
	if err != nil {
		t.Fatal(err)
	}

	serverCurve, err := nkeys.CreateCurveKeys()
	if err != nil {
		t.Fatal(err)
	}

	serverID, err := serverKey.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	xkey, err := serverCurve.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	user, err := nkeys.CreateUser()
	if err != nil {
		t.Fatal(err)
	}

	userID, err := user.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	request := jwt.NewAuthorizationRequestClaims(protocol.Issuer)
	request.Audience = "nats-authorization-request"
	request.Expires = time.Now().Add(3 * time.Second).Unix()
	request.UserNkey = userID
	request.Server = jwt.ServerID{ID: serverID, XKey: xkey}

	return protocol, serverKey, serverCurve, request
}

func TestCalloutValidationAndNonExpiringSession(t *testing.T) {
	protocol, serverKey, serverCurve, request := protocolFixture(t)

	encoded, err := request.Encode(serverKey)
	if err != nil {
		t.Fatal(err)
	}

	public, err := protocol.Curve.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	payload, err := serverCurve.Seal([]byte(encoded), public)
	if err != nil {
		t.Fatal(err)
	}

	verified, err := protocol.Open(payload, request.Server.XKey)
	if err != nil {
		t.Fatal(err)
	}

	response, err := protocol.Reply(
		verified,
		&Identity{
			Name:    "user",
			Account: "AUTH",
			Permissions: jwt.Permissions{
				Pub: jwt.Permission{Allow: jwt.StringList{"user.get"}},
				Sub: jwt.Permission{Allow: jwt.StringList{"_INBOX.user.>"}},
			},
		},
		"",
	)
	if err != nil {
		t.Fatal(err)
	}

	plaintext, err := serverCurve.Open(response, public)
	if err != nil {
		t.Fatal(err)
	}

	claims, err := jwt.DecodeAuthorizationResponseClaims(string(plaintext))
	if err != nil {
		t.Fatal(err)
	}

	user, err := jwt.DecodeUserClaims(claims.Jwt)
	if err != nil {
		t.Fatal(err)
	}

	if user.Expires != 0 || user.Name != "user" || user.Audience != "AUTH" || claims.Subject != request.UserNkey ||
		claims.Audience != request.Server.ID {
		t.Fatal("session or response binding changed")
	}

	for _, account := range []string{"SYS", "CALLOUT", ""} {
		if _, err := protocol.Reply(verified, &Identity{Name: "user", Account: account}, ""); err == nil {
			t.Fatal("forbidden account accepted")
		}
	}
}

func TestCalloutRejectsInvalidClaims(t *testing.T) {
	protocol, serverKey, serverCurve, request := protocolFixture(t)

	encoded, err := request.Encode(serverKey)
	if err != nil {
		t.Fatal(err)
	}

	parts := strings.Split(encoded, ".")
	decode := func(part string) map[string]any {
		data, err := base64.RawURLEncoding.DecodeString(part)
		if err != nil {
			t.Fatal(err)
		}

		var object map[string]any

		if err := json.Unmarshal(data, &object); err != nil {
			t.Fatal(err)
		}

		return object
	}

	public, err := protocol.Curve.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	for _, test := range []struct {
		name   string
		mutate func(map[string]any, map[string]any)
	}{
		{"algorithm", func(h, c map[string]any) { h["alg"] = "none" }},
		{"type", func(h, c map[string]any) { h["typ"] = "other" }},
		{"audience", func(h, c map[string]any) { c["aud"] = "wrong" }},
		{"account", func(h, c map[string]any) { c["sub"] = "AUTH" }},
		{"expiry", func(h, c map[string]any) { c["exp"] = time.Now().Add(-time.Second).Unix() }},
		{"future issue", func(h, c map[string]any) { c["iat"] = time.Now().Add(time.Hour).Unix() }},
		{"version", func(h, c map[string]any) { c["nats"].(map[string]any)["version"] = 3 }},
		{"request type", func(h, c map[string]any) { c["nats"].(map[string]any)["type"] = "user" }},
		{"user key", func(h, c map[string]any) { c["nats"].(map[string]any)["user_nkey"] = "invalid" }},
		{"server binding", func(h, c map[string]any) { c["nats"].(map[string]any)["server_id"].(map[string]any)["id"] = "invalid" }},
		{"xkey binding", func(h, c map[string]any) {
			c["nats"].(map[string]any)["server_id"].(map[string]any)["xkey"] = "invalid"
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			header, claims := decode(parts[0]), decode(parts[1])
			test.mutate(header, claims)
			invalid := testToken(t, header, claims, serverKey.Sign)

			payload, err := serverCurve.Seal([]byte(invalid), public)
			if err != nil {
				t.Fatal(err)
			}

			if _, err := protocol.Open(payload, request.Server.XKey); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
}
