package policy

import (
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/nats-io/jwt/v2"
)

const (
	RegistrationSubject = "$TRANSPORT.REGISTRATION.APPLY"
	RegistrationInbox   = "_REGISTRATION_REPLY"
	RegistryAccount     = "REGISTRATION"
	ProtocolVersion     = "runtime-registration-v1"
)

type AuthSubjects struct {
	Request, Queue, Membership, Discover, Worker, Reply, Probe string
}

type JetStreamSubjects struct {
	ServerEvacuate, ServerRemove, StreamList, StreamInfo, StreamSnapshot, StreamRestore string
}

// Policy contains transport protocol definitions. Application grants arrive as registrations.
type Policy struct {
	Browser  []jwt.Permissions
	Subjects struct {
		Protocol struct {
			Auth      AuthSubjects
			JetStream JetStreamSubjects
		}
	}
	Digest string
}

func Transport() (*Policy, error) {
	p := &Policy{Digest: ProtocolVersion}
	p.Subjects.Protocol.Auth = AuthSubjects{
		Request: "$SYS.REQ.USER.AUTH", Queue: "nats-auth",
		Membership: "$TRANSPORT.AUTH.MEMBERSHIP", Discover: "$TRANSPORT.AUTH.DISCOVER",
		Worker: "$TRANSPORT.AUTH.WORKER", Reply: "$TRANSPORT.AUTH.REPLY", Probe: "$TRANSPORT.AUTH.PROBE",
	}
	p.Subjects.Protocol.JetStream = JetStreamSubjects{
		ServerEvacuate: "$JS.API.SERVER.EVACUATE", ServerRemove: "$JS.API.SERVER.REMOVE",
		StreamList: "$JS.API.STREAM.LIST", StreamInfo: "$JS.API.STREAM.INFO.*",
		StreamSnapshot: "$JS.API.STREAM.SNAPSHOT.*", StreamRestore: "$JS.API.STREAM.RESTORE.*",
	}

	return p, nil
}

func UserToken(identity string) string { return hex.EncodeToString([]byte(identity)) }

func (p *Policy) BrowserPermissions(identity string) (jwt.Permissions, error) {
	permissions, err := Expand(p.Browser, identity)
	if err != nil {
		return jwt.Permissions{}, fmt.Errorf("expand browser permissions: %w", err)
	}

	return permissions, nil
}

func Expand(templates []jwt.Permissions, identity string) (jwt.Permissions, error) {
	if identity == "" {
		return jwt.Permissions{}, errors.New("empty identity")
	}

	result := jwt.Permissions{}
	resolve := func(destination *jwt.StringList, subjects jwt.StringList) error {
		for _, subject := range subjects {
			if strings.Contains(subject, "{subject}") && strings.ContainsAny(identity, ". *>\t\r\n{}") {
				return errors.New("identity is not a subject token")
			}

			subject = strings.ReplaceAll(subject, "{subjectToken}", UserToken(identity))

			subject = strings.ReplaceAll(subject, "{subject}", identity)
			if !validSubject(subject, false) {
				return errors.New("invalid resolved subject")
			}

			if !slices.Contains(*destination, subject) {
				*destination = append(*destination, subject)
			}
		}

		return nil
	}

	for _, template := range templates {
		for _, grant := range []struct {
			target *jwt.StringList
			source jwt.StringList
		}{
			{&result.Pub.Allow, template.Pub.Allow},
			{&result.Sub.Allow, template.Sub.Allow},
			{&result.Pub.Deny, template.Pub.Deny},
			{&result.Sub.Deny, template.Sub.Deny},
		} {
			if err := resolve(grant.target, grant.source); err != nil {
				return jwt.Permissions{}, fmt.Errorf("resolve permission template: %w", err)
			}
		}
	}

	if len(result.Pub.Allow) == 0 {
		result.Pub.Deny = append(result.Pub.Deny, ">")
	}

	if len(result.Sub.Allow) == 0 {
		result.Sub.Deny = append(result.Sub.Deny, ">")
	}

	return result, nil
}

func (p *Policy) BootstrapPermissions(node string) jwt.Permissions {
	a := p.Subjects.Protocol.Auth

	return jwt.Permissions{
		Pub: jwt.Permission{Allow: jwt.StringList{a.Membership, a.Discover, a.Worker + ".*", a.Reply + ".>", a.Probe + "." + node}},
		Sub: jwt.Permission{
			Allow: jwt.StringList{
				a.Request + " " + a.Queue,
				a.Membership,
				a.Discover,
				a.Worker + "." + node,
				a.Reply + "." + node + ".>",
				a.Probe + "." + node,
			},
		},
		Resp: &jwt.ResponsePermission{MaxMsgs: 1, Expires: 5 * time.Second},
	}
}
