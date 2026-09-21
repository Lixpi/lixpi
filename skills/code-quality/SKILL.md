---
name: code-quality
description: 'Select and apply Lixpi coding style and testing guides for implementation, review, refactors, and verification. Read at the start of every implementation iteration; testing remains explicitly user-gated.'
---

# Code Quality

Read this skill at the start of every implementation iteration, before editing code or selecting verification.

Before running any command, follow the command policy in `AGENTS.md`.

## Coding Style Guides

Inspect `documentation/code-quality/coding-style/` and read every guide that matches the files being changed.

| Files being touched | Required guide |
|---------------------|----------------|
| Any `.go` file in a Lixpi repository | [`GO.md`](../../documentation/code-quality/coding-style/GO.md) plus any service-specific guide in that repository |
| Any `.ts` file anywhere in the repository | [`TYPESCRIPT.md`](../../documentation/code-quality/coding-style/TYPESCRIPT.md) |
| `.scss` or `.css` files, or code that creates or selects styled DOM elements | [`SASS-AND-CSS.md`](../../documentation/code-quality/coding-style/SASS-AND-CSS.md) |
| `services/web-ui` UI work, including TypeScript DOM components, D3 or SVG, canvas chrome, ProseMirror plugins, and shared components | [`UI-COMPONENTS.md`](../../documentation/code-quality/coding-style/UI-COMPONENTS.md), in addition to the applicable language and style guides |

The guides stack. A TypeScript UI component with styles requires all three. `TYPESCRIPT.md` applies to every TypeScript file in the monorepo, not only web UI code. Only its DOM templating section is limited to `services/web-ui`.

When working in `lixpi-billing`, also read that checkout's `documentation/coding-style-guides/GO.md`. It contains the service-specific Nex, Stripe, ledger, logging-stream, testing-library, and PostgreSQL rules that do not belong in the generic Go guide.

## Testing Guides

Never write tests, modify tests, or run test commands unless the user explicitly asks for tests in the current thread. If tests were not requested, use static review and non-test hygiene checks only, and do not report the missing test run as a verification failure.

When tests are explicitly requested, inspect `documentation/code-quality/testing/` and read the guide for the affected language before writing, modifying, or running tests:

- TypeScript: [`TYPESCRIPT.md`](../../documentation/code-quality/testing/TYPESCRIPT.md)
- Go: [`GO.md`](../../documentation/code-quality/testing/GO.md)

Run permitted project verification only through the documented Docker container. Never substitute host package-manager commands, browser automation, screenshots, or manual visual inspection. If the permitted checks do not cover the changed behavior, report the remaining verification gap.
