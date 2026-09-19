---
title: Maintaining Documentation
description: How to discover, move, link, and verify Lixpi's developer documentation as the product and architecture change.
---

# Maintaining Documentation

Use this guide when creating, moving, deleting, or reorganizing documentation.

## Required Writing Skill

Before creating, revising, reviewing, or replying about any documentation, resolve and read `$talk-like-a-human` through the active harness's skill discovery. This is a hard rule. The skill owns prose style, live-system framing, durable factual claims, and document organization. This guide owns discovery, Markdown conventions, page moves, navigation, and verification.

If the skill cannot be resolved or read, stop immediately. Do not edit the documentation and do not continue the task. Report that `talk-like-a-human` could not be resolved, then wait for the user's instructions.

## Start by Discovering the Live Shape

Do not assume folders, page names, or architecture boundaries are permanent. Before changing documentation:

1. Read the docs index at the root of the documentation tree.
2. List or search the Markdown files in the documentation tree.
3. Read the pages around the area you are changing.
4. Read nearby source-code READMEs for the implementation area.
5. Fact-check behavior against the live code before repeating or rewriting it.

The docs index is a map, not a contract. If the product shape changes, update the map to match the new shape. Avoid adding tiny "read this folder first" files whose only job is routing; put real guidance in this guide, in the relevant domain page, or in the docs index.

## Keep Markdown Portable

These docs are read directly as Markdown in GitHub and editors. The static documentation site is currently set aside pending its redesign.

Use this authoring shape:

```markdown
---
title: Page Title
description: One sentence about what this page covers.
---

# Page Title
```

Frontmatter is optional, but human-facing pages should keep it when it already exists.

Use standard Markdown whenever possible:

- Relative links to documentation pages should point at `.md` files.
- Links to source code outside the documentation tree should be normal relative repo links.
- Use fenced code blocks with a language tag.
- Use Mermaid only inside fenced `mermaid` blocks.
- Write notes and warnings as ordinary Markdown paragraphs or blockquotes.

Avoid:

- Raw framework components and framework component syntax such as JSX.
- Inline HTML when standard Markdown expresses the same thing.
- Mermaid diagrams that depend on editor-specific plugins.
- Anchor links guessed by hand. Prefer linking to the page when you cannot verify a heading fragment.

## Package Documentation

Rendering-engine manuals live in `packages/lixpi/canvas-engine/docs/`; reusable canvas surface and effect manuals live in `packages/lixpi/canvas-components/docs/`. Lixpi workspace composition belongs in `packages/lixpi/canvas-components-lixpi-specific/docs/`. Shared DOM, SVG and gradient guidance belongs in `ui-primitives`; generic control guidance belongs in `ui-kit`; Gentelella theme integration and upgrade guidance belongs in `ui-kit-gentelella/documentation/`. Each package README introduces its contracts and links to its manuals. Central canvas pages describe product behavior and persistence, then link to those package entry points.

Do not copy package manuals into `documentation/`. Keep each manual beside the package it describes, link to it from the central documentation map, and keep links relative to the original file.

## Service Documentation

A service that owns a body of documentation keeps it in `services/<service>/documentation/`, beside the code it describes. Its README explains the service's responsibilities and links to those manuals. The [AI Model Registry](../services/ai-model-registry/README.md) keeps its catalog contract and maintenance guide there; [NATS](../services/nats/README.md) keeps its broker architecture, configuration and operations guides there.

The central tree links to those pages instead of holding a copy. A domain page, the docs index, or a navigation table gets one line pointing at the service page; nothing is duplicated, and no routing-only file is added to carry the link.

## Moving or Renaming Pages


When reorganizing documentation:

1. Map old pages to their new homes before deleting anything.
2. Search for old paths and old page titles across the repo.
3. Update links in docs, source comments, package READMEs, and tests.
4. Use static link review to verify the changed paths.
5. If a source-shape test asserts a documentation path, update the test with the new path.

Do not leave references to deleted pages. Keep links defensible through static review.

## Updating the Docs Index

The docs index should help readers choose a starting point. It does not need to list every file forever.

Keep the index useful by:

- Linking to the main entry points for each active domain.
- Describing what each domain is for.
- Keeping exhaustive file discovery in repository search instead of duplicating it here.
- Removing links to pages that became archives, implementation memory, or stale planning notes.

When a domain changes shape, update the index at the same time as the pages. Do not add a separate "using this directory" page just to tell agents to inspect a folder.

## Verification

There is no active documentation-site build. Use static review to check links, headings, and surrounding context.

If documentation changes a tested source assertion, run the relevant test through the allowed project test command only when the user explicitly asks for tests in the current thread. For web UI tests, use Dockerized Vitest. Do not use browsers, screenshots, or manual visual inspection as substitutes for permitted tests.

## Before Calling It Done

Check these:

- The `talk-like-a-human` rules are satisfied.
- Links resolve from the Markdown files where they are written.
- The docs index still gives a good starting point.
- No tiny routing-only guide was added.
