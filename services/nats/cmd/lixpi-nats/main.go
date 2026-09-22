package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	err := run(ctx, os.Args[1:])
	cancel()

	if err != nil {
		slog.Error("NATS command failed", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	if len(args) > 0 {
		switch args[0] {
		case "health":
			if err := health(ctx, args[1:]); err != nil {
				return fmt.Errorf("run health command: %w", err)
			}

			return nil
		case "fence":
			if err := fence(ctx, args[1:]); err != nil {
				return fmt.Errorf("run fence command: %w", err)
			}

			return nil
		case "backup", "restore":
			if err := recovery(ctx, args[0], args[1:]); err != nil {
				return fmt.Errorf("run %s command: %w", args[0], err)
			}

			return nil
		case "serve":
			args = args[1:]
		}
	}

	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	config := flags.String("config", "/opt/nats/nats-server.conf", "broker configuration")
	routes := flags.String("routes", "", "comma-separated cluster routes")
	check := flags.Bool("t", false, "validate configuration without starting")

	if err := flags.Parse(args); err != nil {
		return fmt.Errorf("parse serve flags: %w", err)
	}

	if flags.NArg() != 0 {
		return errors.New("unexpected serve arguments")
	}

	if err := serve(ctx, *config, *routes, *check); err != nil {
		return fmt.Errorf("run serve command: %w", err)
	}

	return nil
}

func envDefault(name, value string) string {
	if configured := os.Getenv(name); configured != "" {
		return configured
	}

	return value
}
