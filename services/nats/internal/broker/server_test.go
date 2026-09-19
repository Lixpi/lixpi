package broker

import (
	"testing"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
)

func TestEmbeddedBrokerInProcessRoundTrip(t *testing.T) {
	instance, err := Start(&server.Options{Host: "127.0.0.1", Port: -1, NoLog: true, NoSigs: true})
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() { instance.Shutdown(); instance.WaitForShutdown() })

	connection, err := nats.Connect("", nats.InProcessServer(instance))
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(connection.Close)

	subscription, err := connection.SubscribeSync("embedded.roundtrip")
	if err != nil {
		t.Fatal(err)
	}

	if err := connection.Publish("embedded.roundtrip", []byte("payload")); err != nil {
		t.Fatal(err)
	}

	if err := connection.Flush(); err != nil {
		t.Fatal(err)
	}

	message, err := subscription.NextMsgWithContext(t.Context())
	if err != nil {
		t.Fatal(err)
	}

	if string(message.Data) != "payload" {
		t.Fatalf("received %q", message.Data)
	}
}
