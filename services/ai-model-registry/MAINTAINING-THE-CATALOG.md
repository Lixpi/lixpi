# Maintaining the AI Model Registry

`data/params/` holds one JSON file per provider parameter. Each file combines provider documentation, model and API compatibility, implementation state, and the Lixpi decision. Provider APIs change often, so refreshes must preserve reviewed decisions and update the production code in the same implementation iteration.

Read [AI Model Registry](../../documentation/development-workflow/AI-MODEL-REGISTRY.md) before changing this tree. The service behavior and UI are described in [README.md](README.md).

## Parameter paths are identities

A decision lives inside its parameter file, so the path is its identity. Moving, renaming, or deleting `reasoning/anthropic/effort.json` also moves or removes the reviewed decision without a runtime warning.

Update existing identities and retire obsolete parameters by marking them unsupported. Do not rename or delete them. If a provider renames a field, update `apiField` and keep the filename. If a group title changes, update `title` and keep the folder name.

The registry API deliberately refuses identity creation, renaming, and deletion. Do not bypass that restriction by writing JSON directly. When a new provider parameter or group must be represented, extend the API with a validated identity-creation operation first, test it, and invoke it inside the registry container.

## Run every registry command inside Docker

Do not use host `curl`, `jq`, Node, Python, or direct filesystem commands to inspect or mutate registry data. Start the service through Docker Compose, then execute the maintenance tool inside `lixpi-ai-model-registry`.

```bash
docker compose --profile dev --profile main up -d lixpi-ai-model-registry
```

The image includes `curl` and `jq`. Read the assembled registry like this:

```bash
docker compose exec -T lixpi-ai-model-registry \
  curl -fsS http://127.0.0.1:3010/api/catalog
```

The only permitted mutation path for existing parameter and group data is `PATCH /api/params` from inside the container:

```bash
docker compose exec -T lixpi-ai-model-registry \
  curl -fsS -X PATCH http://127.0.0.1:3010/api/params \
  -H 'content-type: application/json' \
  --data-binary '{
    "params": {
      "byteplus/seedance-2-video/ratio": {
        "summary": "...",
        "combines": ["..."],
        "supportedModels": ["..."],
        "unsupportedModels": ["..."]
      }
    },
    "groups": {
      "byteplus/seedance-2-video": {
        "models": ["..."]
      }
    }
  }'
```

Parameter keys use `<providerId>/<groupId>/<paramKey>`. Group keys use `<providerId>/<groupId>`. Existing groups expose `title`, `models`, and `docs`. The endpoint merges supplied fields, rejects unknown targets and fields, and snapshots every affected file into `data/history/params-<timestamp>/` before writing.

Recover a bad bulk edit by reading the snapshot and applying the correct values through the API. Do not copy snapshot files over the live tree. The API must remain the mutation boundary even during recovery.

The browser uses `PUT /api/selections` for individual review decisions. That path writes only changed decision fields. Programmatic use must pass `?snapshot=1` and must still execute through the container.

## Preserve reviewed decisions

A provider documentation refresh must not change `decision`, `reviewed`, `status`, `irrelevant`, `fixedValue`, `defaultValue`, or `note` unless the implementation decision itself is part of the requested change.

Read the registry before and after the patch through the container API. If a documentation-only refresh changes a decision field, correct it before touching production code.

One safeguard neither write path can provide is an identity rename. From the registry's point of view, a renamed file is a new unreviewed parameter and the old reviewed identity is gone. This is why direct file writes are prohibited.

## Fetch provider documentation inside Docker

Provider research must also avoid host HTTP tools.

### BytePlus ModelArk

Use the `fetch-byteplus-documentation` skill. It runs the repository's BytePlus extraction utility in Docker because `docs.byteplus.com` often returns a JavaScript shell to ordinary fetches. Run `--list-sections` first on long pages.

For Seedance, start with the create-task reference (`ModelArk/1520757`), retrieve-task reference (`1521309`), model list (`1330310`), pricing (`1099320`), generation tutorials (`2607688`, `2607689`), prompt guides (`2222480`, `2291680`, `2298881`), and trusted-output rules (`2608626`).

### Google

Google Gemini documentation pages expose plain-text twins by appending `.md.txt`. Fetch them through the registry container. The versioned SDK remains the most reliable source for exact field names, accepted values, defaults, and API-surface restrictions.

```bash
docker compose exec -T lixpi-ai-model-registry \
  curl -fsSL https://cdn.jsdelivr.net/npm/@google/genai/dist/genai.d.ts
```

The SDK phrase "This field is not supported in Gemini API" means Vertex only. Lixpi creates `GoogleGenAI` with an API key, so Vertex-only fields remain unavailable on the Gemini Developer API even when every Veo model supports them on Vertex.

### OpenAI

OpenAI's API reference may reject a plain fetch. Read the installed SDK types or fetch the published type declarations through the registry container:

```bash
docker compose exec -T lixpi-ai-model-registry \
  curl -fsSL https://cdn.jsdelivr.net/npm/openai/resources/responses/responses.d.ts

docker compose exec -T lixpi-ai-model-registry \
  curl -fsSL https://cdn.jsdelivr.net/npm/openai/resources/images.d.ts
```

### Anthropic

Follow redirects from `docs.claude.com` or `docs.anthropic.com` to `platform.claude.com`. Fetch through the registry container when the active harness cannot read the page directly.

### Stability

Stability's API reference is a client-rendered application behind Cloudflare. Use the AWS Bedrock parameter pages as the primary readable mirror. Anything the mirror omits must be sourced from a current client library and marked for verification.

## Check the details that usually drift

Provider changes are often narrower than a new parameter. Review each of these deliberately:

- New enum values on an existing field.
- Defaults that differ between models in one group.
- Input modes represented by roles or object shapes rather than named fields.
- Task types that lock another parameter to a fixed value.
- Deprecations that still return success but no longer affect output.
- Per-model support that does not follow a simple version ladder.
- SDK fields that exist only on an API surface Lixpi does not call.
- New active model IDs, retired model IDs, pricing, rate limits, and reference limits.

When a model joins an existing wire-compatible family, add it to the existing group and record narrower differences in the parameter compatibility arrays. Do not duplicate the same decision across separate groups.

Keep `supportedModels`, `unsupportedModels`, `supportedApis`, and `unsupportedApis` current on every touched parameter. Models and APIs are independent axes. A Vertex-only field can remain supported by every Veo model while listing the Gemini Developer API as unsupported.

Silence means model support only when the provider documentation places no model restriction on that field. Narrow a model list only when a primary source says the model rejects or omits it.

## Keep registry data and production code synchronized

The registry and production implementation are one contract. A change to either side requires a review of the other side in the same task.

Registry fields map to implementation surfaces as follows:

| Registry data | Implementation that must agree |
|---|---|
| Group `models` | NEX model discovery/static injection, dead-model cleanup, friendly names |
| `values`, `range`, `providerDefault`, `defaultValue` | Synchronized model profiles, matrix validation, UI options and defaults |
| `decision: expose` | Model configuration control plus frontend rendering and persistence |
| `decision: internal` | Provider or orchestration code that derives and sends the field without a UI control |
| `decision: skip` | Provider request omits the field |
| `supportedModels` and `unsupportedModels` | Per-model synchronized controls and provider guards |
| `supportedApis` and `unsupportedApis` | SDK/client mode and provider request surface |
| `currentState` and `usage` | Live call site and value source |
| Pricing and limits in descriptions | NEX pricing/capability metadata and enforcement code |

If code changes a model ID, model list, parameter, default, option, compatibility rule, price, capability, provider payload, or matrix control, update the registry through its container API. If the registry changes one of those facts, update the code, tests, and developer documentation before the task is complete.

## Validate the registry from inside the container

Check that every parameter accounts for every model in its group and that no model appears in both compatibility lists:

```bash
docker compose exec -T lixpi-ai-model-registry sh -lc '
  curl -fsS http://127.0.0.1:3010/api/catalog |
  jq -e "[
    .providers[].groups[] as \$group |
    \$group.parameters[] |
    (.supportedModels // []) as \$supported |
    (.unsupportedModels // []) as \$unsupported |
    select(
      (((\$supported + \$unsupported) | unique | sort) != (\$group.models | unique | sort)) or
      (((\$supported - \$unsupported) | length) != (\$supported | length))
    )
  ] | length == 0"
'
```

Then verify the affected model-sync, API/provider, and UI behavior through the repository's documented Docker test runner when tests are permitted. Do not use browser inspection or a host package manager as a substitute.
