package awsstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	secrettypes "github.com/aws/aws-sdk-go-v2/service/secretsmanager/types"
	"github.com/lixpi/caddy/internal/certificates"
	"github.com/lixpi/caddy/internal/state"
)

type fakeAWS struct {
	getErr, listErr, secretErr, putErr, metricErr error
	current                                       string
	listCalls                                     int
	puts                                          []*secretsmanager.PutSecretValueInput
	metrics                                       *cloudwatch.PutMetricDataInput
	object                                        []byte
	objectInput                                   *s3.PutObjectInput
}

func (f *fakeAWS) GetObject(_ context.Context, input *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	if aws.ToString(input.Key) != state.Key {
		return nil, errors.New("wrong durable state key")
	}

	return &s3.GetObjectOutput{Body: io.NopCloser(bytes.NewReader(f.object))}, f.getErr
}

func (f *fakeAWS) PutObject(_ context.Context, input *s3.PutObjectInput, _ ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	f.objectInput = input
	data, err := io.ReadAll(input.Body)
	f.object = data

	if err != nil {
		return nil, fmt.Errorf("read uploaded object: %w", err)
	}

	return &s3.PutObjectOutput{}, nil
}

func (f *fakeAWS) ListSecretVersionIds(
	_ context.Context,
	input *secretsmanager.ListSecretVersionIdsInput,
	_ ...func(*secretsmanager.Options),
) (*secretsmanager.ListSecretVersionIdsOutput, error) {
	f.listCalls++
	if f.listErr != nil {
		return nil, f.listErr
	}

	if input.NextToken == nil {
		return &secretsmanager.ListSecretVersionIdsOutput{NextToken: aws.String("second")}, nil
	}

	result := &secretsmanager.ListSecretVersionIdsOutput{}

	if f.current != "" {
		result.Versions = []secrettypes.SecretVersionsListEntry{{VersionStages: []string{"AWSCURRENT"}}}
	}

	return result, nil
}

func (f *fakeAWS) GetSecretValue(
	context.Context,
	*secretsmanager.GetSecretValueInput,
	...func(*secretsmanager.Options),
) (*secretsmanager.GetSecretValueOutput, error) {
	return &secretsmanager.GetSecretValueOutput{SecretString: aws.String(f.current)}, f.secretErr
}

func (f *fakeAWS) PutSecretValue(
	_ context.Context,
	input *secretsmanager.PutSecretValueInput,
	_ ...func(*secretsmanager.Options),
) (*secretsmanager.PutSecretValueOutput, error) {
	f.puts = append(f.puts, input)

	return &secretsmanager.PutSecretValueOutput{}, f.putErr
}

func (f *fakeAWS) PutMetricData(
	_ context.Context,
	input *cloudwatch.PutMetricDataInput,
	_ ...func(*cloudwatch.Options),
) (*cloudwatch.PutMetricDataOutput, error) {
	f.metrics = input

	return &cloudwatch.PutMetricDataOutput{}, f.metricErr
}

func TestSecretPublicationIsIdempotentAndPaged(t *testing.T) {
	pair := certificates.Pair{Certificate: "certificate PEM", PrivateKey: "private PEM"}
	fake := &fakeAWS{}

	backend := Backend{Secrets: fake, Prefix: "nats-certs"}
	if err := backend.Publish(t.Context(), "*.example.test", pair); err != nil {
		t.Fatal(err)
	}

	if len(fake.puts) != 1 || fake.listCalls != 2 {
		t.Fatal("empty secret or pagination not handled")
	}

	input := fake.puts[0]
	if aws.ToString(input.SecretId) != "nats-certs-wildcard-example-test" {
		t.Fatal("secret naming changed")
	}

	var published certificates.Pair
	if err := json.Unmarshal([]byte(aws.ToString(input.SecretString)), &published); err != nil || published != pair {
		t.Fatal("serving secret wire format changed")
	}

	fake.current = `{"private_key":"private PEM", "certificate":"certificate PEM"}`

	if err := backend.Publish(t.Context(), "*.example.test", pair); err != nil {
		t.Fatal(err)
	}

	if len(fake.puts) != 1 {
		t.Fatal("unchanged secret created another version")
	}

	fake.current = `{"certificate":"different current certificate", "private_key":"different key"}`

	if err := backend.Publish(t.Context(), "*.example.test", pair); err != nil {
		t.Fatal(err)
	}

	if len(fake.puts) != 2 {
		t.Fatal("restored certificate was not republished")
	}

	if input.ClientRequestToken != nil && aws.ToString(input.ClientRequestToken) == aws.ToString(fake.puts[1].ClientRequestToken) {
		t.Fatal("republishing reused a historical version token and would leave AWSCURRENT unchanged")
	}
}

func TestSecretReadFailuresNeverOverwriteCurrent(t *testing.T) {
	failure := errors.New("AWS unavailable")
	for _, fake := range []*fakeAWS{
		{listErr: failure}, {current: "{}", secretErr: failure}, {current: "corrupt"},
	} {
		backend := Backend{Secrets: fake, Prefix: "test"}
		if err := backend.Publish(t.Context(), "example.test", certificates.Pair{}); err == nil || len(fake.puts) != 0 {
			t.Fatal("read failure overwrote the published secret")
		}
	}
}

func TestStateReadDistinguishesMissingFromUnavailable(t *testing.T) {
	for _, test := range []struct {
		name    string
		err     error
		wantErr bool
	}{
		{"new deployment", &s3types.NoSuchKey{}, false},
		{"access denied", errors.New("AccessDenied"), true},
	} {
		t.Run(test.name, func(t *testing.T) {
			backend := Backend{Objects: &fakeAWS{getErr: test.err}, Bucket: "test"}

			_, exists, err := backend.Load(t.Context())
			if exists || (err != nil) != test.wantErr {
				t.Fatalf("exists=%v, err=%v", exists, err)
			}
		})
	}

	fake := &fakeAWS{}

	backend := Backend{Objects: fake, Bucket: "test"}
	if err := backend.Save(t.Context(), []byte("state")); err != nil {
		t.Fatal(err)
	}

	if aws.ToString(fake.objectInput.Key) != state.Key || fake.objectInput.ServerSideEncryption != s3types.ServerSideEncryptionAes256 {
		t.Fatal("state key or encryption changed")
	}

	data, exists, err := backend.Load(t.Context())
	if err != nil || !exists || string(data) != "state" {
		t.Fatal("state not restored")
	}
}

func TestCertificateMetricsKeepAlarmContract(t *testing.T) {
	fake := &fakeAWS{}

	backend := Backend{Monitoring: fake, Manager: "manager-test"}
	if err := backend.Metrics(t.Context(), 3600); err != nil {
		t.Fatal(err)
	}

	input := fake.metrics
	if aws.ToString(input.Namespace) != "Lixpi/Certificates" || len(input.MetricData) != 2 {
		t.Fatal("metric namespace or data missing")
	}

	if aws.ToString(input.MetricData[0].MetricName) != "CertificateMaintenanceSuccess" || aws.ToFloat64(input.MetricData[0].Value) != 1 ||
		aws.ToString(input.MetricData[1].MetricName) != "CertificateSecondsRemaining" || aws.ToFloat64(input.MetricData[1].Value) != 3600 {
		t.Fatal("metric contract changed")
	}

	for _, metric := range input.MetricData {
		if aws.ToString(metric.Dimensions[0].Name) != "Manager" || aws.ToString(metric.Dimensions[0].Value) != "manager-test" {
			t.Fatal("manager alarm dimension changed")
		}
	}
}
