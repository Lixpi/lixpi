# Writing Implementation Plans

This is the source of truth for how to author an implementation plan, technical proposal, design doc, RFC, feature spec, or "ticket" in the Lixpi codebase. Read it in full before drafting anything.

## What this document covers

- When this guide applies (and when it doesn't).
- Where plans are stored and how their lifecycle works.
- The mandatory document structure — every required section, in order, with what each section must contain.
- Research methodology before you draft.
- The iteration protocol with the user.
- Mermaid diagram conventions.
- What happens after the plan is approved (GitHub sync, cleanup).
- Anti-patterns to avoid.
- An end-to-end checklist.

## When this guide applies

Read and follow this guide whenever the user requests:

- An implementation plan.
- A technical proposal, design doc, RFC, or feature spec.
- Deep research on a feature, a vendor evaluation, or an architectural trade-off.
- A "ticket" (in this codebase's lexicon: a comprehensive design doc, not a one-line task).
- Any pre-implementation planning artifact that will be shared with another human.

If the request is small enough to fit in a one-line commit message, you don't need this guide. If multiple architectural decisions could realistically be made differently, you do.

## Where plans are stored

All proposals and implementation plans live in `documentation/memory/<NAME>.md`.

- **Naming**: ALL-CAPS-DASH-SEPARATED, matching the parent `documentation/` convention (`ARCHITECTURE.md`, `INFRASTRUCTURE-AND-DEPLOYMENT.md`, `PRODUCT-OVERVIEW.md`, etc.). Do not invent a different naming style.
- **Lifecycle**: a file is created when planning begins, lives there during implementation, and is deleted when the feature has fully landed. The `documentation/memory/` directory is **not** a historical archive — it is live planning context for in-flight work. Treat it that way.
- **GitHub sync**: every plan must also exist as a GitHub issue with the identical body. The issue is where reviewers comment; the markdown file is where the plan is iterated on locally. Both are kept in sync until the file is deleted; once the feature ships, the issue is closed and the file is removed.

## Mandatory document structure

Every plan must contain the following sections, in this order. Sections marked **required** must be present even if the answer is "n/a — see below". Sections marked *optional* may be omitted only when truly irrelevant.

### 1. Title (H1) — required

Use the same title as the GitHub issue title. Concise, capitalized like a product feature name.

### 2. TL;DR — required

Two paragraphs at most.

- **Paragraph 1**: one-sentence concept + one-sentence value proposition. Write it as if explaining to a brand-new engineer in 30 seconds.
- **Paragraph 2**: what this *replaces* or *modifies*. Cite the existing files/handlers/endpoints by markdown link, with line ranges. Be specific about behavioral changes — do not say "improves X"; say "the current handler creates a thread region; that path is gone."

### 3. Problem statement — required

Multiple paragraphs. Cover:

- The product context the user is operating in (cite the relevant section of `documentation/PRODUCT-OVERVIEW.md`).
- The concrete pain, ideally illustrated by a short user vignette.
- Why existing workarounds don't work — enumerate them and explain why each fails.
- Prior art outside the codebase: name the comparable products and any academic work briefly, with URLs.
- A one-line summary of what we are building to solve the problem.

### 4. Goals — required

Bullet list of 4–8 items. Each bullet describes a user-visible capability the feature ships, **not** an implementation detail. If a bullet contains a file path, it belongs in a phase, not in goals.

### 5. Non-goals — required

Bullet list. What this feature explicitly does **not** do, even though a reader might assume it would. Move every "out of scope for v1" item here proactively — better to be explicit up front than to argue about it during review.

### 6. Product principles — required

3–5 short principles that act as **tiebreakers** when implementation trade-offs come up. These are the rules you fall back on when a design choice is ambiguous. Real principles are testable: a reviewer should be able to point at a design choice and say "this violates principle 2." Avoid platitudes.

### 7. Concept ("What is X?") — required

Plain-English definition of the new primitive(s) the feature introduces. Include:

- A field-by-field table of the data model.
- An "Examples" subsection with a concrete cases table — minimum 5 rows showing a variety of real user requests and the agent/system response. Aim to demonstrate the full range of what the feature accepts and produces.
- A subsection covering edge inputs (e.g. "this also works for non-image inputs") if the requirement allows them.

### 8. Key technical strategy — required when applicable

The headline technical idea. If the feature relies on a non-obvious approach (anti-leakage / disentanglement, eventual consistency, novel auth flow, vector-clock convergence, etc.), explain it here in detail before the rest of the architecture.

When citing research:

- Provide the arXiv URL or vendor doc URL.
- Briefly summarize what the paper or product does.
- State what we are shipping in v1 vs what the SOTA does, and why we are shipping the v1 version.
- Document the v2 escalation path.

### 9. UX flows — required when user-facing

A subsection per user-facing surface (panel, modal, slash command, hotkey, etc.). Each subsection covers:

- Closed/initial state.
- Open/active state.
- Inputs and outputs.
- Persistence behavior (what survives reload, what does not).
- Tech-stack constraints (e.g. "vanilla TS, no new Svelte components").
- File paths to touch (markdown links with line ranges).

### 10. Data model — required

TypeScript-style type definitions for every new type. Comment the fields. If the representation is hybrid (structured + freeform), explain why each component exists and what is lost if you collapse to one form.

### 11. Storage architecture — required when persistence is touched

- DynamoDB tables: primary table + meta + access list, with PK/SK/Indexes. Mirror existing project patterns (see `infrastructure/pulumi/src/resources/db/DynamoDB-tables.ts` for conventions like the `MAIN + _META + _ACCESS_LIST` triad).
- Object storage: bucket layout, key prefixes, cross-scope access strategy.
- IAM bindings to update (and any pre-existing gaps to flag).

### 12. NATS subjects (or equivalent transport) — required when messaging is touched

Show the JSON additions to `packages/lixpi/constants/nats-subjects.json`. Group by the existing top-level keys (`WORKSPACE_SUBJECTS`, `AI_INTERACTION_SUBJECTS`, etc.). Note any subject reuse from existing infrastructure.

### 13. Architecture changes — required

- Backend graph topology changes (mermaid diagram).
- Tool/handler additions.
- Cross-service implications.
- Cite specific files with markdown links + line ranges.

### 14. Alternative evaluation — required when alternatives exist

If the user asked about a vendor, library, framework, or architectural alternative — even implicitly — write a fair-comparison section. Cover:

- What the alternative is (one paragraph).
- Its sweet spot and value props.
- Why it doesn't fit *this specific* feature.
- The cost differential with citations.
- A note on when it might be reconsidered later.

This section establishes that you actually evaluated alternatives, not that you defaulted to the familiar.

### 15. Architecture diagram — required

A full-system mermaid diagram showing every actor in the feature's blast radius. Follow the project mermaid style guide (see "Diagrams" below). Place this after data and transport are defined so the diagram has context to lean on.

### 16. End-to-end happy path — required

A **story-style narrative** walking through the canonical user flow, step by step (numbered), with concrete made-up data — sample tool args, sample DB rows, sample image filenames. Aim for at least 10 numbered steps. The story should make the win obvious.

This is the most important section for stakeholder review. Reviewers absorb the value proposition through the story, not through the phase list. Do not skip it; do not collapse it to bullet points.

### 17. Implementation phases — required

A numbered phase list. Each phase must be:

- **Independently shippable** — no broken intermediate states.
- **Independently testable** — mention what tests are added.
- **Tied to specific files** — markdown links to every file touched.

A typical feature has 6–12 phases. Foundation primitives first (types, DB, transport), then backend logic, then UI surfaces, then sharing/moderation/migrations. If a phase isn't independently shippable, re-cut it.

### 18. Risks & open questions — required

Numbered. Each risk has:

- The risk in one sentence.
- Mitigation in v1.
- Escalation path for v2 if the v1 mitigation isn't enough.

Confront real risks here. If a risk is invisible to the reader, the document is hiding something the reviewer will eventually find.

### 19. Out of scope (parking lot) — required

Bullet list of things readers might assume are included but aren't. Each line is one feature with a one-sentence rationale for deferral.

### 20. Implementation todo checklist — required

A markdown task list that mirrors the phases. Each task is one phase's deliverable, ready to be checked off during execution. Include the phase ID prefix (e.g. `phase4-extract-tool`) so it's referencable from PR titles and commits.

### 21. References — required when external sources are cited

Bullet list of every URL referenced in the document. Group by domain (vendor docs, arXiv, internal Lixpi docs, GitHub repos).

## Research methodology

Before drafting anything, do the research that earns the document.

### Read the project context first

Always read in this order:

1. `AGENTS.md` (workspace rules — these supersede other guidance).
2. `documentation/PRODUCT-OVERVIEW.md` (the architecture you're building inside).
3. Any `documentation/knowledge/*.md` files relevant to the feature area.
4. The folder-level `README.md` files in the directories you'll be modifying.

If you skip this step you will misuse a primitive that already exists. That mistake is hard to recover from once it's baked into a plan.

### Parallel codebase exploration

When the feature touches multiple areas of the codebase, spawn parallel exploration in a single tool-call batch. Use the Cursor `Task` tool with `subagent_type: "explore"` and `readonly: true`. Each subagent gets one focused area, for example:

- "Find the current handler for X and trace its call chain end-to-end, citing files and line ranges."
- "Map the LangGraph workflow + every registered tool + the streaming pipeline."
- "List the DynamoDB tables, the data access layer, and the existing scope/ACL patterns."
- "Find the prior-art ProseMirror plugin in the deprecated dumpster, if any."

Run these *in parallel* in one message — never sequentially. Each subagent's output becomes input to your next decision.

### Parallel web research

For external prior art, frameworks, and academic papers, run `WebSearch` calls in the same parallel batch as the explorations. Useful query patterns:

- Comparison: "X vs Y when to use each <year>"
- Vendor docs: "<product> custom <feature> documentation <year>"
- Academic prior art: "<problem> <approach> <year>"

Follow up with `WebFetch` on the highest-value URLs the search returned (vendor docs, primary papers).

### Read existing patterns deeply

Before designing anything new, find the existing pattern in the codebase:

- New DB table → look at how an existing similar table is defined.
- New NATS subject → look at how an adjacent subject group is structured and handled.
- New ProseMirror plugin → look at the existing plugin family (`services/web-ui/src/components/proseMirror/plugins/`) including their READMEs.
- New LangGraph tool → look at how `services/api/src/llm/tools/image-generation.ts` is structured and registered across all three providers.
- New canvas overlay → look at the existing AI chat floating panel rendering pattern in `services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts`.

Mirror the existing pattern unless you have a concrete reason to diverge. State that reason in the plan when you do.

### Cite specifically

Every reference to existing code in the plan uses a markdown link:

```
[`services/api/src/llm/tools/image-generation.ts`](services/api/src/llm/tools/image-generation.ts)
```

Include line ranges or function names where possible. Vague references slow reviewers and force re-exploration.

## Iterating with the user

### Switch to Plan mode

When you receive a planning request, switch to Plan mode immediately. Plan mode is read-only and surfaces the proper review tools (`CreatePlan`).

### Ask narrow, multi-choice questions

When the user's brief leaves architectural axes unspecified, ask the user — but ask well:

- 1–4 questions per round, no more.
- Each question is multiple-choice. Each option carries a concrete trade-off in its label, not just a name.
- Bake your strong recommendation into one option's label as `(Recommended.)` with a one-sentence rationale.
- Always include a "Pick for me — I trust your call" option.
- After the user answers, summarize what's locked and ask the next round.

When you have strong confidence in an answer, do **not** ask — bake the recommendation into the plan and call it out as "decided based on X". Asking too many questions is a failure mode; asking the wrong questions is worse.

### Avoid the architecture-checklist trap

The most common failure mode for a planning agent is jumping straight from clarification answers to "Phase 1: types." That produces a checklist disguised as a plan and skips the *why*. Always write the problem statement, principles, concept, and happy path **before** the implementation phases — even if the phases are clearer in your head. Reviewers need the prose to evaluate the technical decisions.

A plan whose first section is "Phase 1" is rejected on the spot. Re-draft from the top.

## Diagrams

All mermaid diagrams in plans follow `documentation/documentation-style-guides/MERMAID-DIAGRAMS-STYLE-GUIDE.md`. Read it. The non-negotiables:

- Always include the project's "In the Sunshine" theme initialization line at the top of every diagram.
- Use `graph` (or `sequenceDiagram` / `stateDiagram-v2`) — not `flowchart`.
- For START/END nodes use `Start([START])` and `Finish([END])` — never `((START))` and never the reserved `end` ID.
- Use `subgraph "Quoted Display Name"` for labeled subgraphs.
- Sequence diagrams require `activate`/`deactivate` pairs and `rect rgb(...)` phase blocks with `Note over First, Last:` full-width titles.

Every plan should include at least:

- One full-system architecture diagram (the architecture-changes section).
- One per-subsystem diagram if the backend graph or workflow is non-trivial.

Diagrams without the project theme render off-brand and signal carelessness — fix them before the plan ships.

## After the plan is drafted

### Local file

Write to `documentation/memory/<NAME>.md`. Confirm with the user that the local copy is good before pushing to GitHub.

### GitHub issue

Once the user approves, create or update the GitHub issue with the same body:

```bash
# new
gh issue create --title "<Title>" --body-file documentation/memory/<NAME>.md --assignee @me

# existing
gh issue edit <number> --repo <owner>/<repo> --body-file documentation/memory/<NAME>.md
```

Both must always be in sync. If you edit the file, push the issue update. If you edit the issue (rare — usually the file leads), pull the changes back into the file.

For branch and commit naming when implementation begins, follow `documentation/development-workflow/GITHUB-WORKFLOW.md`.

### Cleanup

Do **not** delete artifacts (temp files, plan files, intermediate work) until the user explicitly approves. Asking is cheap; premature deletion is hostile and breaks reviewer trust.

## Anti-patterns

These are real failure modes from past planning sessions. Avoid:

- **Opening with "Phase 1: types".** The reader has no idea what or why. Always write WHAT/WHY before HOW.
- **Skipping the alternative evaluation.** If the user asked you to consider X vs Y — even casually — write the comparison. Never silently default.
- **Citing files without context.** A bare path like `services/api/src/...` doesn't help; a markdown link with a line range and a one-line description does.
- **Burying the happy path.** Reviewers learn from the story. If the only narrative is the phase list, the lede is buried.
- **Asking 5+ questions in one round.** Decision fatigue. 1–2 critical multi-choice questions per round, each with strong recommendations baked in.
- **Proactively deleting artifacts before the user confirms the plan.** This breaks reviewer trust. Wait.
- **Mermaid diagrams without the project theme.** Off-brand rendering. Fix them.
- **Phases that aren't independently shippable.** "Phase 4: half the graph nodes" is not shippable. Re-cut the phases until each one is.
- **Out-of-scope sections that hide controversial choices.** If a deferral is contentious, surface it in *Risks*, not in *Out of scope*.
- **Vague risks.** "Performance might be a concern" is not a risk; "every send with N feature chips means N feature fetches + 0..3N sample fetches" is. Be concrete or cut the risk.

## End-to-end checklist

When you start a new planning task, work through this list in order:

- [ ] Read `AGENTS.md` and `.cursor/rules/` (or equivalent) for always-applied workspace rules.
- [ ] Read `documentation/PRODUCT-OVERVIEW.md` and any `documentation/knowledge/*.md` files relevant to the area.
- [ ] Switch to Plan mode.
- [ ] Spawn parallel `Task` exploration subagents (typically 3–4) in a single message, plus parallel `WebSearch` / `WebFetch` calls in the same message.
- [ ] Identify the architectural axes the user's brief leaves open.
- [ ] Ask 1–4 multi-choice clarification questions per round, with concrete trade-offs and a "Pick for me" option. Iterate rounds until every axis is locked.
- [ ] Read existing patterns deeply for every primitive you'll add (DB table, NATS subject, ProseMirror plugin, LangGraph tool, etc.).
- [ ] Draft the document following the mandatory structure above.
- [ ] Add at least one full-system mermaid diagram following the project style guide.
- [ ] Include the end-to-end happy-path narrative.
- [ ] Save to `documentation/memory/<NAME>.md`.
- [ ] Get user approval on the local copy.
- [ ] Create or update the matching GitHub issue with the same body.
- [ ] Wait for the user to confirm before deleting any temp/intermediate artifacts.

If you ship a plan that misses any of these steps, treat that as a failure mode and add it to your next pre-flight check.
