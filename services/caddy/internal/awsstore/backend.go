package awsstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	cloudwatchtypes "github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/lixpi/caddy/internal/certificates"
	"github.com/lixpi/caddy/internal/state"
)

type ObjectStore interface {
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
}

type Secrets interface {
	ListSecretVersionIds(
		context.Context,
		*secretsmanager.ListSecretVersionIdsInput,
		...func(*secretsmanager.Options),
	) (*secretsmanager.ListSecretVersionIdsOutput, error)
	GetSecretValue(
		context.Context,
		*secretsmanager.GetSecretValueInput,
		...func(*secretsmanager.Options),
	) (*secretsmanager.GetSecretValueOutput, error)
	PutSecretValue(
		context.Context,
		*secretsmanager.PutSecretValueInput,
		...func(*secretsmanager.Options),
	) (*secretsmanager.PutSecretValueOutput, error)
}

type Monitoring interface {
	PutMetricData(context.Context, *cloudwatch.PutMetricDataInput, ...func(*cloudwatch.Options)) (*cloudwatch.PutMetricDataOutput, error)
}

type Backend struct {
	Objects    ObjectStore
	Secrets    Secrets
	Monitoring Monitoring
	Bucket     string
	Prefix     string
	Manager    string
}

func (b Backend) Load(ctx context.Context) (data []byte, exists bool, resultErr error) {
	result, err := b.Objects.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(b.Bucket), Key: aws.String(state.Key)})

	if _, ok := errors.AsType[*s3types.NoSuchKey](err); ok {
		return nil, false, nil
	}

	if err != nil {
		return nil, false, fmt.Errorf("get Caddy state: %w", err)
	}

	defer func() {
		if err := result.Body.Close(); err != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf("close Caddy state response: %w", err))
		}
	}()

	data, err = io.ReadAll(io.LimitReader(result.Body, state.MaxArchiveBytes+1))
	if err != nil {
		return nil, false, fmt.Errorf("read Caddy state: %w", err)
	}

	if len(data) > state.MaxArchiveBytes {
		return nil, false, errors.New("caddy state archive exceeds size limit")
	}

	return data, true, nil
}

func (b Backend) Save(ctx context.Context, data []byte) error {
	_, err := b.Objects.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(b.Bucket), Key: aws.String(state.Key), Body: bytes.NewReader(data),
		ContentType: aws.String("application/gzip"), ServerSideEncryption: s3types.ServerSideEncryptionAes256,
	})
	if err != nil {
		return fmt.Errorf("save Caddy state: %w", err)
	}

	return nil
}

func (b Backend) Publish(ctx context.Context, domain string, pair certificates.Pair) error {
	name := b.Prefix + "-" + strings.NewReplacer("*", "wildcard", ".", "-").Replace(domain)
	versions := secretsmanager.NewListSecretVersionIdsPaginator(b.Secrets, &secretsmanager.ListSecretVersionIdsInput{SecretId: aws.String(name)})
	hasCurrent := false

	for versions.HasMorePages() {
		page, err := versions.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("list certificate secret versions: %w", err)
		}

		for _, version := range page.Versions {
			if slices.Contains(version.VersionStages, "AWSCURRENT") {
				hasCurrent = true
			}
		}
	}

	if hasCurrent {
		current, err := b.Secrets.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
			SecretId: aws.String(name), VersionStage: aws.String("AWSCURRENT"),
		})
		if err != nil {
			return fmt.Errorf("read current certificate secret: %w", err)
		}

		var published certificates.Pair
		if err := json.Unmarshal([]byte(aws.ToString(current.SecretString)), &published); err != nil {
			return fmt.Errorf("read published certificate: %w", err)
		}

		if published == pair {
			return nil
		}
	}

	data, err := json.Marshal(pair)
	if err != nil {
		return fmt.Errorf("marshal certificate secret: %w", err)
	}

	// Let the SDK generate a token for this write and reuse it across retries.
	// A content-derived token could refer to a version that is no longer current.
	_, err = b.Secrets.PutSecretValue(ctx, &secretsmanager.PutSecretValueInput{
		SecretId: aws.String(name), SecretString: aws.String(string(data)),
	})
	if err != nil {
		return fmt.Errorf("publish certificate secret: %w", err)
	}

	return nil
}

func (b Backend) Metrics(ctx context.Context, seconds float64) error {
	dimensions := []cloudwatchtypes.Dimension{{Name: aws.String("Manager"), Value: aws.String(b.Manager)}}

	_, err := b.Monitoring.PutMetricData(ctx, &cloudwatch.PutMetricDataInput{
		Namespace: aws.String("Lixpi/Certificates"),
		MetricData: []cloudwatchtypes.MetricDatum{
			{
				MetricName: aws.String("CertificateMaintenanceSuccess"),
				Value:      aws.Float64(1),
				Unit:       cloudwatchtypes.StandardUnitCount,
				Dimensions: dimensions,
			},
			{
				MetricName: aws.String("CertificateSecondsRemaining"),
				Value:      aws.Float64(seconds),
				Unit:       cloudwatchtypes.StandardUnitSeconds,
				Dimensions: dimensions,
			},
		},
	})
	if err != nil {
		return fmt.Errorf("publish certificate metrics: %w", err)
	}

	return nil
}
