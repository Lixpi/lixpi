---
title: AI Model Registry
description: The required synchronization contract between provider documentation, registry data, model discovery, provider requests, configuration controls, tests, and developer documentation.
---

# AI Model Registry

The AI Model Registry owns the model catalog. It records which provider models Lixpi ships and every fact about them, which generation parameters each model and API surface accepts, which values Lixpi sends, and which settings users can change. It runs as the `lixpi-ai-model-registry` service under [`services/ai-model-registry/`](../README.md), and on AWS it is the service that writes the `AI_MODELS_LIST` DynamoDB table the API reads.

Registry data and production code form one contract. A model or parameter fact is not updated until both sides agree.

## Two trees

| Tree | What it holds | Who writes it |
|---|---|---|
| `data/params/` | Generation parameters per media type and provider: provider documentation, compatibility, implementation state, and the decision Lixpi made about each one. | Humans, through the container API |
| `data/model-catalog/` | The models themselves. `catalog-settings.json` and `schema.json` at the root, then one directory per provider holding its own `base.json` and `catalog-settings.json` and, per model, one file per source plus `lixpi.json`, `merged.json`, and `_meta.json`. | The authored files by hand, everything else by the sync |

`catalog-settings.json` holds the catalog-wide settings, which today are the inference providers: every endpoint Lixpi can send a generation request to, the catalog directories each serves, and the environment flag that hands a directory to a platform provider. It decides which endpoints a model file carries values for and which the platform is calling, so a routing change is a data change here plus the matching provider adapter.

Every model records its values per inference provider. A source file keys them under `byInferenceProvider` and the merged file carries an `inferenceProviders` block with one entry per endpoint, alongside `inferenceProviderCalledByThePlatform` and the top-level fields that describe that call. A price on an endpoint Lixpi is not calling today is still a fact about the model and is never dropped.

Rates live in those per-endpoint blocks and nowhere else. A model carries no `pricing` field, because a price is a fact about an endpoint: the same model is billed at one rate through a vendor's own API and another through AWS Bedrock, so a single rate on the model would be wrong for at least one of them. Code that meters a request reads the block for the endpoint it called, through `activeInferenceProviderPricing` in `@lixpi/constants`.

`schema.json` declares the fields every model carries whatever its provider or modality, their types, and their owner: `lixpi` for what no source can supply, `source` for what an aggregator publishes, `derived` for what the tree itself decides. Conditional groups add fields by modality, and `requiredForEveryInferenceProvider` holds the fields a model carries once per endpoint rather than once, which today is pricing. Only the endpoint the platform calls has to satisfy those: a model with no rate on the route it runs on is held out of the database, and a gap on any other endpoint is recorded and ignored.

The authored file is edited through `PATCH /api/model-catalog/<provider>/models/<model>/lixpi`, the endpoint the catalog page's field form calls, which validates the model, snapshots the previous version, and reports what changed. One field fills itself in: a model discovered without a short title gets the title with its provider name and any brand prefix in `base.json`'s `shortTitleDropsLeadingWords` removed, written through that same endpoint so it is authored and editable rather than re-decided on every run. An authored short title is never overwritten.

The authored `-lixpi.json` holds only the `lixpi` half: capability flags, generation controls, modalities, icons, sort position, and titles, stated in full with no inheritance and no shared fragment to look up. Limits and prices are absent, because the sources publish them. An authored rate goes under `byInferenceProvider.<endpoint>.pricing`, the same key the source files use, so it states which endpoint's price it is correcting; a `pricing` block on the model itself is ignored and the model's `_meta.json` says so.

`base.json` holds the fields every model in a directory shares, such as the brand name and icons. A model's own authored file overrides anything stated there.

`_meta.json` records how each model was resolved and carries no values: which sources were consulted and which had data, whether more than one corroborated it, which fields they disagreed on, and which fields Lixpi authored, overrode, or inherited. Per field it names who supplied the value and who else answered. The values live in the merged file and the source files.

A provider's `catalog-settings.json` decides which of its models sync. Discovery is separate: a model a provider lists gets an empty scaffold, and the settings file says what to do about it. A model reaches DynamoDB only when the settings file includes it and every field the schema demands is filled in; each `-merged.json` records whether it is `included`, `incomplete`, or `excluded`. An excluded model is not scaffolded, not fetched for, and not merged into anything the database sees, and the sync removes its directory once it is in `history/`. A missing or unreadable settings file fails the run, because carrying on would mean including every model the provider lists.

The catalog holds one entry per model family. A provider's moving alias and its dated snapshots are one model, so the file is named without the snapshot suffix and the `model` inside it is the version to call.

### Sources

Four are consulted for every model, in this order:

| Source | What it supplies | Why it sits where it does |
|---|---|---|
| LiteLLM | Limits and every cost family: text tokens, image tokens, per-image, per-second | It names each cost family separately, so an image model's image-token rate and its text rate are different fields |
| models.dev | Limits and one cost per model | Better engineered and validated, but it publishes a single `cost` and cannot say which family it belongs to |
| Provider APIs | Whether a model is still offered on the account Lixpi calls, vendor display names, Google token limits | The only source that reflects Lixpi's actual account |
| AWS Bedrock | What the account can invoke on Bedrock and how, plus the AWS Price List rates for it | On the Bedrock route those rates are the bill, so they win pricing there; the listing also answers availability the vendor API cannot |

The order is precedence for the merge input, not a ranking of what is known, with one exception: pricing on the Bedrock route comes from the AWS price list whenever it has the field, because there the rate is the invoice rather than a copy of a published one. Every source's answer is kept in the file regardless.

### What the fetched file records

`_source.consulted` lists every source that was asked, including ones that had nothing, so a gap reads as "nobody covers this" rather than "nobody was asked".

`_source.fields` records each field's value per source and whether they agree: `single` when one source answered, `identical` when several answered the same, `differs` when they did not. A differing field names the value taken and every value that lost, and the run logs it as `SOURCES DIFFER`.

### Overriding a source

Filling a blank is an override, and it is the only way a Lixpi file asserts a number a source also reports. There are two reasons to do it, and both are checked by the sync rather than assumed:

- No source covers the field. The four Seedance models are here, plus `gpt-image-2` and the Veo models for their text rates.
- A source covers it in a different unit. Stability prices in credits while LiteLLM publishes dollars per image, so the merge refuses the value rather than converting it by guesswork and logs `UNIT MISMATCH`.

Once a file states a value, the sync reports every later disagreement with the source instead of resolving it. Price disagreements are reported separately because pricing feeds provider usage metrics over the `metrics.*` wire. A price finding names the endpoint it belongs to, as in `inferenceProviders.stability.pricing.image.completion`, so a disagreement on one route is never read as a disagreement everywhere.

A fetch is all or nothing. If any source fails, for any provider, the run raises before writing and the tree keeps what the last complete run left; a partial write would record a broken source as a source with nothing to say. Every run writes its outcome to `data/_last-sync.json`, and the catalog page shows a banner naming the sources that failed and what they said.

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

The model catalog has its own endpoints on the same server: `GET /api/models` returns the merged catalog, `GET /api/model-catalog/overview` returns the same models with their provenance, authored half, and drift attached, `GET /api/models/drift` returns where external sources disagree with the authored files, and `POST /api/models/sync` runs a sync. The service also serves two pages: `/model-parameters` for the parameter registry and `/model-catalog` for the model catalog. A manual run from inside the container is:

```bash
docker compose exec -T lixpi-ai-model-registry \
  node --experimental-transform-types ./src/catalog/cli.ts --no-write
```

Drop `--no-write` to write DynamoDB, and add `--no-fetch` to merge the tree as it stands without asking any source.

The registry image includes `curl` and `jq`. Existing parameter and group mutations use `PATCH /api/params` from inside the container. The endpoint validates targets and fields and snapshots every affected file before writing.

Do not edit `services/ai-model-registry/data/model-catalog/<provider>/<model>.json` by hand. Those files are the fetched half and every sync overwrites them; the `-lixpi.json` beside each one is the file a human edits.

Do not edit `services/ai-model-registry/data/params/` directly. The API intentionally refuses identity creation, renaming, and deletion. If a new provider parameter or group requires a new identity, add a validated API operation first and invoke that operation inside the container.

The service's [maintenance guide](MAINTAINING-THE-CATALOG.md) contains the patch command, provider research routes, compatibility rules, and container-side invariant checks.

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
