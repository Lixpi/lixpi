---
name: docker-browser
description: 'Run headless Chromium in Docker and drive the local Lixpi app through the Playwright MCP server. Use only when the user explicitly asks for this skill or the Docker browser. Never select it automatically.'
disable-model-invocation: true
---

# Docker browser

This skill gives an agent a real Chromium browser that runs entirely in Docker and can open the local Lixpi stack. Microsoft's Playwright MCP image supplies the browser and exposes navigation, clicks, typing, page snapshots, screenshots, console messages and network requests as MCP tools. Only the Docker client runs on the host.

## Use this skill only on explicit request

Agents MUST NOT use this skill, start its containers, register its MCP server or call its browser tools unless the user explicitly asks for it in the current conversation. The user has to name this skill, run `/docker-browser`, or directly ask for the Docker browser. A request to debug, test, verify or inspect the UI is not enough, even when a browser would help. Don't suggest the skill as a next step either, unless the user asks how to run a browser in Docker.

The request covers only the task the user gave it for. A later task needs a new request, even in the same conversation.

## Check that browser use is allowed

`AGENTS.md` and the `code-quality` skill have forbidden agents from using browsers, browser automation and screenshots in this repository. Read the current wording of both before doing anything else. If either one still forbids it, stop and tell the developer that the rule has to change first. This skill does not override those rules.

## How the browser reaches the app

The Web UI bundle has its service URLs compiled in, and they all point at `localhost`. Inside a container, `localhost` means the container itself, so the browser would find nothing there. A small forwarder container solves this. It listens on the same localhost ports and passes each connection to the real service over the `nats` Docker network. The browser container then joins the forwarder's network namespace, so it sees the same origins a browser on the Mac sees, and CORS, `NATS_ALLOWED_ORIGINS` and the Auth0 redirect URIs work unchanged.

| Origin | Forwarded to | Purpose |
|---|---|---|
| `https://localhost:3443` | `lixpi-local-https:3443` | Web UI |
| `https://localhost:3444` | `lixpi-local-https:3444` | User portal |
| `https://localhost:3445` | `lixpi-local-https:3445` | API |
| `https://localhost:3446` | `lixpi-local-https:3446` | LocalAuth0 |
| `wss://localhost:9222` | `lixpi-nats-1:443` | NATS WebSocket |

These ports come from the stage's environment file. Before setup, read only `ORIGIN_HOST_URL`, `VITE_USER_PORTAL_URL`, `VITE_API_URL`, `VITE_MOCK_AUTH0_DOMAIN` and `VITE_NATS_SERVER` from `.env.<stage>`, because the same file holds secrets. If a value differs from the table, change the matching port in the forwarder command.

Caddy signs these origins with the stack's own local CA, which Chromium doesn't trust by default. Chromium on Linux reads trusted CAs from an NSS database in `~/.pki/nssdb`, and the Playwright image has no `certutil` to create one, so a one-shot container builds the database in a Docker volume that the browser mounts. Don't start the browser with `--ignore-https-errors`. It would hide certificate failures that the NATS WebSocket connection would hit on a developer's machine.

## Set up the browser

The application stack must already be running, including `lixpi-local-https`, `lixpi-web-ui`, `lixpi-api`, `lixpi-localauth0` and `lixpi-nats-1`. If any of them is missing, stop and ask the developer to start the stack through `./run.sh`.

Start the forwarder:

```bash
docker run -d --rm --name lixpi-browser-network --network nats --entrypoint sh alpine/socat:1.8.1.3 -c 'for port in 3443 3444 3445 3446; do socat TCP-LISTEN:$port,bind=127.0.0.1,fork,reuseaddr TCP:lixpi-local-https:$port & done; socat TCP-LISTEN:9222,bind=127.0.0.1,fork,reuseaddr TCP:lixpi-nats-1:443 & wait'
```

Build the CA store. This only needs to run once, unless the local CA changes:

```bash
docker volume create lixpi-browser-nssdb
docker run --rm -v lixpi_caddy-certs:/certificates:ro -v lixpi-browser-nssdb:/nssdb alpine:3.24.3 sh -c 'apk add --no-cache nss-tools >/dev/null && certutil -N -d sql:/nssdb --empty-password && certutil -A -d sql:/nssdb -t "C,," -n lixpi-local-ca -i /certificates/ca.crt && chown -R 1000:1000 /nssdb'
```

Check every origin through the forwarder before involving the browser:

```bash
docker run --rm --network container:lixpi-browser-network -v lixpi_caddy-certs:/certificates:ro alpine:3.24.3 sh -c 'apk add --no-cache curl >/dev/null; for port in 3443 3444 3445 3446 9222; do printf "%s " $port; curl -sS -o /dev/null -m 10 --cacert /certificates/ca.crt -w "%{http_code} verify=%{ssl_verify_result}\n" https://localhost:$port/; done'
```

Each line should show an HTTP status and `verify=0`. The status itself doesn't matter here, because the API and NATS answer a plain request for `/` with an error code even when they're healthy.

Register the MCP server once for this checkout:

```bash
claude mcp add --scope local lixpi-browser -- docker run -i --rm --init --network container:lixpi-browser-network -v lixpi-browser-nssdb:/home/node/.pki/nssdb mcr.microsoft.com/playwright/mcp:v0.0.85 --isolated
```

Claude Code starts this container itself and talks to it over stdin, so no port is published. The forwarder must be running first, because the browser container can't start without its network namespace. A newly registered server only appears in a new session, so ask the developer to restart Claude Code or reconnect through `/mcp`.

Never use the `npx @playwright/mcp` quick start from the Playwright README. It runs Node and the browser on the host.

## Use the browser

Open `https://localhost:3443` with `browser_navigate`. Sign in with the app's Sign in button, which redirects to LocalAuth0. The `--isolated` flag keeps the browser profile in memory, so each new MCP container starts signed out.

Prefer `browser_snapshot` for reading the page and choosing what to click, because it returns the accessibility tree as text. Use `browser_take_screenshot` when the question is about how something looks. `browser_console_messages` and `browser_network_requests` show client errors and failed calls.

The image only supports headless Chromium, so nobody can watch the session live. Share screenshots when the developer wants to see what happened.

## When something fails

| Symptom | Cause and fix |
|---|---|
| The MCP server fails to start | The forwarder isn't running. Start it, then reconnect through `/mcp`. |
| Browser tools stop working after the forwarder restarted | The browser container lost its network namespace. Reconnect through `/mcp`. |
| The origin check shows a non-zero `verify` value | The local CA changed or the certificates are stale. Report it, and rebuild the CA store if the CA changed. |
| The origin check passes but Chromium reports a certificate error | Chromium isn't reading the CA store. Check the volume mount, then report the failure instead of ignoring HTTPS errors. |
| The page loads but stays disconnected | NATS isn't reachable on 9222. Check `lixpi-nats-1` and the browser's console and network output. |

To rebuild the CA store, disconnect the MCP server, run `docker volume rm lixpi-browser-nssdb`, then repeat the CA store commands.

## Clean up

Stop the forwarder when the work is done. The `--rm` flag removes the container when it stops, and the CA store volume stays for next time:

```bash
docker stop lixpi-browser-network
```
