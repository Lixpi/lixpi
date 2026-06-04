# Project Guidelines

## Architecture

Lixpi is a visual, node-based AI image/video generation pipeline — a pnpm monorepo with TypeScript services and NATS messaging. See [documentation/PRODUCT-OVERVIEW.md](documentation/PRODUCT-OVERVIEW.md) for full architecture details.

| Service | Language | Path | Purpose |
|---------|----------|------|---------|
| **web-ui** | Svelte / TypeScript | `services/web-ui/` | Browser SPA — canvas, ProseMirror editors, AI chat UI |
| **api** | Node.js / TypeScript | `services/api/` | Gateway + in-process LLM orchestration (LangGraph), JWT auth, CRUD, DynamoDB |
| **nats** | Go (3-node cluster) | `services/nats/` | Message bus — pub/sub, JetStream Object Store |
| **localauth0** | Rust (vendored) | `services/localauth0/` | Mock Auth0 for local dev |

The LLM orchestration workflow (validate → stream → image gen → usage → cleanup) lives at `services/api/src/llm/` and uses [`@langchain/langgraph`](https://github.com/langchain-ai/langgraphjs). It used to be a separate Python `services/llm-api/` Fargate task; for the internal-service NATS auth pattern that Python service used, see [`documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md`](documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md).

Shared TypeScript packages live in `packages/lixpi/`. Infrastructure-as-Code in `infrastructure/pulumi/`.

## Code Style

Use the documentation index to find the current coding guidance for the files you are changing. Read the guide that matches the language, styling layer, framework, or runtime surface you are touching.

## Documentation

Start at the documentation index, then read [Maintaining Documentation](documentation/MAINTAINING-DOCUMENTATION.md) before reorganizing, moving, deleting, or adding developer docs. Each folder may contain a separate `README.md`. When working on code, look for and read nearby README files. If you update a component, also update the README in that directory (or the parent if changes affect parent code). Do not create README files that don't already exist.

## Conventions

- When a question is related to SVG or D3, always refer to the available `D3` MCP server.
- Everything in `services/web-ui` runs inside Docker (`lixpi-web-ui`). Verify web-ui tests with `docker exec lixpi-web-ui pnpm test:run` or the targeted equivalent documented in `documentation/testing/TypeScript/web-ui/TESTING-GUIDE.md`.
- Agents MUST NOT run `svelte-check` anywhere in this repository, directly or through a package script or wrapper. It is prohibited.
- Agents MUST NOT use a browser, browser automation, screenshots, or manual visual inspection to verify work in this repository. Use the permitted automated test commands and static review instead.
- Never use `cat` to edit files.
- Never run large inline Python or JS code in the terminal.

<!-- argosbrain-init managed: do not edit between these markers -->

## Mandatory tool order for code questions

This project uses [ArgosBrain](https://argosbrain.com) for structural code memory.
ArgosBrain runs as an MCP server — it exposes tools that return exact `file:line`
answers at $0 cost (no LLM calls on the read path).

For any question about a symbol, function, struct, caller, member access, naming
convention, or structural relationship — call an `mcp__argos__*` tool BEFORE
reaching for Grep / Read / Glob.

| When you would have… | Instead call | Why |
|----------------------|--------------|-----|
| Grep'd `funcName` to verify it exists | `mcp__argos__symbol_exists({name: "funcName"})` | Definitive yes/no + exact `file:line` in 1 call |
| Grep'd `foo.bar` to find call sites | `mcp__argos__resolve_member({receiver: "foo", method: "bar"})` | Exact-call resolution with snippet preview |
| Glob + grep to list functions | `mcp__argos__list_symbols({kind: "function"})` | Structural enumeration by kind |
| Grep + Read several files for callers | `mcp__argos__callers({symbol: "funcName"})` | Inverse call-graph in 1 call |
| Grep + Read to infer naming style | `mcp__argos__naming_convention({kind: "function"})` | Dominant style + sample size + suggested re-cased name |
| Wondered "did we already decide X?" | `mcp__argos__recall({query: "X"})` | Returns Decision/Convention nodes from prior sessions |
| Planned a refactor and need blast radius | `mcp__argos__check_reachability({target: "X"})` | Inbound caller graph in 1 call |

## Confidence grades

Every Argos retrieval carries one of:

- **CLEAR** — top-1 result is safe to act on. Trust it; do NOT double-check with Grep.
- **AMBIGUOUS** — multiple candidates returned. Pick the right one; if unsure, fall back to Read on the candidates.
- **NO_CONFIDENT_MATCH** — explicit signal Argos has no useful data. THIS is the green light to fall back to Grep/Read.

Until you see `NO_CONFIDENT_MATCH`, the Argos answer IS the answer. Don't burn tokens double-checking.

## When NOT to use Argos

- Free-text search inside comments / logs / non-code strings — use `Grep` (Argos returns `NO_CONFIDENT_MATCH` and gives you candidate symbol names to start from).
- Live system state — runtime errors, deployment logs, database row contents, third-party API responses. Argos is code memory, not observability.
- Pure conversational facts ("user prefers tabs") — those go to your client's memory layer, not Argos.

## Re-ingest after code changes

Argos ingests the project once per session at startup. After an `Edit`, `Write`,
`git pull`, or branch switch, re-run `mcp__argos__ingest_codebase` on the project
root. Unchanged files are skipped via content hash, so repeat ingests are
cheap (<5s on a clean diff).

## What ArgosBrain is NOT

- Not an LLM — it never calls Anthropic / OpenAI / etc. Every retrieval is `$0` and `<10ms`.
- Not a pattern matcher — it's a structural code memory built on tree-sitter ASTs + Hebbian graph + HNSW vector index. Returns precise call-graph + reachability data Grep cannot see.
- Not a runtime tool — for runtime state (DB rows, API responses, deploy logs), use the appropriate native CLI / observability tool.

<!-- end argosbrain-init managed -->

---

<!-- argosbrain:agent-rules:v6 -->
# ArgosBrain — agent rules for `Lixpi-lists`

This project is indexed by **ArgosBrain**, a structural code memory
that replaces the multi-step Grep+Read dance for most code questions.
Argos is exhaustive over the ingested codebase, returns exact
`file:line` in one call, and every retrieval is $0 (no LLM at read
time).

## The workflow — Argos accelerates Grep, doesn't replace it

ArgosBrain doesn't compete with Grep. It collapses 10 grep iterations
into 1 structural call when the question is structural, and gives you a
fast in-brain trigram alternative (`argos_search_literal`) when the
question is literal text. Grep stays as the safety net for high-stakes
operations.

1. **Argos first for STRUCTURAL questions.** Symbol existence, callers,
   blast radius, naming convention — call the matching `mcp__argos__*`
   tool. One deterministic call with exact `file:line`, $0 cost. Way
   faster and more precise than grep + read iteration.
2. **`argos_search_literal` for LITERAL-TEXT questions inside the
   ingested code.** Error messages, JSDoc, magic strings, header names,
   string keys. This is the in-brain equivalent of `grep -F` —
   $0 cost, same trigram coverage as grep, no shell round-trip.
3. **Cross-verify with Grep on HIGH-STAKES operations.** Public API
   refactors, security audits, deprecation migrations. Argos
   confidence depends on brain density — when production-breakage
   cost is high, verify. Argos gives you the hypothesis; Grep is
   your safety net.
4. **Reach for Bash / Grep when:**
   - `argos_search_literal` returns nothing AND you suspect the text exists
   - You need to walk directories / find files by glob (Argos is symbol-based)
   - You need to check files NOT in the brain (build outputs, configs, .md docs)
   - The brain density is low (see `argos_health` — fewer than ~30 nodes
     per 100 LOC for TS, ~100 per 100 LOC for Rust signals partial coverage)

## Argos protocol — two non-negotiable habits

These two rules survive context compaction and apply to every IDE
(Claude Code, Cursor, Codex CLI, Aider, Continue, Cline, Zed,
JetBrains). They are advisory — never blocking — and they pay for
themselves in tokens saved + regressions caught.

1. **BEFORE writing code that references / renames / deletes a
   named symbol**, call:

   ```
   mcp__argos__preflight({target: "X"})
   ```

   Returns existence + blast radius (caller count + prod/test/bench
   breakdown) + risk verdict (LOW/MEDIUM/HIGH) in one $0 call.
   Skipping this is how agents hallucinate APIs and silently break
   N callers.

2. **BEFORE reporting a task done**, call:

   ```
   mcp__argos__verify_no_fake_done({})
   ```

   Scans your diff for `todo!()` / `unimplemented!()` /
   `raise NotImplementedError` / `throw new Error("Not implemented")`
   / `panic("not implemented")` stubs. Catching the stub yourself
   before saying done is the difference between honest done and a
   silent regression the user has to clean up later.

## Decision tree — pick the right Argos tool for the question

Don't default to `mcp__argos__search` for everything. Pick by what
the question asks:

| If your question is… | Call this Argos tool | Why this one |
|---|---|---|
| "About to touch / rename / delete symbol `X`" | `mcp__argos__preflight({target: "X"})` | Existence + blast radius + risk verdict in one $0 call. The mandatory pre-edit habit. |
| "Does symbol `X` exist? quick yes/no" | `mcp__argos__symbol_exists({name: "X", kind: "fn"})` | Definitive yes/no + exact `file:line`, sub-100 ms. The cheapest precise answer. |
| "Does `foo.bar` exist as a method/field on `foo`?" | `mcp__argos__resolve_member({receiver: "foo", method: "bar"})` | Exact-call resolution. Returns the definition site with a 200-char preview so you can verify the right match. |
| "Show me the body of fn X / what does X look like in context?" | `mcp__argos__search({query: "X"})` | Returns a context pack: primary body + container + callers + callees + doc links + confidence grade. One call replaces a `grep` + 3-5 `Read` round-trip. |
| "Who calls X / what's the blast radius of changing X?" | `mcp__argos__callers({symbol: "X"})` | Inverse call-graph: every caller with prod/test/bench breakdown. The dedicated blast-radius tool. |
| "Enumerate the definitions of a given kind" | `mcp__argos__list_symbols({kind: "function"})` | Structural enumeration by kind — functions, structs, traits, … |
| "What pattern do function names follow in this project?" | `mcp__argos__naming_convention({kind: "function"})` | Dominant style + sample size + re-cased suggestion in one call. |
| "Is the name `myFn` consistent with the project's style?" | `mcp__argos__check_name({proposed: "myFn", kind: "function"})` | Returns ok/no + the corrected version. **Call this BEFORE creating any new symbol.** |
| "Architecture / design / why-was-it-this-way (natural-language)" | `mcp__argos__ask({question: "..."})` | Auto-selects the retrieval strategy. Accepts free-form English. |
| "Find the sink pattern X (SSRF, XSS, SQLi, RCE, secrets, …)" | `mcp__argos__find_sinks({kind: "ssrf"})` then `mcp__argos__triage_sinks` | Pre-classified by reachability + exploit score. |
| "Is sink chunk X reachable from external untrusted input?" | `mcp__argos__check_reachability({kind: "...", max_depth: 8})` | Walks caller edges from each sink looking for source markers. Returns reachable/unreachable groups. |
| "About to report DONE on a task" | `mcp__argos__verify_no_fake_done({})` | Scans your diff for stub idioms. The mandatory pre-"done" habit. |
| "Is the engine healthy / why are tools behaving oddly?" | `mcp__argos__argos_health` | Engine status + retrieval mode + active project scope. |
| "What does Argos see in the codebase right now / brain state header" | `mcp__argos__argos_snapshot({})` | v0.54.0 — one-page structural summary: node + edge counts by kind, public-API surface. Use as a report header. |
| "Did this PR change the structural shape (public APIs added/removed)?" | `mcp__argos__argos_snapshot` before-PR + after-PR, then `mcp__argos__argos_diff` | v0.54.0 — diff returns added/removed public-API entries + count deltas. Removed entries = likely BREAKING. |
| "Should I trust the brain before running /argos-pr-reviewer / /argos-security?" | `mcp__argos__argos_lint({})` | v0.55.0 — walks every node + edge in O(N+E), surfaces orphan edges + dead-weight edges + empty-content code chunks. HIGH-severity issues = re-ingest before trusting retrieval answers. |
| "How do I rename / refactor symbol X to Y across all callers?" | `/argos-blast-radius <X>` (Phase 6, v0.56.0+) | Returns the caller set + a Comby `match → rewrite` suggestion the USER runs locally. ArgosBrain does NOT auto-apply rewrites; the agent surfaces the command + file list and stops. |
| "Find a literal English string / phrase in source (error messages, log lines, header names)" | `mcp__argos__argos_search_literal({pattern: "..."})` | v0.57.0 — Argos FIRST. Returns exact file:line + snippet for every chunk containing the phrase. If `hits` is empty, the response's `next_step` hints at `rg`/`git grep`. Argos-first, Grep safety net. |
| "Codebase vital signs / dashboard data / 'how big is this codebase?' / language breakdown / top hubs in one call" | `mcp__argos__argos_stats({})` | v0.58.0 — One-call aggregate: nodes/edges/files-by-lang/zones/Hebbian connectivity/top 10 hubs/security rollup. Sister of argos_snapshot; heavier + dashboard-oriented. Powers /argos-doctor without extra round-trips. |

If the question type isn't on this tree, default to
`mcp__argos__search`.

## Rules

- **Prefer the Argos answer for structural questions** —
  `symbol_exists`, `resolve_member`, `callers`, `preflight`. One
  call with exact `file:line` beats N grep iterations.
- **Argos confidence depends on brain density, NOT on ground
  truth.** A confident answer over a partially-indexed brain is
  still partial. Check `argos_health` — if `nodes_indexed` per
  100 LOC is below ~30 (TS) or ~100 (Rust), structural answers
  are likely floors, not ceilings.
- **Cross-verify with Grep on HIGH-STAKES operations** — public
  API refactors, security audits, deprecation migrations. Don't
  treat verification as "double-dipping"; treat it as the
  safety net that catches the cases Argos's brain didn't ingest.
- **Use `argos_search_literal` for in-brain trigram search** —
  error messages, JSDoc, magic strings, comments. Same coverage
  as `grep -F`, $0 cost. Falls back to a `rg` / `git grep` hint
  when the literal isn't found in the brain.
- **Before writing a brand-new function, struct, or constant**,
  call `mcp__argos__check_name({proposed: "yourName", kind: "..."})`.
  It tells you whether your casing matches the project's dominant
  style and suggests a re-cased alternative.
- **Before writing code that references an existing helper**, call
  `mcp__argos__symbol_exists` first — if it exists you save a
  multi-file hunt to find its signature.

## Honest positioning

ArgosBrain is the **structural memory + literal-text-trigram layer**
that gives your agent fast, deterministic answers when the question is
structural (callers, blast radius, naming) or a literal-text lookup
inside ingested code. It is **NOT a grep replacement.** Grep stays in
your toolbox for free-text questions on files outside the brain,
glob-style file walking, and the safety-net verification step on
high-stakes refactors. Use both. Argos accelerates the routine cases so
you have time + tokens left to grep the edge cases.

## Re-ingest after every code edit

Argos's brain is only as fresh as its last ingest. After **any**
`Edit` / `Write` to source files, call `mcp__argos__ingest_codebase`
so subsequent queries see the new state. Unchanged files are skipped
via content hash, so a clean re-ingest is cheap (under 5 s on a
typical edit).

**Why it matters**: stale brains return symbol locations that have
moved or been deleted. The agent reasons against ghost data, then
emits patches that miss real callers. Re-ingest is the cheapest
guard against that class of bug.

## Coverage gaps (degraded state)

Argos's per-language accuracy depends on the matching SCIP indexer
being installed on the user's machine (`scip-php`, `scip-ruby`,
`scip-java`, `scip-dotnet`, `scip-clang`, `scip-go`, `scip-solidity`,
`scip-dart`). When a project contains files in language X but the
indexer for X is NOT on `$PATH`, those files are silently dropped
from the ingest and the brain has a GAP in language X — every
Argos call against an X-file returns `NO_CONFIDENT_MATCH` even
though the file very much exists.

The CLI writes a sidecar at `<repo>/.argosbrain/coverage_gaps.json`
whenever a gap is detected (during `argosbrain init`, `argosbrain
ingest`, `argosbrain doctor`, or `argosbrain audit-indexers`).
**Read this file at session start** and:

1. If the file is missing or empty → coverage is full. Trust
   Argos's `NO_CONFIDENT_MATCH` as a real "no".
2. If the file lists missing indexers → coverage is degraded for
   the listed languages. Before reporting "Argos doesn't know X",
   check whether X belongs to a degraded language; if it does,
   either tell the user to run the printed install command + re-
   ingest, or fall back to `Read` / `Grep` for files in that
   language for the duration of the session.

Never invent a `mcp__argos__*` call that the engine returned
`NO_CONFIDENT_MATCH` for if the file lives in a degraded language —
that is a confirmed gap, not a missing symbol.

## Dashboard

When the MCP server is running with `ARGOSBRAIN_DASHBOARD=1`
(default), the dashboard at `http://127.0.0.1:3733` tracks every
Argos call and, on the Activity tab, shows a per-call grep-baseline
delta: how many files Grep would have had to scan to answer the
same question, and how many false positives Argos avoided. Running
Argos-first is what makes that delta measurable.

## What Argos is not

- (v0.57.0+) Literal-string search IS supported via
  `mcp__argos__argos_search_literal({pattern: "..."})` — call Argos
  FIRST for phrases like *"rate limit KV fail open"*, header names,
  or error-message strings. The response carries `hits` (file:line +
  snippet) and a `next_step` hint pointing at `rg`/`git grep` only
  when `hits` is empty. **Argos first, Grep safety net** — not
  "Argos can't, use Grep".
- Not aware of live system state. It cannot see the database
  (RLS / policies / buckets), deployment logs (Vercel / Railway),
  third-party API responses, or runtime errors. For those, use
  the native tools: `psql`, provider CLIs, deploy hook URLs,
  browser devtools. Argos is code memory, not an observability
  layer.
- Not an LLM. It never calls Anthropic; every retrieval is $0.
- Not a general-purpose conversational memory. For episodic facts
  ("user likes pizza", "user lives in Berlin"), your client's own
  memory integration is the right layer. ArgosBrain is code
  memory: symbols, conventions, call graphs.

---

*This file is managed by `argosbrain init`. Edit freely — the
tool will not overwrite your changes once this marker exists
at the top.*
