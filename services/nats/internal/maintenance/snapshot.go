package maintenance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/lixpi/lixpi/services/nats/internal/policy"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
)

var streamName = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

type Snapshot struct {
	SnapshotID string              `json:"snapshotId,omitempty"`
	Config     server.StreamConfig `json:"config"`
	State      server.StreamState  `json:"state"`
}

type Snapshots struct {
	Connection *nats.Conn
	Subjects   policy.JetStreamSubjects
}

func (s *Snapshots) request(ctx context.Context, subject string, value, target any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	message, err := s.Connection.RequestWithContext(ctx, subject, data)
	if err != nil {
		return err
	}

	var response server.ApiResponse

	if err := json.Unmarshal(message.Data, &response); err != nil {
		return err
	}

	if err := response.ToError(); err != nil {
		return err
	}

	return json.Unmarshal(message.Data, target)
}

func (s *Snapshots) List(ctx context.Context) ([]string, error) {
	var names []string

	for offset := 0; ; {
		var response server.JSApiStreamListResponse

		if err := s.request(ctx, s.Subjects.StreamList, map[string]int{"offset": offset}, &response); err != nil {
			return nil, err
		}

		for _, stream := range response.Streams {
			if stream == nil || !streamName.MatchString(stream.Config.Name) || slices.Contains(names, stream.Config.Name) {
				return nil, errors.New("invalid or duplicate stream inventory")
			}

			names = append(names, stream.Config.Name)
		}

		offset += len(response.Streams)
		if offset >= response.Total {
			break
		}

		if len(response.Streams) == 0 {
			return nil, errors.New("stream inventory did not advance")
		}
	}

	slices.Sort(names)

	return names, nil
}

func (s *Snapshots) Capture(ctx context.Context, name string, destination io.Writer) (*Snapshot, error) {
	if !streamName.MatchString(name) {
		return nil, errors.New("unsafe stream name")
	}

	inbox := s.Connection.NewInbox()

	sub, err := s.Connection.SubscribeSync(inbox)
	if err != nil {
		return nil, err
	}

	defer func() { _ = sub.Unsubscribe() }()

	if err := sub.SetPendingLimits(128, 8*1024*1024); err != nil {
		return nil, err
	}

	if err := s.Connection.FlushTimeout(time.Second); err != nil {
		return nil, err
	}

	var response server.JSApiStreamSnapshotResponse

	if err := s.request(
		ctx,
		strings.ReplaceAll(s.Subjects.StreamSnapshot, "*", name),
		server.JSApiStreamSnapshotRequest{DeliverSubject: inbox, ChunkSize: 128 * 1024, WindowSize: 1024 * 1024, CheckMsgs: true},
		&response,
	); err != nil {
		return nil, err
	}

	if response.Config == nil || response.State == nil || response.Config.Name != name {
		return nil, errors.New("invalid snapshot metadata")
	}

	for {
		chunkCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		message, err := sub.NextMsgWithContext(chunkCtx)
		cancel()

		if err != nil {
			return nil, err
		}

		if status := message.Header.Get("Status"); status != "" && status != "204" {
			return nil, fmt.Errorf("snapshot transfer status %s", status)
		}

		if len(message.Data) == 0 {
			break
		}

		if _, err := destination.Write(message.Data); err != nil {
			return nil, err
		}

		if message.Reply != "" {
			if err := message.Respond(nil); err != nil {
				return nil, err
			}
		}
	}

	return &Snapshot{Config: *response.Config, State: *response.State}, nil
}

func (s *Snapshots) Restore(ctx context.Context, snapshot Snapshot, source io.Reader) error {
	if !streamName.MatchString(snapshot.Config.Name) {
		return errors.New("unsafe restore stream name")
	}

	var response server.JSApiStreamRestoreResponse

	if err := s.request(
		ctx,
		strings.ReplaceAll(s.Subjects.StreamRestore, "*", snapshot.Config.Name),
		server.JSApiStreamRestoreRequest{Config: snapshot.Config, State: snapshot.State},
		&response,
	); err != nil {
		return err
	}

	if response.DeliverSubject == "" {
		return errors.New("missing restore delivery subject")
	}

	chunk := make([]byte, 64*1024)

	for {
		count, err := source.Read(chunk)
		if err != nil && !errors.Is(err, io.EOF) {
			return err
		}

		if count > 0 {
			chunkCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			ack, sendErr := s.Connection.RequestWithContext(chunkCtx, response.DeliverSubject, chunk[:count])
			cancel()

			if sendErr != nil {
				return sendErr
			}

			if len(ack.Data) > 0 || ack.Header.Get("Status") != "" {
				return errors.New("restore chunk rejected")
			}
		}

		if errors.Is(err, io.EOF) {
			break
		}
	}

	completionCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	message, err := s.Connection.RequestWithContext(completionCtx, response.DeliverSubject, nil)
	if err != nil {
		return err
	}

	var completion server.ApiResponse

	if err := json.Unmarshal(message.Data, &completion); err != nil {
		return err
	}

	if err := completion.ToError(); err != nil {
		return err
	}

	var actual server.JSApiStreamInfoResponse

	if err := s.request(ctx, strings.ReplaceAll(s.Subjects.StreamInfo, "*", snapshot.Config.Name), nil, &actual); err != nil {
		return err
	}

	if actual.StreamInfo == nil {
		return errors.New("restored stream has no metadata")
	}

	a, b := actual.State, snapshot.State
	if a.Msgs != b.Msgs || a.Bytes != b.Bytes || a.FirstSeq != b.FirstSeq || a.LastSeq != b.LastSeq || a.Consumers != b.Consumers {
		return errors.New("restored stream differs from snapshot inventory")
	}

	return nil
}
