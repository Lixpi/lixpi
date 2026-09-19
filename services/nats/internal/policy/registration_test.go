package policy

import (
	"encoding/json"
	"testing"

	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nkeys"
)

func signedFixture(t *testing.T) (Trust, nkeys.KeyPair, Manifest) {
	t.Helper()

	authority, err := nkeys.CreateAccount()
	if err != nil {
		t.Fatal(err)
	}

	public, err := authority.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	user, err := nkeys.CreateUser()
	if err != nil {
		t.Fatal(err)
	}

	userPublic, err := user.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	trust := Trust{Authorities: []Authority{{PublicKey: public, Owner: "component", Accounts: []string{"EXAMPLE"}}}}
	m := Manifest{
		Schema:  1,
		Owner:   "component",
		Version: 1,
		Services: []Service{
			{
				UserID:    "unexpected-client",
				PublicKey: userPublic,
				Account:   "EXAMPLE",
				Permissions: jwt.Permissions{
					Pub: jwt.Permission{Allow: jwt.StringList{"new.request"}},
					Sub: jwt.Permission{Deny: jwt.StringList{">"}},
				},
			},
		},
	}

	return trust, authority, m
}

func signFixture(t *testing.T, key nkeys.KeyPair, manifest Manifest) SignedRegistration {
	t.Helper()

	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}

	signature, err := key.Sign(payload)
	if err != nil {
		t.Fatal(err)
	}

	public, err := key.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	return SignedRegistration{Issuer: public, Payload: payload, Signature: signature}
}

func TestRegistrationTrustAndValidation(t *testing.T) {
	trust, key, m := signedFixture(t)
	if err := trust.Validate(); err != nil {
		t.Fatal(err)
	}

	signed := signFixture(t, key, m)
	if _, err := trust.Verify(signed); err != nil {
		t.Fatal(err)
	}

	for _, change := range []func(*Manifest){
		func(m *Manifest) { m.Owner = "other" },
		func(m *Manifest) { m.Schema = 2 },
		func(m *Manifest) { m.Version = 0 },
		func(m *Manifest) { m.Services[0].Account = "SYS" },
		func(m *Manifest) { m.Services[0].PublicKey = "invalid" },
		func(m *Manifest) { m.Services[0].Permissions.Pub.Allow = jwt.StringList{"bad.>.tail"} },
		func(m *Manifest) { m.Services[0].Permissions.Sub.Deny = nil },
	} {
		var candidate Manifest
		if err := json.Unmarshal(signed.Payload, &candidate); err != nil {
			t.Fatal(err)
		}

		change(&candidate)

		if _, err := trust.Verify(signFixture(t, key, candidate)); err == nil {
			t.Fatal("invalid signed registration accepted")
		}
	}

	signed.Payload[0] ^= 1
	if _, err := trust.Verify(signed); err == nil {
		t.Fatal("tampered payload accepted")
	}

	_, untrusted, _ := signedFixture(t)
	if _, err := trust.Verify(signFixture(t, untrusted, m)); err == nil {
		t.Fatal("untrusted signer accepted")
	}

	signed = signFixture(t, key, m)
	if _, err := trust.Compile([]SignedRegistration{signed, signed}); err == nil {
		t.Fatal("duplicate owner accepted")
	}

	m.Owner = "component-two"
	otherPublic, _ := untrusted.PublicKey()

	trust.Authorities = append(trust.Authorities, Authority{PublicKey: otherPublic, Owner: m.Owner, Accounts: []string{"EXAMPLE"}})
	if _, err := trust.Compile([]SignedRegistration{signed, signFixture(t, untrusted, m)}); err == nil {
		t.Fatal("duplicate identity across owners accepted")
	}
}
