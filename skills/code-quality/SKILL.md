---
name: code-quality
description: 'Select and apply Lixpi coding style and testing guides for implementation, review, refactors, and verification. Read at the start of every implementation iteration; testing remains explicitly user-gated.'
---

# Code Quality

Read this skill at the start of every implementation iteration, before editing code or selecting verification.

Before running any command, follow the command policy in `AGENTS.md`.

## Discover Applicable Guides

Resolve every repository root that contains a file in the current task. Read that repository's configuration and agent instructions to identify its configured absolute repository-path variable, then use that variable directly. Do not infer sibling checkout locations.

Inspect guide filenames before reading their contents. Start with each repository's `documentation/code-quality/coding-style/` and `documentation/code-quality/testing/` directories. If either directory is absent or does not cover the affected language or component, search that repository's `documentation/` tree for the equivalent concern, including directories named `coding-style`, `coding-style-guides`, or `testing`, and files named for the affected language, framework, service, or component.

Load guides progressively:

1. Identify the languages, file types, services, and components affected by the task.
2. Read the matching shared guide listed below.
3. Read every matching repository-local guide discovered for the same concern. A local guide adds rules to the shared guide; it does not replace it unless it explicitly says so.
4. Follow links from a selected guide only when the linked material applies to the current files or verification. Do not load unrelated guides.

The shared coding-style guides map to work as follows:

| Files being touched | Shared guide |
|---------------------|--------------|
| Any `.go` file in a Lixpi repository | `${LIXPI_REPOSITORY_PATH}/documentation/code-quality/coding-style/GO.md` |
| Any `.ts` file anywhere in the repository | `${LIXPI_REPOSITORY_PATH}/documentation/code-quality/coding-style/TYPESCRIPT.md` |
| `.scss` or `.css` files, or code that creates or selects styled DOM elements | `${LIXPI_REPOSITORY_PATH}/documentation/code-quality/coding-style/SASS-AND-CSS.md` |
| `services/web-ui` UI work, including TypeScript DOM components, D3 or SVG, canvas chrome, ProseMirror plugins, and shared components | `${LIXPI_REPOSITORY_PATH}/documentation/code-quality/coding-style/UI-COMPONENTS.md`, in addition to the applicable language and style guides |

The guides stack. A TypeScript UI component with styles requires all three. `TYPESCRIPT.md` applies to every TypeScript file in the monorepo, not only web UI code. Only its DOM templating section is limited to `services/web-ui`.

## Testing Guides

Never write tests, modify tests, or run test commands unless the user explicitly asks for tests in the current thread. If tests were not requested, use static review and non-test hygiene checks only, and do not report the missing test run as a verification failure.

When tests are explicitly requested, use the same progressive discovery process for testing guides. Read the matching shared guide first, then every applicable repository-local testing guide:

- TypeScript: `${LIXPI_REPOSITORY_PATH}/documentation/code-quality/testing/TYPESCRIPT.md`
- Go: `${LIXPI_REPOSITORY_PATH}/documentation/code-quality/testing/GO.md`

Run permitted project verification only through the documented Docker container. Never substitute host package-manager commands, browser automation, screenshots, or manual visual inspection. If the permitted checks do not cover the changed behavior, report the remaining verification gap.
