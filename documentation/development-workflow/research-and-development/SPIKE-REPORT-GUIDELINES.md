---
title: Spike Report Guidelines
description: How to investigate an uncertain question and maintain one evidence-backed report that can continue into implementation.
---

# Spike Report Guidelines

A spike report is the durable memory for an investigation. It lives in `documentation/memory/<NAME>.md` and answers a decision-driving question with evidence. A spike may study code, architecture, product behavior, infrastructure, operations, security, data, vendors, standards, cost, feasibility, or another technical subject. It does not need to produce code.

The report changes as the investigation changes. A fresh agent must be able to read it, see what is known, identify what remains uncertain, and continue without reconstructing the work from chat history.

If the user approves implementation, keep the same memory file and follow [Writing and Running Implementation Plans](WRITING-IMPLEMENTATION-PLANS.md). Do not copy that guide into the report or create a separate implementation document.

## Run a spike to remove a real uncertainty

Use a spike when a decision is blocked by evidence that is missing, conflicting, expensive to obtain, or likely to have changed. Common cases include:

- Determining whether an approach is technically feasible.
- Comparing vendors, libraries, services, standards, or architectural options.
- Tracing an unfamiliar system before proposing a change.
- Investigating product behavior or operational failure across several sources.
- Measuring a performance, cost, capacity, compatibility, or reliability claim.
- Testing a risky assumption with a focused prototype.
- Finding enough evidence to decide whether implementation should happen at all.

Do not create a spike for a quick lookup, routine repository navigation, or work whose requirements and implementation are already decision-complete.

## Project rules stay linked, not copied

Read the rules that apply to the investigation before gathering evidence. Use [Agent Skill Organization](../AGENT-SKILLS.md) for harness guidance and [Maintaining Documentation](../../MAINTAINING-DOCUMENTATION.md) for documentation rules. Code prototypes and implementation checks remain subject to [Testing Guide Selection](../../testing/USING-TESTING-GUIDES.md), [Coding Style Guide Selection](../../coding-style-guides/USING-CODING-STYLE-GUIDES.md), and any nearer repository instructions.

Do not reproduce those rules in the report. Record only the way they constrain this investigation.

## Start with the decision, not a broad topic

1. State the decision the research must support. "Research WebGPU" is a topic. "Decide whether WebGPU can replace the existing renderer without losing the required capture and fallback behavior" is a decision.
2. Break the decision into concrete questions. Each question must be answerable with evidence or end in a clearly stated evidence gap.
3. Record confirmed scope, constraints, source restrictions, and user decisions. Ask the user before choosing an unresolved direction that would materially change the investigation or its outcome.
4. Create `documentation/memory/<NAME>.md` before the investigation spreads across tool calls or sources. Use an uppercase, dash-separated name.
5. Define what evidence would be enough to finish. Use decision criteria and stopping conditions. Do not invent a time box unless the user set one.
6. Write the investigation plan into the report, then update it as new evidence changes which questions matter.

Research is complete when the report answers the decision-driving questions well enough to make the requested decision, or when it proves that a decision cannot be made without specific missing evidence. More links and more prose do not make a spike more complete.

## Every report needs the same core information

Use the following sections. Add domain-specific sections only when they help answer the questions. Do not create empty headings or force code-specific material into a non-code investigation.

### Work status makes the investigation resumable

Keep `Work status` directly below the title. Record:

- `State`: `Researching`, `Waiting for input`, `Ready for decision`, `Approved for implementation`, or `Closed`.
- `Answered`: the question identifiers that have enough evidence.
- `Open`: the question identifiers that still matter.
- `Next`: one concrete research action.
- `Blocked by`: missing access, an unresolved user decision, unavailable evidence, or `Nothing`.

Use stable question identifiers such as `Q1` so the status remains short. Update it before any pause, handoff, or likely context compaction.

### Decision this research supports defines the finish line

State who or what needs a decision, the available outcomes, the consequences of getting it wrong, and the criteria that will decide between the outcomes. Include confirmed scope and constraints.

Do not hide a product or architecture choice inside a research question. If the repository cannot answer the choice and the user has not made it, ask before narrowing the report around one option.

### Investigation plan maps questions to evidence

For every question, record:

- The claim or uncertainty being tested.
- The evidence needed to answer it.
- The sources, tools, measurements, interviews, or prototypes that can provide that evidence.
- The condition that marks the question answered.

Keep independent lines of research separate so they do not repeat one another. Explore them in parallel only when the active harness and user instructions allow it. Otherwise, investigate them sequentially with the same boundaries.

### Findings organize evidence by question

Organize findings under the question they answer, not in the order they were discovered. Start each finding with the answer, then give the supporting evidence, limits, and effect on the decision.

Use one of these evidence states:

- `Confirmed`: supported directly by the live system, an authoritative source, or a repeatable measurement.
- `Supported`: backed by credible evidence, but still dependent on an assumption or incomplete coverage.
- `Tentative`: plausible, but blocked by conflicting, indirect, stale, or missing evidence.

Label a claim as an `Inference` when it is derived from cited facts rather than stated directly by a source. Do not use an evidence state as a substitute for explaining the evidence gap.

### Options and recommendation connect evidence to a decision

Compare only serious options. For each option, state where it fits, where it fails, its important costs and risks, and the evidence behind those claims. Include doing nothing when it is a real option.

Give a recommendation when the evidence supports one. State why it wins against the decision criteria, which uncertainties remain, and what evidence would reverse the recommendation. If the evidence does not support a decision, say exactly what is missing and how it could be obtained.

### References make claims checkable

Link directly to the source that supports each material claim. Prefer live code, configuration, infrastructure, official documentation, standards, primary research, vendor contracts, and repeatable measurements. Use secondary sources to discover primary material or to add informed analysis, not as a substitute for an available authoritative source.

Current prices, product behavior, laws, standards, schedules, and vendor capabilities must be checked against current sources. Record the date when a claim is likely to change and the date matters to the recommendation.

Keep quotes short and use them only when exact wording matters. A citation proves nothing if the linked source does not support the nearby claim.

## Match the method to the question

Use the smallest method that can produce defensible evidence:

| Question | Useful evidence |
|---|---|
| How does the system behave? | Live code, configuration, infrastructure, logs, documented runtime contracts, and permitted checks |
| Is an approach feasible? | A focused prototype, dependency source, official API contracts, and a repeatable result |
| Which option fits? | Shared decision criteria, comparable evidence, costs, failure modes, and constraints |
| What does a vendor support? | Current vendor documentation, API references, terms, pricing, limits, and a focused trial when allowed |
| What should the product do? | Confirmed user intent, product contracts, observed workflows, support evidence, and explicit trade-offs |
| What operational risk exists? | Failure history, metrics, limits, runbooks, dependency behavior, and recovery evidence |
| What does research establish? | Primary papers, standards, datasets, methods, limitations, and corroborating work |

Start external research with broad, short queries to find the vocabulary and primary sources. Narrow the search as findings expose the real gaps. Do not keep searching after the decision criteria are satisfied unless a contradiction remains unresolved.

When a source conflicts with another source, do not choose the answer that is easiest to use. Check dates, versions, scope, methodology, and whether each source is describing the same thing. Record the conflict in the affected finding and explain how it was resolved or why it remains open.

## Keep prototypes focused and disposable by default

A prototype exists to answer a question. Before creating one, record:

- The question it tests.
- The smallest setup that can answer it.
- The success and failure signals.
- The commands or procedure needed to repeat it.
- Whether its code or data is disposable, reusable, or intended for production.
- The cleanup needed after the result is captured.

Do not let a prototype silently become production implementation. Moving prototype work into the product requires an approved implementation plan and the normal repository rules.

## Rewrite the report when the evidence changes

The report must read as one coherent statement of what is true and why.

When new evidence changes a finding:

1. Replace the incorrect claim in the finding where it appears.
2. Update every option, recommendation, constraint, and open question affected by that claim.
3. Add one short note in that finding when the reversal itself matters, including the evidence that caused it.
4. Remove stale search plans and dead ends that no longer help another agent continue.
5. Update `Work status` with the next unanswered question.

Do not append a `Correction`, `Latest findings`, or chronological research diary to the bottom while leaving the earlier report wrong. Keep raw search results and tool output outside the report unless a concise excerpt is evidence.

Before a pause, handoff, or context compaction:

1. Update the status of every research question.
2. Integrate new evidence into the relevant findings.
3. State the next exact source, check, measurement, or user decision needed.
4. Record access failures and missing evidence without turning them into conclusions.
5. Remove duplicate explanations and notes that have been superseded.

## Continue the same file when implementation is approved

Do not write a separate implementation report.

1. Record the user's decision and set `Work status` to `Approved for implementation`.
2. Read [Writing and Running Implementation Plans](WRITING-IMPLEMENTATION-PLANS.md).
3. Keep the same `documentation/memory/<NAME>.md` file.
4. Preserve the decision, evidence, constraints, and findings that the implementation depends on.
5. Add the implementation plan and verification material required by the implementation guide. Reuse existing context instead of restating it.
6. As implementation exposes new evidence, update the finding, recommendation, decision, and implementation step that it changes.

If implementation disproves a material premise or requires a new user choice, stop that line of implementation, make the report coherent, and get the decision before continuing.

## Starting template

```markdown
# <Decision-driving title>

## Work status

- State: Researching
- Answered: None
- Open: Q1
- Next: <One concrete research action>
- Blocked by: Nothing

## Decision this research supports

<The decision, possible outcomes, consequences, criteria, scope, and constraints.>

## Investigation plan

### Q1. <Concrete question>

Evidence needed: <What would answer the question.>

Method: <Sources, tools, measurements, interviews, or prototype.>

Done when: <The stopping condition.>

## Findings

### Q1. <Answer>

Evidence state: Tentative

Evidence: <Linked facts, measurements, and limitations.>

Effect on the decision: <What this changes.>

## Options and recommendation

<Comparison against the decision criteria, recommendation, remaining uncertainty, and reversal condition.>

## References

- <Only sources used by the report.>
```

## Why this format works for agent research

Anthropic's [context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) describes structured file-based notes as persistent memory for work that outlives a context window. Its [research system](https://www.anthropic.com/engineering/multi-agent-research-system) saves the research plan to memory, decomposes independent questions, adapts searches to findings, and verifies citations before returning a report. OpenAI's [deep research guidance](https://help.openai.com/en/articles/10500283-deep-research) likewise uses a reviewable research plan and a cited report.

The format above turns those practices into one repository file that remains useful after research. It keeps the report domain-neutral and lets an approved investigation continue into implementation through the linked implementation guide.
