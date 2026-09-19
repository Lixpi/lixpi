package admission

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/auth"
)

type signedMessage struct {
	Body      json.RawMessage `json:"body"`
	Signature []byte          `json:"signature"`
}

type membership struct {
	Kind      string `json:"kind"`
	Version   int    `json:"version"`
	Node      string `json:"node"`
	Instance  string `json:"instance"`
	Digest    string `json:"digest"`
	Sequence  uint64 `json:"sequence"`
	Capacity  int    `json:"capacity"`
	InFlight  int    `json:"inFlight"`
	Available bool   `json:"available"`
	SentAt    int64  `json:"sentAt"`
}

type peer struct {
	membership
	received      time.Time
	conflictUntil time.Time
}

type workRequest struct {
	Revision    string `json:"revision"`
	Kind        string `json:"kind"`
	Version     int    `json:"version"`
	Node        string `json:"node"`
	Instance    string `json:"instance"`
	Digest      string `json:"digest"`
	Correlation string `json:"correlation"`
	Attempt     string `json:"attempt"`
	Deadline    int64  `json:"deadline"`
	ServerXKey  string `json:"serverXKey"`
	Encrypted   []byte `json:"encrypted"`
}

type workReply struct {
	Kind        string `json:"kind"`
	Node        string `json:"node"`
	Instance    string `json:"instance"`
	Correlation string `json:"correlation"`
	Attempt     string `json:"attempt"`
	Status      string `json:"status"`
	Response    []byte `json:"response,omitempty"`
}

func sign(p *auth.Protocol, value any) ([]byte, error) {
	body, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}

	signature, err := p.Signer.Sign(body)
	if err != nil {
		return nil, err
	}

	return json.Marshal(signedMessage{Body: body, Signature: signature})
}

func verify(p *auth.Protocol, data []byte, value any) error {
	if len(data) > 262144 {
		return errors.New("oversized worker message")
	}

	var envelope signedMessage

	if json.Unmarshal(data, &envelope) != nil || p.Signer.Verify(envelope.Body, envelope.Signature) != nil {
		return errors.New("invalid worker signature")
	}

	return json.Unmarshal(envelope.Body, value)
}

func identifier() string {
	var data [16]byte

	if _, err := rand.Read(data[:]); err != nil {
		panic(err)
	}

	return hex.EncodeToString(data[:])
}

func correlation(payload []byte, xkey string) string {
	hash := sha256.New()
	_, _ = hash.Write(payload)
	_, _ = hash.Write([]byte(xkey))

	return hex.EncodeToString(hash.Sum(nil))
}
