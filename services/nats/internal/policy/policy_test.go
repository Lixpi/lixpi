package policy

import (
	"encoding/hex"
	"slices"
	"strings"
	"testing"

	"github.com/nats-io/jwt/v2"
)

func TestRegisteredPermissionTemplates(t *testing.T) {
	templates := []jwt.Permissions{
		{
			Pub: jwt.Permission{Allow: jwt.StringList{"novel.request", "_INBOX.{subjectToken}.>"}},
			Sub: jwt.Permission{Allow: jwt.StringList{"_INBOX.{subjectToken}.>", "novel.events.{subjectToken}.>"}},
		},
	}

	for _, identity := range []string{"auth0|123", "用户|é🙂", "a.*.>"} {
		grants, err := Expand(templates, identity)
		if err != nil {
			t.Fatal(err)
		}

		if !slices.Contains(grants.Sub.Allow, "_INBOX."+hex.EncodeToString([]byte(identity))+".>") {
			t.Fatal("identity encoding mismatch")
		}

		for _, subject := range grants.Sub.Allow {
			if strings.ContainsAny(subject, "{}") {
				t.Fatal("unresolved template")
			}
		}
	}

	if _, err := Expand(templates, ""); err == nil {
		t.Fatal("empty identity accepted")
	}

	if _, err := Expand([]jwt.Permissions{{Pub: jwt.Permission{Allow: jwt.StringList{"events.{subject}.>"}}}}, "a.*"); err == nil {
		t.Fatal("raw identity widened permissions")
	}

	empty, err := Expand(nil, "user")
	if err != nil || !slices.Contains(empty.Pub.Deny, ">") || !slices.Contains(empty.Sub.Deny, ">") {
		t.Fatal("empty grants became unrestricted")
	}

	p, err := Transport()
	if err != nil {
		t.Fatal(err)
	}

	bootstrap := p.BootstrapPermissions("node1")
	if !slices.Contains(bootstrap.Sub.Allow, p.Subjects.Protocol.Auth.Worker+".node1") {
		t.Fatal("bootstrap worker subscription is not node scoped")
	}
}
