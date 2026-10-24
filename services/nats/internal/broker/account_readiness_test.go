package broker

import "testing"

func TestAccountReadinessRequiresReplayedPolicyAndConnection(t *testing.T) {
	f := startBrowserControlFixture(t, nil)
	f.change(t, "auth0|release-check", 1, "blocked")

	status := f.runtime.accountReadiness(t.Context())
	if len(status) != 1 || !status[0].Ready || status[0].Issuer != f.issuer || status[0].Stream != "ACCOUNTS" ||
		len(status[0].ApplicationRevision) != 64 {
		t.Fatal("replayed policy was not available to the release check")
	}

	f.runtime.browserControls.mu.Lock()
	feed := f.runtime.browserControls.feeds["AUTH/ACCOUNTS"]
	f.runtime.browserControls.mu.Unlock()
	feed.connection.Close()

	status = f.runtime.accountReadiness(t.Context())
	if len(status) != 1 || status[0].Ready {
		t.Fatal("disconnected account feed reported release readiness")
	}
}
