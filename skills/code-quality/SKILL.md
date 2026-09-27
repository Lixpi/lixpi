---
name: code-quality
description: 'Select and apply Lixpi coding style and testing guides for implementation, review, refactors, and verification. Read at the start of every implementation iteration and use the verification modes in env.lixpi.'
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

## Verification Modes and Testing Guides

Before choosing verification, read `CODING_AGENTS_TEST_EXECUTION_MODE` and `CODING_AGENTS_TEST_LINTER_MODE` from the current repository's `env.lixpi` as configuration data. Require both values and accept only `true`, `false`, or `auto`; stop if either value is missing or invalid. The two modes are independent:

- `true`: Run relevant tests for the test mode, or relevant formatting and lint checks for the linter mode.
- `false`: Run the corresponding checks only after the user explicitly authorizes them in the active thread.
- `auto`: Decide whether the corresponding checks are useful for the task and run them when they are.

An explicit user instruction about verification takes precedence over either mode. The linter mode covers the Docker quality runners' combined formatting and lint validation. Never write or modify test files unless the user explicitly asks for test work in the current thread.

When test work is permitted by the test mode or an explicit user request, use the same progressive discovery process for testing guides. Read the matching shared guide first, then every applicable repository-local testing guide:

- TypeScript: `${LIXPI_REPOSITORY_PATH}/documentation/code-quality/testing/TYPESCRIPT.md`
- Go: `${LIXPI_REPOSITORY_PATH}/documentation/code-quality/testing/GO.md`

Run permitted project verification only through the documented Docker container. Never substitute host package-manager commands, browser automation, screenshots, or manual visual inspection. If the permitted checks do not cover the changed behavior, report the remaining verification gap.
