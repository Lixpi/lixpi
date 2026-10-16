package maintenance

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

type metadataTransport func(*http.Request) (*http.Response, error)

func (f metadataTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := f(request)
	if err != nil {
		return nil, fmt.Errorf("test metadata transport: %w", err)
	}

	return response, nil
}

func TestDeploymentIdentity(t *testing.T) {
	host := strings.Repeat("a", 12)

	identity, err := ReadDeploymentIdentity(t.Context(), "local", host, "", nil)
	if err != nil || identity.Kind != "compose" || identity.Container != host {
		t.Fatalf("local identity: %v %v", identity, err)
	}

	if _, err := ReadDeploymentIdentity(t.Context(), "production", host, "", nil); err == nil {
		t.Fatal("accepted local identity outside local environment")
	}

	container := strings.Repeat("c", 32) + "-12345"
	task := "arn:aws:ecs:us-east-1:123456789012:task/cluster/" + strings.Repeat("d", 32)
	calls := 0
	client := &http.Client{Transport: metadataTransport(func(request *http.Request) (*http.Response, error) {
		calls++

		if request.URL.Host != "169.254.170.2" {
			t.Fatal("unexpected metadata destination")
		}

		if _, ok := request.Context().Deadline(); !ok {
			t.Fatal("missing request deadline")
		}

		body := fmt.Sprintf(`{"DockerId":%q}`, container)

		if strings.HasSuffix(request.URL.Path, "/task") {
			body = fmt.Sprintf(`{"TaskARN":%q,"Containers":[{"DockerId":%q}]}`, task, container)
		}

		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
	})}

	identity, err = ReadDeploymentIdentity(t.Context(), "production", "ignored", "http://169.254.170.2/v4/test-id", client)
	if err != nil || identity.Kind != "ecs" || identity.Container != container || identity.Task != task || calls != 2 {
		t.Fatalf("ECS identity: %v %v", identity, err)
	}

	for _, endpoint := range []string{"http://evil.example/v4/x", "http://169.254.170.2/v4/x?y=z", "http://user:password@169.254.170.2/v4/x", "http://169.254.170.2/credentials"} {
		if _, err := ReadDeploymentIdentity(t.Context(), "local", host, endpoint, client); err == nil {
			t.Fatal("accepted substituted endpoint")
		}
	}

	if calls != 2 {
		t.Fatal("contacted rejected metadata endpoint")
	}
}

func TestDeploymentIdentityDeniesInvalidMetadata(t *testing.T) {
	for _, body := range []string{`{}`, `null`, `{"DockerId":"wrong"}`, strings.Repeat("x", 128*1024+1)} {
		client := &http.Client{Transport: metadataTransport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
		})}
		if _, err := ReadDeploymentIdentity(
			context.Background(),
			"local",
			strings.Repeat("a", 12),
			"http://169.254.170.2/v4/test-id",
			client,
		); err == nil {
			t.Fatal("accepted invalid ECS identity")
		}
	}

	client := &http.Client{Transport: metadataTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusFound,
			Body:       io.NopCloser(strings.NewReader("")),
			Header:     http.Header{"Location": []string{"http://evil.example"}},
		}, nil
	})}
	if _, err := ReadDeploymentIdentity(t.Context(), "local", strings.Repeat("a", 12), "http://169.254.170.2/v4/test-id", client); err == nil {
		t.Fatal("accepted metadata redirect")
	}
}
