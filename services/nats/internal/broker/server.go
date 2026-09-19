package broker

import (
	"errors"
	"time"

	"github.com/nats-io/nats-server/v2/server"
)

// Start keeps upstream authentication, routing and persistence in the embedded server.
func Start(options *server.Options) (*server.Server, error) {
	broker, err := server.NewServer(options)
	if err != nil {
		return nil, err
	}

	if !options.NoLog {
		broker.ConfigureLogger()
	}

	broker.Start()

	if !broker.ReadyForConnections(10 * time.Second) {
		broker.Shutdown()

		return nil, errors.New("embedded broker did not become ready")
	}

	return broker, nil
}
