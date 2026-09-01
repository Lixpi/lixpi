---
title: Writing and Running Implementation Plans
description: How to create and maintain one durable implementation plan from design through verified completion.
---

# Writing and Running Implementation Plans

An implementation plan is the durable memory for a piece of work. It lives in `documentation/memory/<NAME>.md`, explains the intended result, records the decisions that shape it, and stays accurate while the work is implemented. A fresh agent must be able to read that file, inspect the working tree, and continue without relying on the conversation that created it.

The plan is not a frozen proposal, a chronological work diary, or a copy of repository-wide instructions. It contains the task-specific state. It links to stable project guidance instead of repeating it.

## Use a plan when the work needs durable state

Create a plan when at least one of these is true:

- The work spans several meaningful steps or more than one subsystem.
- The work can continue across context compaction, separate sessions, or different agents.
- The implementation depends on decisions that need review and durable rationale.
- A wrong assumption would create substantial rework or an unsafe change.
- The user asks for an implementation plan, design document, RFC, feature specification, or detailed ticket.
- An approved spike report is moving into implementation.

Do not create a plan for a small, direct change that can be understood and completed in one pass unless the user asks for one.

When feasibility, vendor behavior, product direction, or another material unknown needs investigation first, follow [Spike Report Guidelines](SPIKE-REPORT-GUIDELINES.md). If that spike leads to implementation, keep using the same memory file. Do not create a second document.

## Project rules stay linked, not copied

Read the rules that apply to the work before drafting or implementing the plan. The main entry points are [Agent Skill Organization](../AGENT-SKILLS.md), [Testing Guide Selection](../../testing/USING-TESTING-GUIDES.md), [Coding Style Guide Selection](../../coding-style-guides/USING-CODING-STYLE-GUIDES.md), and [Maintaining Documentation](../../MAINTAINING-DOCUMENTATION.md).

Do not paste those rules into a plan. Record only their task-specific effect, such as a required container, a forbidden verification method, or a coding guide selected for the affected files. Stable policy belongs in its canonical guide.

The same rule applies outside `documentation/memory`. Skills, tickets, issues, and other guides must link to this page instead of copying its procedure. If an external tracker needs the plan, link to the repository file unless the user explicitly requires a synchronized copy.

## Create the memory file before the work spreads out

1. Read the user's request, the applicable repository instructions, and any existing memory file for the same work.
2. Inspect enough of the live system to identify the outcome, the affected boundaries, and the decisions that cannot be derived from the repository.
3. Ask the user about any unresolved choice that would materially change the result, scope, compatibility contract, risk, or implementation direction.
4. Create `documentation/memory/<NAME>.md` as soon as the task has a stable identity. Use an uppercase, dash-separated name that describes the work.
5. Fill the file while researching and planning. Do not keep the real plan in chat and write the file only after the thinking is finished.
6. Keep that file for the rest of the work. Revise it during implementation and after every discovery that changes what the file says.

Planning does not authorize implementation. Keep product changes out of the planning pass unless the user asked for planning and implementation together. When the plan is decision-complete but implementation is not authorized, set its state to `Ready for implementation` and stop there.

## Research the live system before choosing the design

Use the source and evidence rules in [Spike Report Guidelines](SPIKE-REPORT-GUIDELINES.md) when the plan depends on external claims, measurements, or uncertain facts. For repository work:

1. Read the product and domain documentation that defines the affected behavior.
2. Read nearby package or service READMEs and the selected coding and testing guides.
3. Trace the existing behavior through its real entry points, data contracts, owners, persistence, side effects, and consumers.
4. Inspect an existing pattern that solves the closest comparable problem. Record why the plan follows or departs from it.
5. Check every path and symbol named in the plan against the working tree. Describe its role instead of pasting a file inventory.
6. Separate facts the repository establishes from choices that need the user. Do not ask the user for information the repository can answer.
7. Put the resulting context and decisions into the memory file as they become clear.

## Every plan needs the same core information

Use the following sections. Add technical sections only when the work needs them. Do not add empty headings, `n/a` placeholders, forced diagrams, fake principles, generic risks, or a second summary of content already stated elsewhere.

### Work status tells the next agent where to resume

Keep `Work status` directly below the title. It is the only short status view in the file.

Record:

- `State`: `Planning`, `Ready for implementation`, `Implementing`, `Blocked`, or `Complete`.
- `Active step`: the implementation step being worked on, or `None`.
- `Completed`: the step numbers that are verified complete.
- `Next`: one concrete action that can be started without reconstructing prior context.
- `Blocked by`: an unresolved user decision, external dependency, failure, or `Nothing`.

Refer to numbered steps instead of repeating their full contents. Update this section before any pause, handoff, or likely context compaction.

### Outcome defines what must become true

Explain the problem, why the work matters, and the observable result. State the confirmed scope and acceptance conditions. Include non-goals only when the user has explicitly excluded something that a reasonable reader might otherwise expect.

Write about behavior before implementation detail. A code refactor still needs an observable result, such as an import boundary that can be checked, a package that can run independently, or a failure that no longer occurs.

### Context and constraints orient a fresh reader

Describe the parts of the system that matter to this task and how they fit together. Define local terms. Link to the relevant files, symbols, schemas, infrastructure, documentation, vendor contracts, or research evidence.

Keep this section about stable concerns, not a dump of every file found during exploration. Record a path when it helps the next person navigate or prevents a likely implementation mistake.

### Decisions state the selected design and its rationale

Record each material decision under a stable identifier such as `D1`. For each decision, state:

- What was decided.
- Why it fits the confirmed requirements and constraints.
- Which serious alternatives were considered and why they were rejected.
- What would invalidate the decision.

Keep the current decision in this section. If evidence forces a change, rewrite the decision and every affected section so the whole document agrees. Add one short note under the decision explaining what changed and why. Do not leave the old design in the main narrative and append a correction elsewhere.

### Implementation plan gives the exact order of work

Break the work into numbered steps that lead to verifiable outcomes. Each step must contain enough detail for a fresh agent to implement it without making an unapproved design choice.

For each step, include:

- `Status`: `Pending`, `In progress`, `Blocked`, or `Done`.
- The result that will exist when the step is complete.
- The behavior, interfaces, data, or documents that must change.
- The important paths or symbols, when naming them prevents ambiguity.
- Dependencies on earlier steps and any safe ordering or recovery requirement.
- How completion will be proved under the repository's active verification rules.
- `Result`, added during implementation, with concise evidence and any remaining gap.

Steps are implementation slices, not calendar phases or promises about future versions. Do not defer requested behavior, invent compatibility work, cut scope, or choose a missing dependency workaround without the user's decision.

Keep details proportional to risk. A plan for a small internal refactor may need a few precise steps. A cross-service change may need contracts, data flow, failure handling, migrations, rollout behavior, and recovery instructions. Add those details where they affect the relevant decision or step instead of forcing the same template onto every task.

### Verification says how the result will be proved

List the acceptance scenarios and the evidence that will prove them. Use observable inputs and outputs where possible. Include failure cases when they define important behavior.

Follow [Testing Guide Selection](../../testing/USING-TESTING-GUIDES.md) when deciding what an agent may write or run. Do not invent commands, claim checks were run, or treat static inspection as runtime proof. If the permitted checks cannot prove an acceptance condition, state the verification gap.

### References contain only sources the plan depends on

Link external sources, project documents, and repository locations that support a decision or factual claim. Put links next to the claims they support when that is clearer. Do not turn this section into an inventory of everything read.

## Add technical detail where the task needs it

The core sections do not prevent detailed design. Put the detail under headings that name the actual concern, such as:

- User flow and failure behavior.
- API, event, or command contracts.
- Data model and persistence.
- Ownership and dependency direction.
- Authentication, authorization, privacy, and threat handling.
- Concurrency, retries, idempotence, and recovery.
- Performance, capacity, cost, and operational limits.
- Migration, rollout, rollback, and compatibility.
- Documentation and developer workflow changes.

Use TypeScript definitions, payload examples, tables, or diagrams when they make the contract easier to review. Diagrams are optional. When a Mermaid diagram helps, follow the [Mermaid Diagram Style Guide](../../documentation-style-guides/MERMAID-DIAGRAMS-STYLE-GUIDE.md).

## Keep the plan coherent while implementing it

At the start of every implementation session:

1. Read the entire memory file.
2. Inspect the working tree and the relevant live files. Do not trust status text that the repository contradicts.
3. Reconcile the plan with the implementation. Fix stale statements before starting more work.
4. Start from `Next` and the first step that is not done or blocked.

While implementing:

1. Mark a step `In progress` before changing it.
2. Update the relevant context, decision, contract, and step as soon as a discovery changes them.
3. Put implementation evidence in that step's `Result`. Keep raw terminal output and exploratory notes out unless a short excerpt proves something important.
4. Mark a step `Done` only after its stated proof is complete. If part remains, keep the step in progress and state the remaining work.
5. Update `Work status` after each completed step and before any pause.

A discovery is not handled by adding it to the bottom of the file. First correct every affected claim and instruction. Preserve a short history only when it explains a material decision or prevents the same mistake from being repeated.

Before a pause, handoff, or context compaction, make the file resume-ready:

1. Update `Work status` with the exact active step, next action, and blocker.
2. Update each touched step's status and result.
3. Incorporate discoveries into the sections they changed.
4. Record unverified work and failed checks without presenting them as complete.
5. Remove stale alternatives, duplicate explanations, and scratch notes that no longer help the next agent.

## Finish the plan against the outcome

Set the plan to `Complete` only when every acceptance condition has evidence and no requested work remains. Replace planned behavior with the actual result where implementation refined the design. Keep unresolved gaps visible.

Do not delete, archive, or copy the memory file to an external system unless the user asks. When cleanup is approved, update inbound links before moving or removing the file.

## Starting template

```markdown
# <Concrete outcome>

## Work status

- State: Planning
- Active step: None
- Completed: None
- Next: <One concrete action>
- Blocked by: Nothing

## Outcome

<What must become true, why it matters, and how success will be recognized.>

## Context and constraints

<The task-specific system context, confirmed requirements, and constraints.>

## Decisions

### D1. <Decision name>

Decision: <The selected direction.>

Rationale: <Why this direction fits.>

Alternatives: <Serious alternatives and why they were rejected.>

Revisit when: <Evidence or requirement that would invalidate the decision.>

## Implementation plan

### 1. <Verifiable result>

Status: Pending

Work: <Behavior, contracts, paths, dependencies, and safe order.>

Proof: <Permitted verification and expected result.>

Result: Not started.

## Verification

<Acceptance scenarios, required evidence, and known verification gaps.>

## References

- <Only sources used by the plan.>
```

## Why this format works for agents

OpenAI's [ExecPlan guidance](https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md) treats an execution plan as a self-contained living document that must remain usable after prior conversation is gone. Anthropic's work on [context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) and [long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) shows why structured file-based memory and explicit handoff state matter across compaction and fresh sessions.

This format keeps those properties without copying repository policy or forcing every task through a large RFC template. It also keeps requirement, design, work, and verification concerns distinct enough to check for contradictions, following the consistency principle used by GitHub's [Spec Kit](https://github.com/github/spec-kit/blob/main/docs/reference/agentic-sdd.md).
