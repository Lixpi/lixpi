package main

import (
	"fmt"
	"strings"
	"testing"

	"github.com/nats-io/nkeys"
)

func TestServeReportsRegistrationConfigurationBeforeStarting(t *testing.T) {
	key, err := nkeys.CreateAccount()
	if err != nil {
		t.Fatal(err)
	}

	public, err := key.PublicKey()
	if err != nil {
		t.Fatal(err)
	}

	authorities := fmt.Sprintf(`[{"publicKey":%q,"owner":"test","accounts":["APP"]}]`, public)

	for _, test := range []struct {
		name, authorities, password, want string
	}{
		{"missing authorities", "", "", "NATS_REGISTRATION_AUTHORITIES is required; save the selected environment through init-config's partial-update flow"},
		{"blank authorities", " \n ", "", "NATS_REGISTRATION_AUTHORITIES is required; save the selected environment through init-config's partial-update flow"},
		{"malformed authorities", "not-json", "synthetic", "NATS_REGISTRATION_AUTHORITIES must be a JSON array"},
		{"empty authority scope", "[]", "synthetic", "invalid NATS_REGISTRATION_AUTHORITIES: registration authorities required"},
		{"missing password", authorities, "", "NATS_REGISTRATION_PASSWORD is required; save the selected environment through init-config's partial-update flow"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("NATS_REGISTRATION_AUTHORITIES", test.authorities)
			t.Setenv("NATS_REGISTRATION_PASSWORD", test.password)

			err := serve(t.Context(), "missing.conf", "", false)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected configuration error %q, got %v", test.want, err)
			}
		})
	}
}
