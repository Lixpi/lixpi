package main

import (
	"testing"
)

func TestLocalRoutesRequireExactHTTPSOrigins(t *testing.T) {
	for _, value := range []string{
		`{}`, `null`, `[]`,
		`{"http://app.example.test":"host.docker.internal:3001"}`,
		`{"https://*.example.test":"host.docker.internal:3001"}`,
		`{"https://app.example.test/path":"host.docker.internal:3001"}`,
		`{"https://app.example.test?":"host.docker.internal:3001"}`,
		`{"https://user@app.example.test":"host.docker.internal:3001"}`,
		`{"https://localhost:0":"lixpi-web-ui:5173"}`,
		`{"https://localhost:70000":"lixpi-web-ui:5173"}`,
		`{"https://localhost:03443":"lixpi-web-ui:5173"}`,
		`{"https://app.example.test":"https://host.docker.internal:3001"}`,
		`{"https://app.example.test":"unreviewed.example.test:3001"}`,
		`{"https://app.example.test":"host.docker.internal:70000"}`,
		`{"https://app.example.test":"host.docker.internal:3001","https://APP.example.test/":"host.docker.internal:3002"}`,
		`{"https://localhost":"lixpi-web-ui:5173","https://LOCALHOST:443/":"lixpi-custom-portal:5173"}`,
	} {
		t.Run(value, func(t *testing.T) {
			if _, err := readLocalRoutes(value); err == nil {
				t.Fatal("invalid local route accepted")
			}
		})
	}

	routes, err := readLocalRoutes(
		`{"https://localhost:3443":"lixpi-web-ui:5173","https://localhost:3444/":"lixpi-custom-portal:5173"}`,
	)
	if err != nil || len(routes) != 2 || routes[0].Host != "localhost" || routes[0].Port != "3443" ||
		routes[0].Upstream != "lixpi-web-ui:5173" || routes[1].Host != "localhost" || routes[1].Port != "3444" ||
		routes[1].Upstream != "lixpi-custom-portal:5173" {
		t.Fatalf("exact application routes were not retained: %v", err)
	}
}

func TestLocalProxyRequiresExistingSharedCA(t *testing.T) {
	err := serveLocal(t.Context(), func(key string) string {
		switch key {
		case "CADDY_LOCAL_ROUTES":
			return `{"https://app.example.test":"host.docker.internal:3001"}`
		case "CADDY_CERTIFICATES_DIR":
			return t.TempDir()
		default:
			return ""
		}
	})
	if err == nil {
		t.Fatal("proxy created an independent CA instead of requiring shared state")
	}
}
