# Param Picker

A review tool for deciding which provider generation parameters Lixpi should send, and which of those users should be able to change. Each parameter is one JSON file under `data/params/`, holding both its documentation and the decision made about it. The page renders them with a set of checkboxes and rewrites only the files you touch.

This is an internal decision tool. Nothing here ships to users.

To refresh the catalog when a provider API changes, read [Maintaining the Catalog](MAINTAINING-THE-CATALOG.md) first.

## Running it

```bash
docker compose --profile dev --profile main up -d lixpi-param-picker
```

Then open http://localhost:3010. Stop it with `docker compose --profile dev --profile main stop lixpi-param-picker`. The second profile is only there to make the compose project parse: `lixpi-dynamodb-admin` sits in the dev profile and depends on `lixpi-dynamodb` in main.

Everything runs inside the container. Node runs `src/server.ts` directly through native type stripping, so the server needs no build. The client is TypeScript and SCSS under `src/client`, served by Vite in development and built into `public/` for the image.

It hot reloads. Vite serves the page on 3010 and proxies `/api` to the Node server on 3011, so a saved stylesheet hot-swaps without losing your place and a saved module reloads the page. `node --watch` restarts the API server when its own sources change. Vite's watcher polls, because sources are bind-mounted from the host and an atomic editor save lands as a rename that produces no inotify event inside the container.

`public/` is build output and is gitignored; never edit it by hand. In the built image there is no Vite: the Node server serves the compiled assets and the API on 3010.

## Deciding a parameter

Two checkboxes on the title row carry the decision:

| Use | Show in UI | Stored decision | Meaning |
|---|---|---|---|
| off | n/a | `skip` | Do not send this parameter at all. |
| on | off | `internal` | Send a fixed or derived value, with no control in the model configuration matrix. |
| on | on | `expose` | Render a control for it in the model configuration matrix. |

Show in UI is disabled until Use is on, since a control for a parameter nobody sends would do nothing.

Every row opens pre-ticked to match what Lixpi does today, so the page describes the live system before you change anything: an already-exposed parameter has both boxes ticked, one we send but hide has only Use ticked, and one we never send has neither.

A separate `reviewed` flag records whether a human made the call or the row is still sitting at its seeded value. Touching a row sets it, and the **Unreviewed** filter lists everything nobody has confirmed yet, which is the real to-do list.

**Hide** appears at the right of the title row once Use is off. It folds the row down to its title and mutes it, for parameters that are out of scope whatever the provider supports. The note field stays visible so you can record why. Ticking Use again clears it.

## Choosing a value

A parameter with a published value list is picked straight from its chips: click one to select it, click it again to clear back to the provider default. Free-text parameters get a labelled input instead.

Which value you are setting follows the decision. On an `internal` row it is the value Lixpi will send; on an `expose` row it is the value the control starts on. The server clears whichever field does not apply, so the file never carries a value nothing uses.

The provider's own default is marked with a cream dashed border and a small **default** bubble above the chip. Your selection is marked in green, and green wins when you pick the provider default.

## Signing off

Three checkboxes at the bottom of each row record where the decision stands. They are mutually exclusive, and none of them implies `reviewed`, because flagging something for research is the opposite of having decided it.

- **Needs param clarification** — the parameter itself is not understood well enough yet.
- **Needs implementation investigation** — the parameter is understood, but how to wire it into Lixpi is not.
- **Approved** — settled, and ready to implement. Disabled while Use is off; unticking Use withdraws an existing approval with it.

## Reading the badges

Every row shows where the parameter stands today. **Already exposed** means a control exists in the matrix now, **Sent but hidden** means Lixpi sends it with a hardcoded or derived value, and **Never sent** means it does not reach the provider.

A second badge appears only when the parameter needs care. **Not on our models** means the provider documents it as unavailable on the models in that group, so ticking Use would be a mistake. **Verify first** means the docs and our code disagree, or the docs contradict each other, and someone should check the live API before deciding. Confirmed-supported parameters show no second badge.

Parameters Lixpi already sends also carry a **Used in this repo** block naming the file and line that sets the value, where the value comes from, and what it does there.

## Where the data lives

There is no registry and no index. The layout *is* the structure, discovered by walking the tree:

```
data/params/
    _meta.json                          catalog metadata and the legend
    reasoning/
        _meta.json                      the media type: title and reading order
        anthropic/
            _meta.json                  provider and group metadata
            effort.json                 one parameter: details and decision
            thinking.json
        google/ ...
        openai/ ...
    image/ ...
    video/ ...
```

Adding a parameter means dropping a JSON file into the right folder. Adding a provider means creating a folder with a `_meta.json` in it. Parameters sort by filename, so nothing has to be renumbered when one is added or removed.

Each parameter file carries the documentation fields (`apiField`, `type`, `values`, `range`, `providerDefault`, `lixpiValue`, `currentState`, `availability`, `summary`, `combines`, `usage`), which models and API surfaces accept it and which reject it (`supportedModels`, `unsupportedModels`, `supportedApis`, `unsupportedApis`), and the decision (`decision`, `reviewed`, `status`, `irrelevant`, `fixedValue`, `defaultValue`, `note`):

```json
{
    "key": "generate_audio",
    "apiField": "generate_audio",
    "controlKey": "generateAudio",
    "type": "boolean",
    "providerDefault": "true",
    "currentState": "hidden",
    "availability": "supported",
    "summary": "Decides whether the clip carries generated dialogue, effects and music.",
    "supportedModels": [
        "dreamina-seedance-2-0-260128",
        "dreamina-seedance-2-0-fast-260128",
        "dreamina-seedance-2-0-mini-260615",
        "dreamina-seedance-2-5-260628"
    ],
    "supportedApis": ["byteplus-modelark-video"],
    "decision": "expose",
    "reviewed": true,
    "status": "approved",
    "irrelevant": false,
    "fixedValue": "",
    "defaultValue": "false",
    "note": ""
}
```

The four compatibility arrays are read during assembly: each group publishes the union of its parameters' models, the model dropdown in the toolbar filters rows to the ones a given model accepts, and each card lists them as pills, green for documented support and red for documented rejection. A parameter the documentation does not restrict lists its group's whole range, because unmentioned means supported.

There are two write paths, and they are deliberately different.

`PUT /api/selections` is the page's own save. It rewrites only the files whose decision fields changed, each through a temp file and a rename, and does not snapshot: ticking a box is easier to redo than to recover. It refuses a save carrying fewer reviewed decisions than the tree already holds, and accepts `?snapshot=1` if you drive it programmatically.

`PATCH /api/params` is the agent path, and it is how documentation edits must be made. It can rewrite any parameter documentation field plus an existing group's `title`, `models`, and `docs`, merges only the fields you send, and always snapshots the files it touches into `data/history/params-<timestamp>/` first. It refuses unknown parameters, groups, and fields, and will not create, rename or delete anything. [Maintaining the Catalog](MAINTAINING-THE-CATALOG.md) covers the workflow.

The legend in `data/params/_meta.json` explains every enum, including values an older file may still use: `needsInvestigation: true` and `status: "needs-investigation"` both read back as `needs-param-clarification`.

## Editing the catalog

Edit the parameter files directly. Keep `controlKey` aligned with `MediaGenerationConfigControlKey` in [`packages/lixpi/constants/ts/types.ts`](../../packages/lixpi/constants/ts/types.ts).

A decision is identified by its path, `<type>/<provider>/<key>.json`, so moving or renaming a file moves the decision with it and deleting one throws the decision away. [Maintaining the Catalog](MAINTAINING-THE-CATALOG.md) covers how to refresh the tree safely, where each provider's documentation actually lives, and the kinds of change that are easy to miss.
