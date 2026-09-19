package policy

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"regexp"
	"slices"
	"strings"

	"github.com/nats-io/jwt/v2"
	"github.com/nats-io/nkeys"
)

type Service struct {
	UserID      string          `json:"userId"`
	PublicKey   string          `json:"publicKey"`
	Account     string          `json:"account"`
	Permissions jwt.Permissions `json:"permissions"`
}

type Browser struct {
	Issuer      string            `json:"issuer"`
	Audience    string            `json:"audience"`
	JWKSURL     string            `json:"jwksUrl"`
	Account     string            `json:"account"`
	Permissions []jwt.Permissions `json:"permissions"`
}

type Manifest struct {
	Schema   int       `json:"schema"`
	Owner    string    `json:"owner"`
	Version  uint64    `json:"version"`
	Services []Service `json:"services"`
	Browsers []Browser `json:"browsers"`
}

// Payload bytes are signed as supplied, avoiding cross-language JSON canonicalization.
type SignedRegistration struct {
	Issuer    string `json:"issuer"`
	Payload   []byte `json:"payload"`
	Signature []byte `json:"signature"`
}

type Authority struct {
	PublicKey string   `json:"publicKey"`
	Owner     string   `json:"owner"`
	Accounts  []string `json:"accounts"`
}

type Trust struct {
	Authorities []Authority
	AllowHTTP   bool
}

type Snapshot struct {
	Revision string
	Services []Service
	Browsers []Browser
}

type snapshotKey struct{}

func WithSnapshot(ctx context.Context, snapshot *Snapshot) context.Context {
	return context.WithValue(ctx, snapshotKey{}, snapshot)
}

func ContextSnapshot(ctx context.Context) *Snapshot {
	value, _ := ctx.Value(snapshotKey{}).(*Snapshot)

	return value
}

var identifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func Decode(data []byte, value any) error {
	if len(data) > 1024*1024 {
		return errors.New("registration exceeds size limit")
	}

	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()

	if err := d.Decode(value); err != nil {
		return err
	}

	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		return errors.New("trailing registration data")
	}

	return nil
}

func (t Trust) Validate() error {
	if len(t.Authorities) == 0 {
		return errors.New("registration authorities required")
	}

	seen := map[string]bool{}

	for _, a := range t.Authorities {
		if !nkeys.IsValidPublicAccountKey(a.PublicKey) || !identifier.MatchString(a.Owner) || len(a.Accounts) == 0 || seen[a.PublicKey] {
			return errors.New("invalid registration authority")
		}

		seen[a.PublicKey] = true
		for _, account := range a.Accounts {
			if !identifier.MatchString(account) || slices.Contains([]string{"SYS", "CALLOUT", RegistryAccount, "$G"}, account) {
				return errors.New("reserved or invalid application account")
			}
		}
	}

	return nil
}

func (t Trust) Verify(signed SignedRegistration) (*Manifest, error) {
	var authority *Authority

	for i := range t.Authorities {
		if t.Authorities[i].PublicKey == signed.Issuer {
			authority = &t.Authorities[i]
		}
	}

	if authority == nil {
		return nil, errors.New("untrusted registration issuer")
	}

	key, err := nkeys.FromPublicKey(signed.Issuer)
	if err != nil || key.Verify(signed.Payload, signed.Signature) != nil {
		return nil, errors.New("invalid registration signature")
	}

	var m Manifest
	if err := Decode(signed.Payload, &m); err != nil {
		return nil, err
	}

	if m.Schema != 1 || m.Owner != authority.Owner || m.Version == 0 || m.Version > 9007199254740991 {
		return nil, errors.New("invalid registration owner, schema or version")
	}

	for _, s := range m.Services {
		if s.UserID == "" || len(s.UserID) > 512 || !nkeys.IsValidPublicUserKey(s.PublicKey) || !slices.Contains(authority.Accounts, s.Account) {
			return nil, errors.New("invalid service identity or account")
		}

		if err := validatePermissions(s.Permissions, false); err != nil {
			return nil, err
		}
	}

	for _, b := range m.Browsers {
		if b.Issuer == "" || b.Audience == "" || !slices.Contains(authority.Accounts, b.Account) || len(b.Permissions) == 0 {
			return nil, errors.New("invalid token profile")
		}

		for _, address := range []string{b.Issuer, b.JWKSURL} {
			u, err := url.Parse(address)
			if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" || (u.Scheme != "https" && (!t.AllowHTTP || u.Scheme != "http")) {
				return nil, errors.New("invalid token verification URL")
			}
		}

		for _, grant := range b.Permissions {
			if grant.Resp != nil {
				return nil, errors.New("token templates cannot grant response overrides")
			}

			if err := validatePermissions(grant, true); err != nil {
				return nil, err
			}
		}
	}

	return &m, nil
}

func validSubject(subject string, template bool) bool {
	if template {
		subject = strings.ReplaceAll(subject, "{subjectToken}", "identity")
		subject = strings.ReplaceAll(subject, "{subject}", "identity")
	}

	if subject == "" || len(subject) > 1024 || strings.ContainsAny(subject, " \t\r\n{}") {
		return false
	}

	tokens := strings.Split(subject, ".")
	for i, token := range tokens {
		if token == "" || (strings.Contains(token, ">") && (token != ">" || i != len(tokens)-1)) || (strings.Contains(token, "*") && token != "*") {
			return false
		}
	}

	return true
}

func validatePermissions(p jwt.Permissions, template bool) error {
	// An omitted allow list means unrestricted access in NATS. Empty directions must deny everything.
	for _, direction := range []jwt.Permission{p.Pub, p.Sub} {
		if len(direction.Allow) == 0 && !slices.Contains(direction.Deny, ">") {
			return errors.New("permission direction must allow subjects or deny all")
		}

		if len(direction.Allow)+len(direction.Deny) > 4096 {
			return errors.New("too many subject grants")
		}

		for _, subject := range append(slices.Clone(direction.Allow), direction.Deny...) {
			if !validSubject(subject, template) {
				return errors.New("invalid permission subject")
			}
		}
	}

	if p.Resp != nil && (p.Resp.MaxMsgs < 1 || p.Resp.MaxMsgs > 1024 || p.Resp.Expires <= 0 || p.Resp.Expires > 10_000_000_000) {
		return errors.New("invalid response permission")
	}

	return nil
}

func (t Trust) Compile(registrations []SignedRegistration) (*Snapshot, error) {
	snapshot := &Snapshot{}
	owners, keys, users, issuers := map[string]bool{}, map[string]bool{}, map[string]bool{}, map[string]bool{}

	for _, signed := range registrations {
		m, err := t.Verify(signed)
		if err != nil {
			return nil, err
		}

		if owners[m.Owner] {
			return nil, errors.New("duplicate registration owner")
		}

		owners[m.Owner] = true
		for _, s := range m.Services {
			if keys[s.PublicKey] || users[s.UserID] {
				return nil, errors.New("duplicate registered identity")
			}

			keys[s.PublicKey], users[s.UserID] = true, true
			snapshot.Services = append(snapshot.Services, s)
		}

		for _, b := range m.Browsers {
			if issuers[b.Issuer] {
				return nil, errors.New("ambiguous token issuer")
			}

			issuers[b.Issuer] = true
			snapshot.Browsers = append(snapshot.Browsers, b)
		}
	}

	encoded, err := json.Marshal(registrations)
	if err != nil {
		return nil, err
	}

	digest := sha256.Sum256(encoded)
	snapshot.Revision = hex.EncodeToString(digest[:])

	return snapshot, nil
}
