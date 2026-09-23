package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/caddyserver/caddy/v2"
	"github.com/lixpi/caddy/internal/awsstore"
	"github.com/lixpi/caddy/internal/certificates"
	"github.com/lixpi/caddy/internal/issuer"
	"github.com/lixpi/caddy/internal/maintenance"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	syscall.Umask(0o077)
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	err := run(ctx, os.Args[1:])
	cancel()

	if err != nil {
		slog.Error("caddy command failed", "error", err)
		os.Exit(1)
	}
}

type response struct {
	Status string `json:"status"`
}

func run(ctx context.Context, args []string) error {
	command := ""

	if len(args) > 1 {
		return errors.New("usage: lixpi-caddy [local|maintain|version]")
	}

	if len(args) == 1 {
		command = args[0]
	}

	if command == "version" {
		version, _ := caddy.Version()

		_, err := fmt.Fprintln(os.Stdout, "lixpi-caddy", version)
		if err != nil {
			return fmt.Errorf("write Caddy version: %w", err)
		}

		return nil
	}

	if command != "" && command != "local" && command != "maintain" {
		return fmt.Errorf("unknown caddy command %q", command)
	}

	// The official runtime handles request IDs, deadlines, responses, and errors.
	if os.Getenv("AWS_LAMBDA_RUNTIME_API") != "" && command != "local" {
		lambda.StartWithOptions(func(invocationCtx context.Context, _ json.RawMessage) (response, error) {
			configuration, err := readSettings(os.Getenv, "maintain")
			if err == nil {
				err = execute(invocationCtx, configuration)
			}

			if err != nil {
				slog.Error("certificate maintenance failed",
					"event", "CERTIFICATE_RENEWAL_FAILED",
					"error", err,
				)

				//nolint:wrapcheck // The Lambda handler is the error boundary, and the runtime reports this error as the invocation result.
				return response{}, err
			}

			return response{Status: "success"}, nil
		}, lambda.WithContext(ctx))

		return nil
	}

	configuration, err := readSettings(os.Getenv, command)
	if err != nil {
		return fmt.Errorf("read settings: %w", err)
	}

	if err := execute(ctx, configuration); err != nil {
		return fmt.Errorf("execute certificate command: %w", err)
	}

	return nil
}

func execute(ctx context.Context, settings settings) error {
	engine := issuer.Engine{Email: settings.email, Region: settings.region, HostedZoneID: settings.zone, Local: settings.local}
	if settings.local {
		if err := os.MkdirAll(settings.directory, 0o700); err != nil {
			return fmt.Errorf("create local certificate directory: %w", err)
		}

		localCtx, cancel := context.WithTimeout(ctx, settings.timeout)
		defer cancel()

		err := engine.Maintain(localCtx, settings.directory, settings.domains, func() error {
			roots, _, err := certificates.LocalRoots(settings.directory)
			if err != nil {
				return fmt.Errorf("load local certificate roots: %w", err)
			}

			candidate, err := certificates.Read(settings.directory, "localhost", roots, time.Now())
			if err != nil {
				return fmt.Errorf("read local certificate: %w", err)
			}

			if !candidate.Ready(time.Now()) {
				return errors.New("local certificate renewal is due")
			}

			return nil
		})
		if err != nil {
			return fmt.Errorf("maintain local certificate: %w", err)
		}

		if err := certificates.ExportLocal(settings.directory, time.Now()); err != nil {
			return fmt.Errorf("export local certificate: %w", err)
		}

		slog.Info("local certificate ready", "event", "LOCAL_CERTIFICATE_READY")

		return nil
	}

	awsConfig, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("load AWS configuration: %w", err)
	}

	manager := maintenance.Manager{
		Backend: awsstore.Backend{
			Objects: s3.NewFromConfig(awsConfig), Secrets: secretsmanager.NewFromConfig(awsConfig), Monitoring: cloudwatch.NewFromConfig(awsConfig),
			Bucket: settings.bucket, Prefix: settings.prefix, Manager: settings.manager,
		},
		Issuer: engine, Domains: settings.domains, Timeout: settings.timeout,
	}
	if err := manager.Run(ctx); err != nil {
		return fmt.Errorf("run certificate maintenance: %w", err)
	}

	slog.Info("certificate maintenance complete", "event", "CERTIFICATE_MAINTENANCE_COMPLETE")

	return nil
}
