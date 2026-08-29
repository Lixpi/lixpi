---
title: AI Model Registry
description: The required synchronization contract between provider documentation, registry data, model discovery, provider requests, configuration controls, tests, and developer documentation.
---

# AI Model Registry

The AI Model Registry records which provider models Lixpi ships, which generation parameters each model and API surface accepts, which values Lixpi sends, and which settings users can change. It runs as the development-only `lixpi-ai-model-registry` service under [`services/ai-model-registry/`](../../services/ai-model-registry/README.md).

Registry data and production code form one contract. A model or parameter fact is not updated until both sides agree.

## Changes that require a registry review

Read this page and inspect the registry whenever work changes any of these:

- Provider model IDs, active or retired model lists, display names, pricing, limits, or capabilities.
- Provider request parameters, nested request shapes, defaults, enum values, fixed values, derived values, or incompatible combinations.
- Model configuration matrix controls, labels, descriptions, options, defaults, visibility, persistence, or validation.
- SDK versions or client modes that change which API surface Lixpi calls.
- Provider documentation or registry records for those same facts.

The reverse rule also applies. A registry change must trigger review of model synchronization, provider adapters, orchestration, matrix assembly and validation, frontend controls, tests, and developer documentation.

## Registry fields and code responsibilities

| Registry field | Code responsibility |
|---|---|
| Group `models` | Discover or inject exactly those active models and delete retired database records. |
| `values`, `range`, `providerDefault`, `defaultValue` | Publish and validate matching model options and defaults. |
| `decision: expose` | Render, persist, validate, and send the model-specific control. |
| `decision: internal` | Derive or fix the value in orchestration/provider code and keep it out of the UI. |
| `decision: skip` | Omit the field from the provider request. |
| Model and API compatibility arrays | Restrict synchronized controls and provider request fields on the same axes. |
| `currentState` | Match whether the live code exposes, hides, or omits the field. |
| `usage` | Name the live code path, value source, and provider effect. |

An approved row is not merely a documentation decision. Its exposure state and live code reference must be true in the repository.

## Container-only registry access

Agents must not read or mutate registry data with host `curl`, `jq`, Node, Python, or direct file writes. Start the service with Docker Compose and run the client tool inside `lixpi-ai-model-registry`.

```bash
docker compose --profile dev --profile main up -d lixpi-ai-model-registry

docker compose exec -T lixpi-ai-model-registry \
  curl -fsS http://127.0.0.1:3010/api/catalog
```

The registry image includes `curl` and `jq`. Existing parameter and group mutations use `PATCH /api/params` from inside the container. The endpoint validates targets and fields and snapshots every affected file before writing.

Do not edit `services/ai-model-registry/data/params/` directly. The API intentionally refuses identity creation, renaming, and deletion. If a new provider parameter or group requires a new identity, add a validated API operation first and invoke that operation inside the container.

The service's [maintenance guide](../../services/ai-model-registry/MAINTAINING-THE-CATALOG.md) contains the patch command, provider research routes, compatibility rules, and container-side invariant checks.

## Required implementation workflow

1. Read the current registry row and group through the container API.
2. Verify the provider claim against current primary documentation and the exact SDK/client mode Lixpi uses.
3. Patch existing registry records through the container API. Do not touch unrelated decision fields.
4. Update every affected implementation surface in the same task.
5. Update the registry `currentState` and `usage` fields to the live code behavior.
6. Update developer documentation that lists models, controls, defaults, compatibility, or provider behavior.
7. Run the container-side registry invariants.
8. When tests are permitted, run the affected NEX, API/provider, shared-package, and web-ui tests through the documented Docker test runner.

## Completion conditions

Work is incomplete if any of these are true:

- A model is active in code but absent from the registry, or present in the registry but not discoverable in code.
- A retired model remains in synchronization, selectors, or normal developer documentation.
- A registry option/default differs from the synchronized model profile or frontend control.
- An exposed parameter has no matrix control, persistence, validation, or provider wiring.
- An internal parameter has no derived/fixed provider value.
- A skipped or unsupported parameter still reaches the provider request.
- A provider request change is missing from the registry description, compatibility, state, or usage block.
- Registry access or provider-document fetching relies on a host HTTP/JSON tool.

## Agent discovery

The repository publishes an `ai-model-registry` skill in `.agents/skills`, `.claude/skills`, `.cursor/skills`, and `.github/skills`. Each alias points here, so Codex, Claude Code, Cursor, and GitHub Copilot discover the same synchronization rule without copied policy.
