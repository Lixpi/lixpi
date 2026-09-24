---
name: fetch-byteplus-documentation
description: 'Read a BytePlus / ModelArk documentation page (docs.byteplus.com) as Markdown. Use whenever you need the content of a docs.byteplus.com URL, when a normal web fetch of one returns only JavaScript, an empty page, or a navigation shell, or when you need the ModelArk API reference, model list, pricing, or parameter details.'
---

# Fetch BytePlus documentation

`docs.byteplus.com` pages look unfetchable. A normal web fetch of one often comes back as a navigation shell with no body text, so agents conclude the content is only reachable by running JavaScript and give up. It isn't. The server-rendered HTML carries the entire document, including the exact Markdown behind the page's "copy as Markdown" button, and this skill pulls it out.

Run it through `lixpi-utils`. Never run it on the host, and never install Node to work around that:

```bash
docker compose --env-file "${LIXPI_REPOSITORY_PATH}/env.lixpi" \
    -f "${LIXPI_REPOSITORY_PATH}/docker-compose.lixpi-utils.yml" run --rm -T lixpi-utils \
    fetch-byteplus-documentation "${LIXPI_REPOSITORY_PATH}/skills/fetch-byteplus-documentation/scripts/fetch-byteplus-doc.ts" \
    https://docs.byteplus.com/en/docs/ModelArk/2377608
```

The rule and the reasoning behind it are in [`${LIXPI_REPOSITORY_PATH}/documentation/development-workflow/SKILL-EXECUTION-GUIDE.md`](${LIXPI_REPOSITORY_PATH}/documentation/development-workflow/SKILL-EXECUTION-GUIDE.md). The script is TypeScript that Node 24 runs directly through native type stripping, so there is nothing to build and no `tsconfig.json` to keep in sync.

## Naming a document

Pass a full URL or the shorter `Library/DocCode` form. Query strings are ignored, so a URL copied out of a browser with BytePlus tracking params (`?_vtm_=...`) works as-is.

```bash
... "${LIXPI_REPOSITORY_PATH}/skills/fetch-byteplus-documentation/scripts/fetch-byteplus-doc.ts" https://docs.byteplus.com/en/docs/ModelArk/2377608
... "${LIXPI_REPOSITORY_PATH}/skills/fetch-byteplus-documentation/scripts/fetch-byteplus-doc.ts" ModelArk/2377608
... "${LIXPI_REPOSITORY_PATH}/skills/fetch-byteplus-documentation/scripts/fetch-byteplus-doc.ts" ModelArk/2377608 ModelArk/2333565     # several at once
```

## Options

| Flag | Use when |
|---|---|
| *(none)* | Print the whole document, with a title/source/updated-at header, to stdout. |
| `--list-sections` | Get the heading outline first. Do this for a long page before pulling the whole thing. |
| `--section ID` | Print one section and its subsections. `ID` is an anchor from `--list-sections`. |
| `-o FILE` | Write to a file instead of stdout. With several docs, the doc code is appended per file. |
| `--no-metadata` | Drop the header block, leaving only the body. |
| `--attempts N` | Raise the retry count past the default 5 on a flaky network. |

A `#fragment` on the URL is used as `--section` when you don't pass one, so pasting the exact link someone shared gives you the section they meant:

```bash
... "${LIXPI_REPOSITORY_PATH}/skills/fetch-byteplus-documentation/scripts/fetch-byteplus-doc.ts" "https://docs.byteplus.com/en/docs/ModelArk/2608626#trust-model-output"
```

## Anchors are not slugs

BytePlus writes explicit anchors rather than slugifying heading text: the heading "Use trusted model outputs as input assets" answers to `#trust-model-output`. Both forms resolve here, since the script indexes the explicit anchor and a slug of the heading text, but this is why guessing an anchor from a heading usually fails. Run `--list-sections` and use what it prints:

```
# Use trusted model outputs as input assets  [#trust-model-output #use-trusted-model-outputs-as-input-assets]
  ## Scope and validity period  [#scope-and-validity-period]
```

## How it gets the content

Worth knowing, because it explains the one failure mode you'll hit.

The docs site is a Modern.js app that embeds its route payload in a `window._ROUTER_DATA = {...}` script tag. The document sits in that payload as `curDoc`, whose `MDContent` field is the Markdown the "copy as Markdown" button uses. So the content needs no browser, no headless Chrome, and no API key, just an HTTP GET and a JSON parse.

The complication is that the same URL answers in two shapes. Most requests return the full server-rendered page (roughly 80KB) carrying `_ROUTER_DATA`; some return a client-side-rendered shell (roughly 10KB) with no document data at all, and which one you get is not a property of the URL. That shell is what makes these pages look JavaScript-only, and a single fetch that lands on it looks like proof the content isn't there. The script sends browser-like `Accept` and `Accept-Language` headers, which make the server-rendered shape far more likely, and retries with a growing backoff when it still lands on the shell. Failure output names which attempt hit what, so a genuine 404 stays distinguishable from the shell.

## Reading the output

The Markdown is BytePlus's own export, so it carries some of their authoring markup:

- `<span id="..."></span>` markers before headings. These are the anchors above.
- `<div data-tips="true" data-tips-type="danger">Warning</div>` for callouts. Read it as an admonition.
- `<span aceTableMode="list" ...></span>` before tables, describing column layout. Ignore it.
- Backslash escapes such as `value\-added` and `real\-person`. These are literal hyphens.

Leave all of it alone when quoting the docs into a report or a code comment; strip it only if the text is going somewhere that renders raw HTML.

## Limits

- English pages only. The URL is normalised to `/en/docs/...`, and the script reads `MDContent`, which holds the English body.
- A doc whose body BytePlus never exported to Markdown fails with `curDoc has no MDContent` after its retries. That is a real gap in their data, not a transport problem, so retrying won't help.
- The script assumes the `_ROUTER_DATA` payload shape. If BytePlus reworks their site and every doc starts failing with `no _ROUTER_DATA` on every attempt, the extraction needs updating rather than more retries.
