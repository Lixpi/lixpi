package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sync"
	"time"
)

type cachedKey struct {
	key     *rsa.PublicKey
	expires time.Time
}

// JWKS collapses concurrent misses into one bounded fetch and caps both key count and refresh rate.
type JWKS struct {
	URL        string
	Client     *http.Client
	mu         sync.Mutex
	keys       map[string]cachedKey
	fetching   chan struct{}
	fetchError error
	fetchTimes []time.Time
}

func (j *JWKS) Key(ctx context.Context, id string) (*rsa.PublicKey, error) {
	if id == "" || len(id) > 256 {
		return nil, fmt.Errorf("check key ID: %w", ErrDenied)
	}

	j.mu.Lock()
	if entry, exists := j.keys[id]; exists && time.Now().Before(entry.expires) {
		j.mu.Unlock()

		return entry.key, nil
	}

	if pending := j.fetching; pending != nil {
		j.mu.Unlock()

		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("wait for shared key set fetch: %w", ErrUnavailable)
		case <-pending:
		}

		j.mu.Lock()
		defer j.mu.Unlock()

		if entry, exists := j.keys[id]; exists && time.Now().Before(entry.expires) {
			return entry.key, nil
		}

		if j.fetchError != nil {
			return nil, fmt.Errorf("read shared key set fetch result: %w", ErrUnavailable)
		}

		return nil, fmt.Errorf("find key %q in shared key set: %w", id, ErrDenied)
	}

	now := time.Now()
	cut := 0

	for cut < len(j.fetchTimes) && now.Sub(j.fetchTimes[cut]) >= time.Minute {
		cut++
	}

	j.fetchTimes = j.fetchTimes[cut:]

	if len(j.fetchTimes) >= 10 {
		j.mu.Unlock()

		return nil, fmt.Errorf("check key set refresh rate: %w", ErrUnavailable)
	}

	j.fetchTimes = append(j.fetchTimes, now)
	j.fetching = make(chan struct{})
	j.mu.Unlock()
	keys, err := j.fetch(ctx)
	j.mu.Lock()
	defer j.mu.Unlock()

	if err == nil {
		j.keys = keys
	}

	j.fetchError = err
	close(j.fetching)
	j.fetching = nil

	if err != nil {
		return nil, fmt.Errorf("fetch key set from %s: %w", j.URL, err)
	}

	if entry, exists := j.keys[id]; exists {
		return entry.key, nil
	}

	return nil, fmt.Errorf("find key %q in fetched key set: %w", id, ErrDenied)
}

func (j *JWKS) fetch(ctx context.Context) (map[string]cachedKey, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, j.URL, nil)
	if err != nil {
		return nil, fmt.Errorf("create key set request: %w", ErrUnavailable)
	}

	client := j.Client
	if client == nil {
		client = &http.Client{Timeout: time.Second}
	}

	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("request key set: %w", ErrUnavailable)
	}

	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("key set returned HTTP status %d: %w", response.StatusCode, ErrUnavailable)
	}

	data, err := io.ReadAll(io.LimitReader(response.Body, 1_048_577))
	if err != nil || len(data) > 1_048_576 {
		return nil, fmt.Errorf("read key set body: %w", ErrUnavailable)
	}

	var document struct {
		Keys []struct {
			ID        string `json:"kid"`
			Type      string `json:"kty"`
			Use       string `json:"use"`
			Algorithm string `json:"alg"`
			N         string `json:"n"`
			E         string `json:"e"`
		} `json:"keys"`
	}

	if json.Unmarshal(data, &document) != nil || len(document.Keys) > 64 {
		return nil, fmt.Errorf("decode key set: %w", ErrUnavailable)
	}

	keys := make(map[string]cachedKey)

	for _, source := range document.Keys {
		if source.Type != "RSA" || source.ID == "" || len(source.ID) > 256 || (source.Use != "" && source.Use != "sig") ||
			(source.Algorithm != "" && source.Algorithm != "RS256") {
			continue
		}

		n, err := base64.RawURLEncoding.DecodeString(source.N)
		if err != nil || len(n) < 256 || len(n) > 1024 {
			continue
		}

		e, err := base64.RawURLEncoding.DecodeString(source.E)
		if err != nil || len(e) > 4 || len(e) == 0 {
			continue
		}

		exponent := new(big.Int).SetBytes(e).Int64()
		if exponent < 3 || exponent > 2147483647 || exponent%2 == 0 {
			continue
		}

		if _, exists := keys[source.ID]; exists {
			return nil, fmt.Errorf("find duplicate key ID %q in key set: %w", source.ID, ErrUnavailable)
		}

		keys[source.ID] = cachedKey{key: &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(exponent)}, expires: time.Now().Add(10 * time.Minute)}
	}

	if len(keys) == 0 {
		return nil, fmt.Errorf("find usable RSA key in key set: %w", ErrUnavailable)
	}

	return keys, nil
}
