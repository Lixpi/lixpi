# AI Model Registry

The AI Model Registry records the provider models and generation parameters Lixpi supports, which values the code sends, and which settings appear in the model configuration matrix. Each parameter is one JSON file under `data/params/`, holding provider documentation, model and API compatibility, implementation state, and the decision Lixpi made about it.

The registry is an internal engineering service. It does not ship to users, but its data and the production model/provider code form one contract. Read [AI Model Registry](../../documentation/development-workflow/AI-MODEL-REGISTRY.md) before changing model sync, provider request fields, configuration controls, pricing, compatibility, or registry data. Read [Maintaining the Registry](MAINTAINING-THE-CATALOG.md) before a provider documentation refresh.

## Running it

```bash
docker compose --profile dev --profile main up -d lixpi-ai-model-registry
```

Open http://localhost:3010. Stop it with `docker compose --profile dev --profile main stop lixpi-ai-model-registry`. The second profile makes the Compose project parse because `lixpi-dynamodb-admin` sits in the dev profile and depends on `lixpi-dynamodb` in main.

Node runs `src/server.ts` directly through native type stripping, so the server needs no build. The TypeScript and SCSS client under `src/client` is served by Vite in development and built into `public/` for the image.

The service hot reloads. Vite serves the page on 3010 and proxies `/api` to the Node server on 3011. `node --watch` restarts the API server when its sources change. Vite polls the bind-mounted source tree so atomic editor saves reach HMR.

`public/` is build output and is gitignored. Never edit it by hand. The built image has no Vite process; the Node server serves the compiled client and the API on port 3010.

## Container-only administration

Registry data must be read and changed through commands that execute inside `lixpi-ai-model-registry`. Do not use host `curl`, `jq`, Node scripts, or direct writes to `data/params/`. The host command may start Docker Compose or enter the container, but the HTTP client, JSON processing, provider-document fetch, and registry mutation run inside the container.

The image includes `curl` and `jq`. A read uses this shape:

```bash
docker compose exec -T lixpi-ai-model-registry \
  curl -fsS http://127.0.0.1:3010/api/catalog
```

Existing parameter and group changes go through `PATCH /api/params`, which snapshots every affected file before writing. The browser uses `PUT /api/selections` for individual review decisions. [Maintaining the Registry](MAINTAINING-THE-CATALOG.md) contains the mutation commands and recovery rules.

## Deciding a parameter

Two checkboxes on the title row carry the decision:

| Use | Show in UI | Stored decision | Meaning |
|---|---|---|---|
| off | n/a | `skip` | Do not send this parameter. |
| on | off | `internal` | Send a fixed or derived value without a model-configuration control. |
| on | on | `expose` | Render a control in the model configuration matrix. |

Show in UI is disabled until Use is on because a control for a parameter nobody sends would do nothing.

Every row opens to match the implementation recorded in `currentState`: `exposed` means the matrix has a control, `hidden` means Lixpi sends a fixed or derived value, and `absent` means the provider request omits it.

The separate `reviewed` flag records whether a human confirmed the decision. Touching a row sets it, and the Unreviewed filter lists decisions that still need review.

Hide appears at the right of the title row once Use is off. It folds the row and mutes it for parameters that are out of scope. The note stays visible so the reason remains available. Ticking Use again clears the irrelevant state.

## Choosing a value

A parameter with a published value list uses selectable chips. Click one to select it and click it again to return to the provider default. Free-text parameters use a labelled input.

The selected value follows the decision. An `internal` row stores the value Lixpi sends. An `expose` row stores the control default. The server clears the field that does not apply, so a file never carries a value nothing uses.

The provider default has a cream dashed border and a default label. The Lixpi selection is green, including when Lixpi deliberately selects the provider default.

## Signing off

Three mutually exclusive statuses record what remains:

- Needs param clarification means the provider field is not understood well enough.
- Needs implementation investigation means the field is understood but its Lixpi wiring is not.
- Approved means the decision and implementation contract are settled. Approval is disabled while Use is off.

None of these statuses implies `reviewed`. Flagging a row for research is not the same as confirming its decision.

## Reading the badges

Already exposed means a matrix control exists. Sent but hidden means Lixpi sends the field without a user control. Never sent means it does not reach the provider.

A second badge appears only when the parameter needs care. Not on our models means the provider rejects it on that group's models. Verify first means the documentation and implementation disagree, or provider sources contradict each other, so the live API needs verification before a decision changes.

Parameters Lixpi sends carry a Used in this repo block naming the code path, where the value comes from, and what the provider receives.

## Registry layout

The directory layout is the registry structure. There is no separate database or hand-maintained index:

```text
data/params/
    _meta.json
    reasoning/
        _meta.json
        anthropic/
            _meta.json
            effort.json
            thinking.json
        google/
        openai/
    image/
    video/
```

Each parameter file carries documentation fields such as `apiField`, `type`, `values`, `range`, `providerDefault`, `currentState`, `availability`, `summary`, `combines`, and `usage`. The compatibility arrays are `supportedModels`, `unsupportedModels`, `supportedApis`, and `unsupportedApis`. Decision fields are `decision`, `reviewed`, `status`, `irrelevant`, `fixedValue`, `defaultValue`, and `note`.

The compatibility arrays drive the model filter and the support pills on each card. Models and API surfaces are independent axes. A Vertex-only field may be supported by every Veo model while remaining unavailable on the Gemini Developer API used by Lixpi.

## Write paths

`PUT /api/selections` is the browser path. It rewrites only decision fields that changed. It refuses a save carrying fewer reviewed decisions than the registry already holds and accepts `?snapshot=1` for programmatic use.

`PATCH /api/params` is the documented engineering path for existing registry entities. It updates parameter documentation and decision fields plus an existing group's `title`, `models`, and `docs`. It merges only supplied fields, rejects unknown targets and fields, and snapshots every affected file into `data/history/params-<timestamp>/` before writing.

The API does not create, rename, or delete parameter identities. Do not bypass that rule with a direct file write. If a provider introduces a genuinely new parameter or group, add a validated API operation for that identity change first, then invoke it inside the container. Retire an existing parameter by marking it unsupported instead of deleting it.

## Keeping code and registry data synchronized

A registry change is incomplete until the matching model sync profile, provider adapter, configuration matrix, UI control, tests, and developer documentation agree with it. A code change is incomplete until the registry records the same models, defaults, options, compatibility, exposure decision, and usage path.

The auto-discovered `ai-model-registry` skill enforces this contract for Codex, Claude Code, Cursor, and GitHub Copilot. The authoritative workflow is [AI Model Registry](../../documentation/development-workflow/AI-MODEL-REGISTRY.md).
