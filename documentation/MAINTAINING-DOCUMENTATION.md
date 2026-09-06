---
title: Maintaining Documentation
description: How to discover, move, link, render, and verify Lixpi's developer documentation as the product and architecture change.
---

# Maintaining Documentation

Use this guide when creating, moving, deleting, or reorganizing documentation.

## Required Writing Skill

Before creating, revising, reviewing, or replying about any documentation, resolve and read `$talk-like-a-human` through the active harness's skill discovery. This is a hard rule. The skill owns prose style, live-system framing, durable factual claims, and document organization. This guide owns discovery, Markdoc compatibility, page moves, navigation, and verification.

If the skill cannot be resolved or read, stop immediately. Do not edit the documentation and do not continue the task. Report that `talk-like-a-human` could not be resolved, then wait for the user's instructions.

## Start by Discovering the Live Shape

Do not assume folders, page names, or architecture boundaries are permanent. Before changing documentation:

1. Read the docs index at the root of the documentation tree.
2. Check the generated docs-site navigation or list the Markdown files.
3. Read the pages around the area you are changing.
4. Read nearby source-code READMEs for the implementation area.
5. Fact-check behavior against the live code before repeating or rewriting it.

The docs index is a map, not a contract. If the product shape changes, update the map to match the new shape. Avoid adding tiny "read this folder first" files whose only job is routing; put real guidance in this guide, in the relevant domain page, or in the docs index.

## Keep Markdoc Compatibility

These docs are Markdown that must render through the static Markdoc site.

Use this authoring shape:

```markdown
---
title: Page Title
description: One sentence about what this page covers.
---

# Page Title
```

Frontmatter is not mandatory for the renderer, but human-facing pages should have it.

Use standard Markdown whenever possible:

- Relative links to documentation pages should point at `.md` files.
- Links to source code outside the documentation tree should be normal relative repo links.
- Use fenced code blocks with a language tag.
- Use Mermaid only inside fenced `mermaid` blocks.
- Use Markdoc callouts for notes, warnings, important details, and tips.

```markdoc
{% callout type="warning" %}
Explain the risk and what to do about it.
{% /callout %}
```

Avoid:

- Raw framework components.
- Framework component syntax such as JSX.
- Inline HTML that Markdoc may parse differently from GitHub.
- Unclosed `{% callout %}` tags.
- Mermaid diagrams that depend on unsupported runtime plugins.
- Anchor links guessed by hand. Prefer linking to the page when you cannot verify a heading fragment.

The docs build can validate heading IDs and anchor fragments when a human explicitly asks for that check. Do not run it as a default agent step.

## Package Documentation

Rendering-engine manuals live in `packages/lixpi/canvas-engine/docs/`; reusable canvas surface and effect manuals live in `packages/lixpi/canvas-components/docs/`. Lixpi workspace composition belongs in `packages/lixpi/canvas-components-lixpi-specific/docs/`. Shared DOM, SVG and gradient guidance belongs in `ui-primitives`; generic control guidance belongs in `ui-kit`. Each package README introduces its contracts and links to its manuals. Central canvas pages describe product behavior and persistence, then link to those package entry points.

The [site source registry](site/source-registry.mjs) records authored source paths and output routes. Register package documentation explicitly; do not copy manuals into `documentation/` or ingest an entire package source tree. Keep package links relative to the original file. The same resolver validates and renders links, including package assets and heading fragments.

## Service Documentation

A service that owns a body of documentation keeps it in `services/<service>/documentation/`, beside the code it describes. The AI Model Registry is the one that does today: its contract and its maintenance guide live in `services/ai-model-registry/documentation/`, and the service README introduces them.

The central tree links to those pages instead of holding a copy. A domain page, the docs index, or a navigation table gets one line pointing at the service page; nothing is duplicated, and no routing-only file is added to carry the link. Register the service in `SERVICE_NAMES` in the site source registry so its README and documentation directory render with everything else.

## Moving or Renaming Pages


When reorganizing documentation:

1. Map old pages to their new homes before deleting anything.
2. Search for old paths and old page titles across the repo.
3. Update links in docs, source comments, package READMEs, and tests.
4. Use static link review, or the Dockerized documentation link tests when tests are explicitly requested. Run a docs build only when separately requested.
5. If a source-shape test asserts a documentation path, update the test with the new path.

Do not leave references to deleted pages. Keep links defensible from static review unless a requested docs build validates the rendered site.

## Updating the Docs Index

The docs index should help readers choose a starting point. It does not need to list every file forever.

Keep the index useful by:

- Linking to the main entry points for each active domain.
- Describing what each domain is for.
- Letting the generated site sidebar provide the exhaustive file inventory.
- Removing links to pages that became archives, implementation memory, or stale planning notes.

When a domain changes shape, update the index at the same time as the pages. Do not add a separate "using this directory" page just to tell agents to inspect a folder.

## Verification

Do not run the docs build after documentation changes unless the user explicitly asks for it. Use static review by default.

When a docs build is explicitly requested, run it through the documented Docker-only workflow. Never run `pnpm docs:build` on the host.

If documentation changes a tested source assertion, run the relevant test through the allowed project test command only when the user explicitly asks for tests in the current thread. For web UI tests, use Dockerized Vitest. Do not use browsers, screenshots, or manual visual inspection as substitutes for permitted tests.

## Before Calling It Done

Check these:

- The `talk-like-a-human` rules are satisfied.
- Links work in the generated site, not only on GitHub.
- The docs index still gives a good starting point.
- No tiny routing-only guide was added.
