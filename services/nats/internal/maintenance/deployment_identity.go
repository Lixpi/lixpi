package maintenance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"time"
)

type DeploymentIdentity struct {
	Kind      string `json:"kind"`
	Container string `json:"container"`
	Task      string `json:"task"`
}

// A deployment identifies a container, while each control consumer identifies
// one process. Neither identity is inferred from a peer that happens to respond.
func ReadDeploymentIdentity(ctx context.Context, environment, hostname, metadata string, client *http.Client) (DeploymentIdentity, error) {
	if metadata == "" {
		if environment != "local" || !regexp.MustCompile(`^[a-f0-9]{12,64}$`).MatchString(hostname) {
			return DeploymentIdentity{}, errors.New("require local Docker or ECS deployment identity")
		}

		return DeploymentIdentity{Kind: "compose", Container: hostname}, nil
	}

	parsed, err := url.Parse(metadata)
	if err != nil || parsed.Scheme != "http" || parsed.Host != "169.254.170.2" || parsed.User != nil || parsed.RawQuery != "" ||
		parsed.Fragment != "" ||
		!regexp.MustCompile(`^/v4/[A-Za-z0-9-]{1,128}$`).MatchString(parsed.Path) {
		return DeploymentIdentity{}, errors.New("require fixed ECS metadata endpoint")
	}

	if client == nil {
		return DeploymentIdentity{}, errors.New("require deployment metadata transport")
	}

	owned := *client
	owned.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	var container struct {
		DockerID string `json:"DockerId"`
	}
	var task struct {
		ARN        string `json:"TaskARN"`
		Containers []struct {
			DockerID string `json:"DockerId"`
		} `json:"Containers"`
	}

	if err := readDeploymentJSON(ctx, &owned, metadata, &container); err != nil {
		return DeploymentIdentity{}, fmt.Errorf("read ECS container metadata: %w", err)
	}

	if err := readDeploymentJSON(ctx, &owned, metadata+"/task", &task); err != nil {
		return DeploymentIdentity{}, fmt.Errorf("read ECS task metadata: %w", err)
	}

	matches := 0

	for _, member := range task.Containers {
		if member.DockerID == container.DockerID {
			matches++
		}
	}

	if matches != 1 || !regexp.MustCompile(`^[a-f0-9]{32,64}(-[0-9]+)?$`).MatchString(container.DockerID) ||
		!regexp.MustCompile(`^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:task/[A-Za-z0-9_-]+/[a-f0-9]{32}$`).MatchString(task.ARN) {
		return DeploymentIdentity{}, errors.New("require exact ECS task container membership")
	}

	return DeploymentIdentity{Kind: "ecs", Container: container.DockerID, Task: task.ARN}, nil
}

func readDeploymentJSON(ctx context.Context, client *http.Client, endpoint string, destination any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create metadata request: %w", err)
	}

	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("request deployment metadata: %w", err)
	}

	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		return errors.New("deployment metadata unavailable")
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, 128*1024+1))
	if err != nil {
		return fmt.Errorf("read metadata body: %w", err)
	}

	if len(body) > 128*1024 {
		return errors.New("deployment metadata exceeds limit")
	}

	if err := json.Unmarshal(body, destination); err != nil {
		return fmt.Errorf("decode deployment metadata: %w", err)
	}

	return nil
}
