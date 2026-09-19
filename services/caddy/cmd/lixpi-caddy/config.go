package main

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

type settings struct {
	local     bool
	domains   []string
	email     string
	bucket    string
	prefix    string
	manager   string
	region    string
	zone      string
	directory string
	timeout   time.Duration
}

func readSettings(getenv func(string) string, command string) (settings, error) {
	local := getenv("CADDY_LOCAL_MODE") == "true"

	if command == "local" {
		local = true
	}

	if command == "maintain" {
		local = false
	}

	result := settings{
		local: local, email: getenv("CADDY_EMAIL"), bucket: getenv("CADDY_STATE_BUCKET"),
		prefix: getenv("SECRETS_PREFIX"), manager: getenv("CERT_MANAGER_NAME"),
		region: getenv("AWS_REGION"), zone: getenv("AWS_HOSTED_ZONE_ID"),
		directory: "/certificates", timeout: 780 * time.Second,
	}
	if local {
		result.domains = []string{"localhost"}
		result.timeout = time.Minute

		if directory := getenv("CADDY_CERTIFICATES_DIR"); directory != "" {
			result.directory = directory
		}

		return result, nil
	}

	if storage := getenv("STORAGE_TYPE"); storage != "" && storage != "secrets-manager" {
		return settings{}, fmt.Errorf("unsupported certificate storage %q", storage)
	}

	for _, field := range []struct{ name, value string }{
		{"CADDY_EMAIL", result.email},
		{"CADDY_STATE_BUCKET", result.bucket},
		{"SECRETS_PREFIX", result.prefix},
		{"CERT_MANAGER_NAME", result.manager},
	} {
		if strings.TrimSpace(field.value) == "" {
			return settings{}, fmt.Errorf("missing %s", field.name)
		}
	}

	seen := map[string]bool{}

	for value := range strings.SplitSeq(getenv("DOMAINS"), ",") {
		domain := strings.ToLower(strings.TrimSpace(value))
		if !validDomain(domain) {
			return settings{}, fmt.Errorf("invalid certificate domain %q", value)
		}

		if !seen[domain] {
			result.domains = append(result.domains, domain)
			seen[domain] = true
		}
	}

	if value := getenv("CERT_TIMEOUT_SECONDS"); value != "" {
		seconds, err := strconv.Atoi(value)
		if err != nil || seconds < 1 || seconds > 840 {
			return settings{}, errors.New("CERT_TIMEOUT_SECONDS must be between 1 and 840")
		}

		result.timeout = time.Duration(seconds) * time.Second
	}

	return result, nil
}

func validDomain(domain string) bool {
	name := strings.TrimPrefix(domain, "*.")
	if len(name) == 0 || len(name) > 253 || net.ParseIP(name) != nil || !strings.Contains(name, ".") {
		return false
	}

	for label := range strings.SplitSeq(name, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}

		for _, ch := range label {
			if ch != '-' && (ch < 'a' || ch > 'z') && (ch < '0' || ch > '9') {
				return false
			}
		}
	}

	return true
}
