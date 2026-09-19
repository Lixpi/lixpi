package maintenance

import (
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
)

type NodeIdentity struct{ Name, Zone, PrivateIP string }

func Node(env func(string) string, store string) (NodeIdentity, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return NodeIdentity{}, err
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
		return NodeIdentity{}, err
	}

	if env("NATS_PERSIST_SERVER_NAME") == "true" {
		filename := filepath.Join(store, "server-name")
		content, err := os.ReadFile(filename)

		switch {
		case errors.Is(err, os.ErrNotExist):
			file, err := os.OpenFile(filename, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
			if err != nil {
				return NodeIdentity{}, err
			}

			_, writeErr := file.WriteString(name + "\n")
			syncErr := file.Sync()
			closeErr := file.Close()

			if writeErr != nil {
				return NodeIdentity{}, writeErr
			}

			if syncErr != nil {
				return NodeIdentity{}, syncErr
			}

			if closeErr != nil {
				return NodeIdentity{}, closeErr
			}
		case err != nil:
			return NodeIdentity{}, err
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
			return NodeIdentity{}, err
		}

		var configuration struct {
			Zone      string `json:"zone"`
			PrivateIP string `json:"advertiseIP"`
		}

		if json.Unmarshal(data, &configuration) != nil || configuration.Zone == "" || net.ParseIP(configuration.PrivateIP) == nil {
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
		return NodeIdentity{}, err
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
		return statErr
	}

	if enable {
		if err := os.WriteFile(marker, []byte("fenced\n"), 0o600); err != nil {
			return err
		}
	}

	if err := reload(enable); err != nil {
		if enable && !previous {
			_ = os.Remove(marker)
		}

		return err
	}

	if !enable && previous {
		if err := os.Remove(marker); err != nil {
			_ = reload(true)

			return err
		}
	}

	return nil
}
