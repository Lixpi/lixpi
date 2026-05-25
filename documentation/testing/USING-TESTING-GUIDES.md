# Using Testing Guides

Before writing, modifying, or running tests, inspect this directory for the guide that matches the affected language, service, framework, or test layer, and read every applicable guide.

New testing guides added below this directory are automatically part of this selection rule; no agent-skill catalog update is required.

## Mandatory Agent Verification Rules

These rules apply before an agent selects or runs any verification command, whether or not the task changes tests:

- Never run `svelte-check`, directly or indirectly through a package script or wrapper. It is prohibited for agents.
- Never open the application in a browser or use browser automation, screenshots, or manual visual inspection to verify work.
- For `services/web-ui` work, verify test behavior only with the Dockerized Vitest commands in `TypeScript/web-ui/TESTING-GUIDE.md`.

If the permitted tests do not cover a changed behavior, report the remaining verification gap rather than substituting a prohibited check.
