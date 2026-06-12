---
name: implementation-plans
description: 'Author implementation plans, technical proposals, design docs, RFCs, feature specs, deep research, or "tickets" for Lixpi. Use whenever the user asks for any pre-implementation planning artifact that will be shared with another human.'
---

# Implementation Plans & Research

Before running any command, follow the Docker-only command rule in `AGENTS.md` and `documentation/development-workflow/AGENT-SKILLS.md`: never run `npm`, `npx`, `pnpm`, or `pnpx` on the host.

The full procedure — research methodology, mandatory document structure, diagram conventions, iteration protocol with the user, GitHub sync, cleanup rules — lives in `documentation/development-workflow/WRITING-IMPLEMENTATION-PLANS.md`.

## When to use this skill

Whenever the user requests:

- An implementation plan.
- A technical proposal, design doc, RFC, or feature spec.
- Deep research on a feature, vendor evaluation, or architectural trade-off.
- A "ticket" (in this codebase's lexicon: a comprehensive design doc, not a one-line task).
- Any other pre-implementation planning artifact.

## How to follow this skill

1. Open `documentation/development-workflow/WRITING-IMPLEMENTATION-PLANS.md`.
2. Read it in full before drafting anything.
3. Follow every convention in it — including the mandatory document structure (in order), the research methodology, the diagram style, the storage location (`documentation/memory/<NAME>.md`), and the user-iteration protocol.

The guide is the source of truth. Do not improvise on the document structure, the research approach, the diagram style, or the storage location.
