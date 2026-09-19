package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/maintenance"
	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
)

func health(ctx context.Context, args []string) error {
	mode := "broker"

	if len(args) == 1 {
		mode = args[0]
	} else if len(args) > 1 {
		return errors.New("health expects live, broker or ready")
	}

	if mode != "live" && mode != "broker" && mode != "ready" {
		return errors.New("invalid health probe")
	}

	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:3020/"+mode, nil)
	if err != nil {
		return err
	}

	request.Header.Set("Authorization", "Bearer "+os.Getenv("NATS_CALLOUT_PASSWORD"))

	response, err := (&http.Client{Timeout: 2 * time.Second}).Do(request)
	if err != nil {
		return errors.New("health probe unavailable")
	}

	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		return errors.New("health probe failed")
	}

	return nil
}

func fence(ctx context.Context, args []string) error {
	if len(args) != 1 || (args[0] != "enable" && args[0] != "disable") {
		return errors.New("fence expects enable or disable")
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", envDefault("NATS_CONTROL_SOCKET", "/run/lixpi-nats/control.sock"))
	}}
	defer transport.CloseIdleConnections()

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://runtime/fence/"+args[0], nil)
	if err != nil {
		return err
	}

	response, err := (&http.Client{Transport: transport, Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		return err
	}

	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		return errors.New("fence operation failed")
	}

	return nil
}

func recovery(ctx context.Context, operation string, args []string) error {
	if (operation == "backup" && len(args) != 0) || len(args) > 1 {
		return errors.New("restore accepts an optional snapshot id; backup takes no arguments")
	}

	seedName := "NATS_BACKUP_NKEY_SEED"

	if operation == "restore" {
		seedName = "NATS_OPERATOR_NKEY_SEED"
	}

	for _, name := range []string{seedName, "NATS_URL", "NATS_SNAPSHOT_DIR"} {
		if os.Getenv(name) == "" {
			return fmt.Errorf("missing %s", name)
		}
	}

	key, err := nkeys.FromSeed([]byte(os.Getenv(seedName)))
	if err != nil {
		return errors.New("invalid maintenance identity")
	}
	defer key.Wipe()

	public, err := key.PublicKey()
	if err != nil || !nkeys.IsValidPublicUserKey(public) {
		return errors.New("maintenance identity must be a user key")
	}

	p, err := policy.Transport()
	if err != nil {
		return err
	}

	connection, err := nats.Connect(
		os.Getenv("NATS_URL"),
		nats.Nkey(public, key.Sign),
		nats.Name("nats-"+operation),
		nats.CustomInboxPrefix(envDefault("NATS_MAINTENANCE_INBOX", "_INBOX."+policy.UserToken(public))),
		nats.Timeout(2*time.Second),
	)
	if err != nil {
		return errors.New("maintenance NATS connection failed")
	}
	defer connection.Close()

	store, err := maintenance.OpenDirectoryStore(os.Getenv("NATS_SNAPSHOT_DIR"))
	if err != nil {
		return err
	}

	defer func() { _ = store.Root.Close() }()
	scratch := envDefault("NATS_BACKUP_SCRATCH", "/tmp")

	if err := os.MkdirAll(scratch, 0o700); err != nil {
		return err
	}

	backup := maintenance.Backup{
		Snapshots: &maintenance.Snapshots{Connection: connection, Subjects: p.Subjects.Protocol.JetStream},
		Store:     store,
		Scratch:   scratch,
	}

	if operation == "restore" {
		id := ""

		if len(args) == 1 {
			id = args[0]
		}

		return backup.Restore(ctx, id)
	}

	id, err := backup.Capture(ctx)
	if err != nil {
		return err
	}

	if _, err := fmt.Fprintf(os.Stdout, "NATS_BACKUP_COMPLETE %s\n", id); err != nil {
		return err
	}

	return nil
}
