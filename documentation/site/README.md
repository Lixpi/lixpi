# Lixpi Docs Site (standalone Markdoc renderer)

A zero-framework static renderer that turns every `.md` file under
`documentation/` into a browsable HTML site. The **only** runtime dependency is
[`@markdoc/markdoc`](https://github.com/markdoc/markdoc) — no React, no Svelte,
no SSG. Rendering uses Markdoc's built-in HTML string renderer
(`Markdoc.renderers.html`).

## Build (in Docker — never on the host)

Everything runs in containers. `documentation/` is not bind-mounted into the
running `lixpi-web-ui` container, so build with a one-off `docker run` that
reuses the same `lixpi/web-ui` image (node 23 + pnpm 9) and mounts only
`documentation/`. This does not disturb the running dev container.

```bash
# from the repo root
docker run --rm --entrypoint sh \
  -v "$PWD/documentation:/docs" -w /docs/site \
  lixpi/web-ui -lc 'pnpm install && node build.mjs'
```

Output lands in `documentation/site/dist/` (written back to the host through the
bind mount). `node_modules` persists there between runs, so reinstalls are fast.

### View

Open `documentation/site/dist/index.html` directly in a browser, or serve it
with the zero-dependency Node server (no python):

```bash
docker run --rm --entrypoint sh -p 8080:8080 \
  -v "$PWD/documentation:/docs" -w /docs/site \
  lixpi/web-ui -lc 'node serve.mjs'        # http://localhost:8080
```

## What the build does

1. Walks `documentation/` for `.md` files (skips `site/`, `node_modules`, `.git`).
2. Parses YAML frontmatter (`title`, `description`) with a tiny built-in reader.
3. `Markdoc.parse` → `Markdoc.validate` → `Markdoc.transform` → `Markdoc.renderers.html`.
4. Wraps the HTML in a page shell with a sidebar nav generated from the folder tree.
5. Mirrors the tree into `dist/`, rewriting intra-doc `*.md` links to `*.html`.

The build **fails (exit 1)** on any Markdoc parse/validate error or any dangling
intra-doc `.md` link, so it also works as a docs linter in CI.

## Authoring conventions (Markdoc-friendly)

- Start each page with YAML frontmatter: `title:` and `description:`.
- Put all code/JSON/TS in fenced blocks; Markdoc does not parse `{` inside fences.
- Mermaid stays as ` ```mermaid ` fenced blocks — they currently render as a
  `<pre class="mermaid">` placeholder (client-side hydration is a future step).
- Use `{% callout type="note|warning|important|tip" %}…{% /callout %}` for asides.
- Keep cross-links relative and pointing at `.md` (the build rewrites to `.html`).

## Files

| File | Purpose |
|------|---------|
| `build.mjs` | Walk → parse → validate → transform → render → write; link + error gates |
| `markdoc/config.mjs` | Custom nodes (`link`, `fence`) + tags (`callout`); `.md`→`.html` rewrite |
| `markdoc/template.mjs` | HTML page shell + sidebar nav rendering |
| `assets/styles.css` | Hand-written stylesheet ("In the Sunshine" palette) |
