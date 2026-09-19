package main

import (
	"context"
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
			return health(ctx, args[1:])
		case "fence":
			return fence(ctx, args[1:])
		case "backup", "restore":
			return recovery(ctx, args[0], args[1:])
		case "serve":
			args = args[1:]
		}
	}

	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	config := flags.String("config", "/opt/nats/nats-server.conf", "broker configuration")
	routes := flags.String("routes", "", "comma-separated cluster routes")
	check := flags.Bool("t", false, "validate configuration without starting")

	if err := flags.Parse(args); err != nil {
		return err
	}

	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected serve arguments")
	}

	return serve(ctx, *config, *routes, *check)
}

func envDefault(name, value string) string {
	if configured := os.Getenv(name); configured != "" {
		return configured
	}

	return value
}
