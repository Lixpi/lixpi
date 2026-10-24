package issuer

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lixpi/caddy/internal/certificates"
)

func TestLocalHTTPSProxySharesCAAndRoutesApplications(t *testing.T) {
	root := t.TempDir()
	// Caddy retains its process-wide certificate cache across Stop calls.
	// Distinct test CAs need distinct names, including repeated go test runs.
	namespace := fmt.Sprintf("%x", sha256.Sum256([]byte(root)))[:12]
	seed := "seed-" + namespace + ".example.test"
	workspace := "app-" + namespace + ".example.test"
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()

	err := (Engine{Local: true}).Maintain(ctx, root, []string{seed}, func() error {
		roots, _, err := certificates.LocalRoots(root)
		if err != nil {
			return fmt.Errorf("read test CA: %w", err)
		}

		if _, err := certificates.Read(root, seed, roots, time.Now()); err != nil {
			return fmt.Errorf("read test seed certificate: %w", err)
		}

		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	roots, ca, err := certificates.LocalRoots(root)
	if err != nil {
		t.Fatal(err)
	}

	seedPath := filepath.Join(root, "certificates", "local", seed, seed+".crt")

	seedBefore, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if _, err := fmt.Fprintf(writer, "%s %s %s", request.Host, request.URL.RequestURI(), request.Header.Get("X-Forwarded-Proto")); err != nil {
			t.Error(err)
		}
	}))
	defer upstream.Close()

	address, port := localProxyTestAddress(ctx, t)
	profileAddress, profilePort := localProxyTestAddress(ctx, t)
	profileUpstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if _, err := fmt.Fprintf(
			writer,
			"profile %s %s %s",
			request.Host,
			request.URL.RequestURI(),
			request.Header.Get("X-Forwarded-Proto"),
		); err != nil {
			t.Error(err)
		}
	}))
	defer profileUpstream.Close()

	stopped := make(chan error, 1)
	go func() {
		stopped <- ServeLocal(ctx, root, []LocalRoute{
			{Host: workspace, Port: port, Upstream: strings.TrimPrefix(upstream.URL, "http://")},
			{Host: workspace, Port: profilePort, Upstream: strings.TrimPrefix(profileUpstream.URL, "http://")},
		})
	}()
	defer func() {
		cancel()

		if err := <-stopped; err != nil {
			t.Error(err)
		}
	}()

	for _, route := range []struct{ address, port, prefix string }{
		{address, port, ""},
		{profileAddress, profilePort, "profile "},
	} {
		domain := net.JoinHostPort(workspace, route.port)
		transport := &http.Transport{
			TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12},
			DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
				connection, err := (&net.Dialer{}).DialContext(ctx, network, route.address)
				if err != nil {
					return nil, fmt.Errorf("dial test HTTPS proxy: %w", err)
				}

				return connection, nil
			},
		}
		client := &http.Client{Transport: transport, Timeout: time.Second}
		t.Cleanup(transport.CloseIdleConnections)

		request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://"+domain+"/profile?tab=account", nil)
		if err != nil {
			t.Fatal(err)
		}

		for {
			response, err := client.Do(request)
			if err == nil {
				body, readErr := io.ReadAll(response.Body)

				closeErr := response.Body.Close()
				if readErr != nil || closeErr != nil || response.StatusCode != http.StatusOK ||
					string(body) != route.prefix+domain+" /profile?tab=account https" {
					t.Fatalf("incorrect HTTPS proxy response: status %d, body %q, errors %v %v", response.StatusCode, body, readErr, closeErr)
				}

				if time.Until(response.TLS.PeerCertificates[0].NotAfter) > 12*time.Hour {
					t.Fatal("browser certificate exceeds the short local HTTPS lifetime")
				}

				break
			}

			select {
			case <-ctx.Done():
				t.Fatalf("HTTPS route never became ready: %v", err)
			case <-time.After(20 * time.Millisecond):
			}
		}

		request.Host = "unconfigured.example.test"

		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}

		if err := response.Body.Close(); err != nil {
			t.Fatal(err)
		}

		if response.StatusCode != http.StatusMisdirectedRequest {
			t.Fatalf("mismatched TLS and HTTP host reached an upstream: %d", response.StatusCode)
		}
	}

	_, retainedCA, err := certificates.LocalRoots(root)
	if err != nil || string(retainedCA) != string(ca) {
		t.Fatalf("HTTPS proxy replaced the shared CA: %v", err)
	}

	seedAfter, err := os.ReadFile(seedPath)
	if err != nil || string(seedBefore) != string(seedAfter) {
		t.Fatalf("HTTPS proxy changed the NATS issuer's certificate storage: %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, "https", "certificates", "local", workspace, workspace+".crt")); err != nil {
		t.Fatalf("browser certificate was not isolated from NATS storage: %v", err)
	}
}

func localProxyTestAddress(ctx context.Context, t *testing.T) (string, string) {
	t.Helper()

	listener, err := (&net.ListenConfig{}).Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}

	_, port, err := net.SplitHostPort(address)
	if err != nil {
		t.Fatal(err)
	}

	return address, port
}
