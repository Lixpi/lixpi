---
title: Maintaining Documentation
description: How to keep Lixpi's developer documentation accurate, readable, Markdoc-compatible, and easy to navigate as the product and architecture change.
---

# Maintaining Documentation

Lixpi documentation should be useful to a human developer first. It can help agents too, but it should not read like agent scaffolding, a checklist dump, or a frozen snapshot of the repo tree.

Use this guide when creating, moving, deleting, or reorganizing documentation.

## Start by Discovering the Current Shape

Do not assume the current folders, page names, or architecture boundaries are permanent. Before changing documentation:

1. Read the docs index at the root of the documentation tree.
2. Check the generated docs-site navigation or list the current Markdown files.
3. Read the pages around the area you are changing.
4. Read nearby source-code READMEs for the implementation area.
5. Fact-check behavior against the current code before repeating or rewriting it.

The docs index is a map, not a contract. If the product shape changes, update the map to match the new shape. Avoid adding tiny "read this folder first" files whose only job is routing; put real guidance in this guide, in the relevant domain page, or in the docs index.

## Keep the Structure Flexible

Organize by stable product or engineering concerns, not by whatever filenames happen to exist today. Good documentation domains usually answer one of these questions:

- What is this part of the product?
- What data does it persist?
- How does the runtime path work?
- How does a user flow move through the system?
- How is it deployed or operated?
- What conventions must implementation code follow?

When the architecture changes, the documentation shape should change with it. Moving a page is fine. Splitting a page is fine. Deleting a page is fine if the content was moved or is no longer true.

Before deleting or replacing docs, compare against the previous version and account for every important concept:

- Keep still-true product behavior.
- Drop behavior that no longer exists.
- Mark historical context as historical instead of letting it masquerade as live behavior.
- Preserve useful rationale, constraints, and gotchas.
- Remove stale route-finding breadcrumbs.

## Keep the Docs Honest

Every factual claim should be easy to defend from the current code, infrastructure, tests, or linked external source.

Prefer durable statements over brittle ones:

- Say "application tables" instead of freezing a table count.
- Say "configured by the deployment" instead of hardcoding a task count unless the exact number is the point.
- Say "current default" when a setting can change.
- Say "computed and logged" if the code does not publish or persist something.
- Say "future split needs worker subscription code" if the boundary exists but the implementation is not wired.

Avoid broad absolute claims unless the code enforces them:

- "all"
- "every"
- "never"
- "guarantees"
- "only source"
- "production-ready"
- "no code changes"

If the claim is a benchmark, capacity estimate, market comparison, legal/compliance statement, or vendor capability, either cite a current source or make it clear that it is a hypothesis that needs validation.

## Write Like a Developer

Use direct, natural language. Prefer the plain sentence that explains the thing.

Avoid bureaucratic filler:

- "source of truth" when "covers" or "explains" works
- "owned by" when "covered in" works
- "delta" when "what is specific to this page" works
- "leverage" when "use" works
- "robust solution" without saying what failure it handles

Documentation should sound like a senior engineer explaining the system to another engineer: precise, calm, and not puffed up.

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
- JSX/Svelte syntax.
- Inline HTML that Markdoc may parse differently from GitHub.
- Unclosed `{% callout %}` tags.
- Mermaid diagrams that depend on unsupported runtime plugins.
- Anchor links guessed by hand without running the docs build.

The docs build generates heading IDs and validates anchor fragments. If you link to a heading, run the build instead of assuming the slug.

## Moving or Renaming Pages

When reorganizing documentation:

1. Map old pages to their new homes before deleting anything.
2. Search for old paths and old page titles across the repo.
3. Update links in docs, source comments, package READMEs, and tests.
4. Run the docs build.
5. If a source-shape test asserts a documentation path, update the test with the new path.

Do not leave references to deleted pages. A green docs build should mean the rendered site is safe to click, including heading anchors and source-code links.

## Updating the Docs Index

The docs index should help readers choose a starting point. It does not need to list every file forever.

Keep the index useful by:

- Linking to the main entry points for each active domain.
- Describing what each domain is for.
- Letting the generated site sidebar provide the exhaustive file inventory.
- Removing links to pages that became archives, implementation memory, or stale planning notes.

When a domain changes shape, update the index at the same time as the pages. Do not add a separate "using this directory" page just to tell agents to inspect a folder.

## Verification

Always run the docs build after documentation changes:

```bash
pnpm docs:build
```

The build is the link and Markdoc compatibility gate. It should fail on Markdoc parse/validation errors, dangling documentation links, missing source-code link targets, and broken heading fragments.

If documentation changes a tested source assertion, run the relevant test
through the allowed project test command only when the user explicitly asks for
tests in the current thread. For web UI tests, use Dockerized Vitest. Do not use
`svelte-check`, browsers, screenshots, or manual visual inspection as
substitutes for permitted tests.

## Before Calling It Done

Check these:

- The docs describe the current code, not the old architecture.
- Historical behavior is clearly labeled as historical.
- Links work in the generated site, not only on GitHub.
- Page names and headings are human-readable.
- The docs index still gives a good starting point.
- No tiny routing-only guide was added.
- No brittle counts, capacity promises, or exact file inventories were added unless they are intentionally part of the subject.
