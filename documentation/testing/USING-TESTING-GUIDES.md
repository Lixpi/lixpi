# Using Testing Guides

Read this file at the start of every implementation iteration, before deciding whether any test writing or test execution is allowed.

Agents must never write tests, modify tests, or run test commands unless the user explicitly asks for tests in the current thread. If the user has not explicitly asked for tests, use static review and non-test hygiene checks only.

After the user explicitly asks for tests, inspect this directory for the guide that matches the affected language, service, framework, or test layer, and read every applicable guide before writing, modifying, or running tests.

New testing guides added below this directory are automatically part of this selection rule; no agent-skill catalog update is required.

## Mandatory Agent Verification Rules

These rules apply before an agent selects or runs any verification command, whether or not the task changes tests:

- Never run `npm`, `npx`, `pnpm`, or `pnpx` on the host. Any package-manager-backed verification must run inside the appropriate Docker container when verification is otherwise allowed.
- Never install project dependencies or tooling on the host. Dependency changes are handled through Docker images or containers, not local host setup.
- Never write, modify, or run tests unless the user explicitly asks for tests in the current thread.
- Never open the application in a browser or use browser automation, screenshots, or manual visual inspection to verify work.
- For TypeScript tests, follow the shared conventions in `TypeScript/TESTING-GUIDE.md`. All TypeScript test execution — for `services/web-ui`, `services/api`, `services/nex`, and the shared `packages/lixpi` packages — runs through the single `lixpi-typescript-test-runner` image via `docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner <domain>`, never through the app-runtime containers (`lixpi-web-ui`, `lixpi-api`, `lixpi-nex`), which no longer ship a test runner.
- For `services/web-ui` work, also follow `TypeScript/web-ui/TESTING-GUIDE.md`, and verify test behavior only with its Dockerized `run-tests.sh web-ui` commands.

If tests were not explicitly requested, do not report missing test execution as a verification failure. If tests were explicitly requested and the permitted tests do not cover a changed behavior, report the remaining verification gap rather than substituting a prohibited check.
