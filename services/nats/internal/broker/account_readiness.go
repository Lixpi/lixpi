package broker

import "context"

type accountReadiness struct {
	Issuer              string `json:"issuer"`
	ApplicationRevision string `json:"applicationRevision"`
	Stream              string `json:"stream"`
	Ready               bool   `json:"ready"`
}

// Read the authoritative signed policy on each release check. A healthy
// dispatcher alone does not establish that account restrictions were replayed.
func (r *Runtime) accountReadiness(ctx context.Context) []accountReadiness {
	if r.Registry == nil || r.browserControls == nil {
		return nil
	}

	snapshot, err := r.Registry.Resolve(ctx, "")
	if err != nil {
		return nil
	}

	values := make([]accountReadiness, 0, len(snapshot.Browsers))
	for _, browser := range snapshot.Browsers {
		value := accountReadiness{Issuer: browser.Issuer, ApplicationRevision: browser.RegistrationDigest}
		if browser.Admission != nil {
			value.Stream = browser.Admission.Stream
			r.browserControls.mu.Lock()
			feed := r.browserControls.feeds[browser.Account+"/"+browser.Admission.Stream]
			r.browserControls.mu.Unlock()

			if feed != nil {
				feed.mu.Lock()
				value.Ready = feed.available && feed.connection.IsConnected() && r.Ready()
				feed.mu.Unlock()
			}
		}

		values = append(values, value)
	}

	return values
}
