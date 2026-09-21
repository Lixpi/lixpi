package maintenance

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
)

type NodeIdentity struct{ Name, Zone, PrivateIP string }

func Node(env func(string) string, store string) (NodeIdentity, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return NodeIdentity{}, fmt.Errorf("read host name: %w", err)
	}

	name := env("NATS_SERVER_NAME")
	if name == "" {
		base := env("NATS_SERVER_NAME_BASE")
		if base == "" {
			base = "Lixpi-NATS"
		}

		name = base + "-" + hostname
	}

	if err := os.MkdirAll(store, 0o700); err != nil {
		return NodeIdentity{}, fmt.Errorf("create broker store directory: %w", err)
	}

	if env("NATS_PERSIST_SERVER_NAME") == "true" {
		filename := filepath.Join(store, "server-name")
		content, err := os.ReadFile(filename)

		switch {
		case errors.Is(err, os.ErrNotExist):
			file, err := os.OpenFile(filename, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
			if err != nil {
				return NodeIdentity{}, fmt.Errorf("create persistent broker name: %w", err)
			}

			_, writeErr := file.WriteString(name + "\n")
			syncErr := file.Sync()
			closeErr := file.Close()

			if writeErr != nil {
				return NodeIdentity{}, fmt.Errorf("write persistent broker name: %w", writeErr)
			}

			if syncErr != nil {
				return NodeIdentity{}, fmt.Errorf("sync persistent broker name: %w", syncErr)
			}

			if closeErr != nil {
				return NodeIdentity{}, fmt.Errorf("close persistent broker name: %w", closeErr)
			}
		case err != nil:
			return NodeIdentity{}, fmt.Errorf("read persistent broker name: %w", err)
		default:
			name = strings.TrimSpace(string(content))
		}
	}

	if name == "" || len(name) > 128 || strings.ContainsAny(name, " .*>{}\t\r\n/\\") {
		return NodeIdentity{}, errors.New("invalid persistent node identity")
	}

	result := NodeIdentity{Name: name, Zone: env("NATS_PLACEMENT_ZONE"), PrivateIP: env("NATS_ADVERTISE_IP")}

	if filename := env("NATS_NODE_CONFIG_FILE"); filename != "" {
		data, err := os.ReadFile(filename)
		if err != nil {
			return NodeIdentity{}, fmt.Errorf("read node configuration %q: %w", filename, err)
		}

		var configuration struct {
			Zone      string `json:"zone"`
			PrivateIP string `json:"advertiseIP"`
		}

		if err := json.Unmarshal(data, &configuration); err != nil {
			return NodeIdentity{}, fmt.Errorf("decode node configuration %q: %w", filename, err)
		}

		if configuration.Zone == "" || net.ParseIP(configuration.PrivateIP) == nil {
			return NodeIdentity{}, errors.New("invalid node configuration")
		}

		result.Zone, result.PrivateIP = configuration.Zone, configuration.PrivateIP
	}

	if result.PrivateIP != "" && net.ParseIP(result.PrivateIP) == nil {
		return NodeIdentity{}, errors.New("invalid advertise IP")
	}

	if result.Zone == "" {
		result.Zone = hostname
	}

	if strings.ContainsAny(result.Zone, " ,\t\r\n") {
		return NodeIdentity{}, errors.New("invalid placement zone")
	}

	if err := os.WriteFile(filepath.Join(store, "placement-zone"), []byte(result.Zone+"\n"), 0o600); err != nil {
		return NodeIdentity{}, fmt.Errorf("write broker placement zone: %w", err)
	}

	return result, nil
}

func (n NodeIdentity) Tags(fenced bool) []string {
	if fenced {
		return []string{}
	}

	return []string{"server:" + n.Name, "az:" + n.Zone}
}

func SetFence(store string, enable bool, reload func(bool) error) error {
	marker := filepath.Join(store, "scale-in-fenced")
	_, statErr := os.Stat(marker)
	previous := statErr == nil

	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return fmt.Errorf("inspect broker placement fence: %w", statErr)
	}

	if enable {
		if err := os.WriteFile(marker, []byte("fenced\n"), 0o600); err != nil {
			return fmt.Errorf("write broker placement fence: %w", err)
		}
	}

	if err := reload(enable); err != nil {
		if enable && !previous {
			if removeErr := os.Remove(marker); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
				return errors.Join(fmt.Errorf("reload broker placement: %w", err), fmt.Errorf("remove failed placement fence: %w", removeErr))
			}
		}

		return fmt.Errorf("reload broker placement: %w", err)
	}

	if !enable && previous {
		if err := os.Remove(marker); err != nil {
			rollbackErr := reload(true)
			if rollbackErr != nil {
				rollbackErr = fmt.Errorf("restore fenced broker placement: %w", rollbackErr)
			}

			return errors.Join(fmt.Errorf("remove broker placement fence: %w", err), rollbackErr)
		}
	}

	return nil
}
