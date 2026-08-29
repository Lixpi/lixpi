# Maintaining the Catalog

`data/params/` holds one JSON file per provider parameter, each carrying both its documentation and the decision made about it. Provider APIs change constantly, so this page covers how to refresh the tree without losing anyone's decisions and without quietly missing a new parameter.

Read this before editing the tree. The picker itself is described in [README.md](README.md).

## The one rule that matters

A decision lives inside the parameter's own file, so **the file path is the identity**. Move, rename or delete `reasoning/anthropic/effort.json` and the decision goes with it, with no error and no warning.

So: **add and update, never rename or delete.** If a parameter's name changes on the provider's side, update its `apiField` and leave the filename alone. If a group's title changes, update `title` in that folder's `_meta.json` and leave the folder name alone. If a parameter disappears from the API, mark it `availability: "unsupported"` and say so in `summary`, rather than deleting the file.

## Agents must edit through the API

**Do not write parameter files directly.** Change them through `PATCH /api/params`, which snapshots every file it is about to touch into `data/history/params-<timestamp>/` before writing. That snapshot is the only thing standing between a bad bulk edit and a lost afternoon of researched prose, and a direct file write skips it.

```bash
curl -s -X PATCH http://localhost:3010/api/params \
  -H 'content-type: application/json' \
  -d '{
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

Parameter keys are `<providerId>/<groupId>/<paramKey>` and group keys are `<providerId>/<groupId>`. Existing groups expose only `title`, `models`, and `docs` through this endpoint. The endpoint merges only the fields you send and leaves the rest alone, so a documentation refresh cannot disturb anyone's decision by omission. It refuses a target that does not exist and a field it does not recognise, including identity fields such as `key`, `providerId`, and `groupId`. Recovering from a bad edit is copying the file back out of the snapshot folder.

Two things it deliberately will not do, because both change identity rather than content: **creating** and **deleting** parameters. Add a new parameter by writing its file into the right folder, and retire one by marking it `availability: "unsupported"` rather than deleting it. Do those on disk, and take your own copy of the tree first:

```bash
cp -R services/param-picker/data/params \
   "services/param-picker/data/history/params-manual-backup-$(date -u +%Y-%m-%dT%H-%M-%SZ)"
```

The page's own save (`PUT /api/selections`) is the human path and does not snapshot: ticking a box writes straight to the file, because one tick is easier to redo than to recover. It accepts `?snapshot=1` if you ever drive it programmatically.

After any refresh, check that `decision`, `reviewed`, `status`, `irrelevant`, `fixedValue`, `defaultValue` and `note` are untouched on every pre-existing file. A documentation refresh that moves one of them is a bug in the edit, not an intended change; `git diff` shows this directly once the tree is committed.

One safeguard neither path gives you: a renamed or moved file. From the server's point of view that is a brand new parameter nobody has reviewed, and the decision that was attached to the old path is gone.

## Fetching provider documentation

Each provider needs a different approach, and three of the five will hand you an empty page if you fetch them the obvious way.

**ByteDance / BytePlus ModelArk.** Use the `fetch-byteplus-documentation` skill. `docs.byteplus.com` returns a JavaScript shell often enough that a single fetch looks like proof the content is not there; the skill retries until it gets the server-rendered payload and extracts the page's own Markdown.

```bash
cd /Users/shallbee/Code/lixpi-root && docker compose -f docker-compose.lixpi-utils.yml \
    run --rm -T lixpi-utils fetch-byteplus-documentation scripts/fetch-byteplus-doc.ts ModelArk/1520757
```

Run it with `--list-sections` first on the long pages. The documents worth reading for a Seedance refresh are the create-task reference (`ModelArk/1520757`), the retrieve-task reference (`1521309`), the per-generation tutorials and prompt guides (`2607688`, `2607689`, `2222480`, `2291680`, `2298881`), the portrait and trusted-output rules (`2608626`), and the model list (`1330310`), which carries the exact model IDs and rate limits.

**Google.** The `ai.google.dev` pages are JavaScript shells, but every one of them has a plain-text twin: append `.md.txt` to the URL, as in `https://ai.google.dev/gemini-api/docs/thinking.md.txt`. Google Cloud's Vertex pages have no such twin and need a text proxy. The most reliable source for field names, allowed values and defaults is the versioned SDK:

```bash
curl -sL https://cdn.jsdelivr.net/npm/@google/genai/dist/genai.d.ts
```

The doc comments there are authoritative and carry the marker that matters most to us: **"This field is not supported in Gemini API"** means Vertex only. Lixpi builds every client as `new GoogleGenAI({ apiKey })`, so a Vertex-only field is dead weight and belongs in the catalog marked `unsupported`, not `supported`.

**OpenAI.** `platform.openai.com` now redirects to `developers.openai.com`, and the API reference pages return 403 to a plain fetch. Read the SDK types instead:

```bash
curl -sL https://cdn.jsdelivr.net/npm/openai/resources/responses/responses.d.ts
curl -sL https://cdn.jsdelivr.net/npm/openai/resources/images.d.ts
```

**Anthropic.** `docs.claude.com` and `docs.anthropic.com` both redirect to `platform.claude.com`. Follow the redirect; the pages render as text and are current.

**Stability.** `platform.stability.ai/docs/api-reference` is a Vite app behind Cloudflare and will only ever give you an empty shell, so do not spend turns on it. The AWS Bedrock pages mirror the same parameters and fetch as plain text:

```
https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-stability-diffusion.html
https://docs.aws.amazon.com/bedrock/latest/userguide/stable-image-services.html
```

Bedrock does not document every endpoint. Anything it omits, such as `replace-background-and-relight`, has to come from a client library and should be labelled as needing verification.

## Catching what a quick pass misses

Most of what goes stale is not a parameter that vanished. It is a parameter that gained a value, a default that moved, or a whole input mode that arrived without a new field name. Work through these deliberately:

**New enum values on an existing parameter.** `reasoning.effort` grew from three tiers to seven; Gemini's `thinkingLevel` gained `minimal`. Compare the `values` array against the docs rather than assuming the parameter is unchanged because its name is.

**Defaults that differ per model inside one group.** Gemini 3 defaults `thinkingLevel` to `high` while Gemini 3.1 defaults it to `minimal`. One `providerDefault` string cannot carry that, so put the split in `combines` and keep `providerDefault` honest about being model-dependent.

**Capabilities with no parameter of their own.** The reference-asset surface is the clearest case: Seedance expresses first frame, last frame, reference images, reference videos and reference audio through `content[].role` values, not through named fields. Veo expresses interpolation as `image` plus `config.lastFrame`, and extension as a top-level `video`. Reading only the parameter table misses all of it. Read the tutorials and the task-type tables too.

**Values that are locked by a task type.** Seedance 2.5 forces `ratio: adaptive` on edit, extend and frame-anchored tasks, and `duration: -1` on edits. These constraints live in the tutorial, not the parameter reference.

**Deprecations that still return 200.** `budget_tokens` is deprecated on Claude 4.6 and a hard 400 on 4.7 and later. `truncation` and `user` are deprecated on OpenAI. A parameter that has quietly stopped doing anything is worse than one that errors.

**Per-model support that is narrower than it looks.** Claude's `xhigh` effort exists on Opus 5, 4.8, 4.7 and Sonnet 5, but Opus 4.6 and Sonnet 4.6 support `max` and not `xhigh`. Do not assume the tiers form a ladder every model climbs.

**Fields the SDK exposes but the API rejects.** This is the Vertex trap above, and it is easy to import a whole set of parameters that cannot be sent.

When a new model arrives in an existing family, fold it into the existing group rather than creating a second one. Seedance 2.5 shares almost the entire wire contract with 2.0; it lives in the same folder, with the differences written onto the shared parameter files and the narrower ones listed in `supportedModels`. A separate folder would have split the same decision across two places.

Keep the four compatibility arrays current on every file you touch: `supportedModels`, `unsupportedModels`, `supportedApis`, `unsupportedApis`. They drive both the model filter and the pills on each card, so a stale list makes a parameter disappear from a filtered view or claim support it does not have.

The rule is that silence means support: if the documentation does not restrict a parameter, it supports its group's entire model list and `unsupportedModels` is empty. Only narrow it when a doc says so.

**Models and APIs are independent axes, and conflating them produces nonsense.** A Vertex-only field such as Veo's `config.mask` is supported by every Veo model; what it is not supported on is the Gemini Developer API. That belongs in `unsupportedApis`, and its model list stays green. An empty `supportedModels` is a strong claim: it says no model in this group accepts the parameter at all, which is only true when the parameter belongs to models outside the group entirely, the way `style` belongs to `dall-e-3` and `frames` to the Seedance 1.0 series. If a parameter shows every model red, check whether the restriction you are encoding is actually about the surface. The two arrays are complements over the group's `models`, so together they always account for every model, which is what makes a missing entry obvious. A field that is unreachable on our surface, such as a Vertex-only one, still lists the surface it does belong to, so the reason stays visible rather than the parameter looking simply broken.

## Using subagents for a full refresh

A full refresh across five providers is too much for one pass. Split it per provider, or per provider and model type, and have each agent write to its own file under a scratchpad `research/` directory. Give every agent the same output format, one block per parameter:

```
### <apiField>
- type: <enum | boolean | integer | number | string | object>
- values: <comma separated, or ->
- range: <or ->
- providerDefault: <or ->
- supportedOn: <models, and which reject it>
- summary: <1-3 sentences>
- combines:
  - <constraint or interaction>
```

That format parses mechanically, which matters more than it sounds: transcribing 200 parameters by hand introduces errors that are invisible on review. Parse the files into catalog rows with a script, apply a small hand-written table of corrections on top, and keep the raw research files so the next person can see where a claim came from.

Tell each agent explicitly which surface Lixpi calls: the Gemini Developer API and not Vertex, the Responses API and not Chat Completions. Otherwise they will document parameters that are real but unreachable. And tell them to write "not documented" instead of guessing, because a confident invention costs more than a gap.

## Deriving currentState and availability

These two fields are the ones a script will get wrong.

`currentState` says what Lixpi does today: `exposed` when a control exists in the model matrix, `hidden` when the value is hardcoded or derived, `absent` when nothing is sent. Read it off the provider adapters in `services/api/src/llm/providers/`, not off the docs. The `usage` block on each row records the file and line, and it should be updated whenever the call site moves.

`availability` says whether the parameter can be used at all on the models we ship. Do not derive it by pattern-matching the research text. A note reading "Not supported on gemini-3-pro-image" attached to a reasoning parameter is about a different model family entirely, and a substring match on "not supported" will mark a perfectly good parameter as unavailable. Decide it per row, from the model list of the group it sits in.
