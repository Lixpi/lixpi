---
name: project-navigation
description: 'Navigate the Lixpi monorepo. Use when exploring, understanding, or finding code in this project — locating services, packages, infrastructure, documentation, or understanding how components connect.'
---

# Project Navigation

For the full architecture and service descriptions, read `documentation/PRODUCT-OVERVIEW.md`.

## Key Directories

| Directory | What Lives There |
|-----------|------------------|
| `services/` | Core application services (web-ui, api, llm-api, nats, localauth0) |
| `packages/lixpi/` | Shared TypeScript libraries — each package may have a `ts/` subdirectory |
| `packages-vendor/` | Vendored third-party packages (xyflow, shadcn-svelte) |
| `lambda-functions/` | AWS Lambda handlers (billing, Stripe, usage) |
| `infrastructure/` | Pulumi IaC and init scripts |
| `documentation/` | Product docs, feature specs, testing guides, style guides |
| `docker-compose.yml` | Local dev environment definition |

## Documentation Map

| Looking for... | Go to... |
|----------------|----------|
| Full architecture overview | `documentation/PRODUCT-OVERVIEW.md` |
| Feature specs | `documentation/features/` |
| Testing guides | `documentation/testing/` (organized by language, then service) |
| Coding style conventions | `documentation/coding-style-guides/` (organized by language) |
| Documentation style conventions | `documentation/documentation-style-guides/` |

## Tips

- Each folder may contain a `README.md` — always check for one when working in unfamiliar code.
- All inter-service communication flows through NATS — there's no direct HTTP between services.
- `packages/lixpi/constants/ts/types.ts` has the core shared TypeScript types.
