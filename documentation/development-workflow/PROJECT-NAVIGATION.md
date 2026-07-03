# Project Navigation

Use this guide when locating Lixpi code, tracing architecture, or deciding where project documentation belongs.

For the architecture and service map, start with [`documentation/PRODUCT-OVERVIEW.md`](../PRODUCT-OVERVIEW.md).

## Key Directories

| Directory | Contents |
|-----------|----------|
| `services/` | Application services, including the Svelte web UI and Node API. |
| `packages/lixpi/` | Shared TypeScript libraries and constants. |
| `packages-vendor/` | Vendored third-party source used by the application. |
| `infrastructure/` | Pulumi infrastructure and initialization scripts. |
| `documentation/` | Architecture, features, testing, style, and development workflow guidance. |

## Documentation Map

| Topic | Location |
|-------|----------|
| Architecture overview | `documentation/PRODUCT-OVERVIEW.md` |
| Product and implementation docs | `documentation/platform/`, `documentation/canvas/`, `documentation/ai-chat/`, `documentation/media-generation/`, `documentation/library/` |
| Testing conventions | `documentation/testing/` |
| Code style | `documentation/coding-style-guides/` |
| Documentation style | `documentation/documentation-style-guides/` |
| Development workflow | `documentation/development-workflow/` |

## Working Notes

Store agent-generated persistence notes, planning memory, and continuity artifacts under `documentation/memory/`. Do not place those temporary artifacts in product source directories.

When working in a source area, read a nearby existing `README.md` before editing and update it when the documented component behavior changes.
