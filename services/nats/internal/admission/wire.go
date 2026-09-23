package admission

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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
		return nil, fmt.Errorf("encode signed message body: %w", err)
	}

	signature, err := p.Signer.Sign(body)
	if err != nil {
		return nil, fmt.Errorf("sign message body: %w", err)
	}

	encoded, err := json.Marshal(signedMessage{Body: body, Signature: signature})
	if err != nil {
		return nil, fmt.Errorf("encode signed message envelope: %w", err)
	}

	return encoded, nil
}

func verify(p *auth.Protocol, data []byte, value any) error {
	if len(data) > 262144 {
		return errors.New("oversized worker message")
	}

	var envelope signedMessage

	if err := json.Unmarshal(data, &envelope); err != nil {
		return fmt.Errorf("decode signed message envelope: %w", err)
	}

	if err := p.Signer.Verify(envelope.Body, envelope.Signature); err != nil {
		return fmt.Errorf("verify worker signature: %w", err)
	}

	if err := json.Unmarshal(envelope.Body, value); err != nil {
		return fmt.Errorf("decode signed message body: %w", err)
	}

	return nil
}

func identifier() (string, error) {
	var data [16]byte

	if _, err := rand.Read(data[:]); err != nil {
		return "", fmt.Errorf("read random identifier bytes: %w", err)
	}

	return hex.EncodeToString(data[:]), nil
}

func correlation(payload []byte, xkey string) string {
	hash := sha256.New()
	_, _ = hash.Write(payload)
	_, _ = hash.Write([]byte(xkey))

	return hex.EncodeToString(hash.Sum(nil))
}
