---
name: implementation-plans
description: 'Research and write Lixpi spike reports, implementation plans, technical proposals, design docs, RFCs, feature specs, vendor evaluations, and detailed tickets, then maintain the same living plan during implementation.'
---

# Research and Implementation Plans

## Finish the requested planning work

Do not stop with an unfinished plan. Continue researching, designing, clarifying, and updating the same memory file until the requested planning scope is complete. Settling product choices is not enough when technical contracts, failure behavior, compatibility, or implementation steps still need design. A list of remaining work is a progress update, not a finished planning deliverable.

For every unresolved item, determine what will resolve it. Investigate facts and technical details through the available code, configuration, and authoritative sources. Ask the user as soon as a material decision or missing requirement needs their answer. Do not ask them to do research the agent can perform, invent their preference, or quietly defer a required decision to implementation. Use previous answers and existing behavior; do not reopen settled questions without new contradictory evidence.

After each answer, update every affected part of the plan and continue resolving the remaining gaps. Never end a planning turn merely by recording the answer, saying there are no more product questions, listing technical work still needed, or offering to finish the plan later. Review the whole plan for unresolved decisions and contradictions before claiming it is ready.

When an answer, unavailable access, or external evidence genuinely blocks progress, ask for the specific input needed and continue all independent authorized work. If nothing can proceed until it arrives, keep the task explicitly waiting for that input; this is a clarification handoff, not completion. Explain what is blocked, what has been established, and exactly what the user can provide or decide. Do not treat silence as an answer, fabricate evidence, or loop indefinitely against an unchanged blocker. Resume the plan when the input arrives. An explicit user pause or scope change still takes precedence.

Finishing a plan does not authorize implementation, tests, deployment, or external mutations. Complete the design within the user's scope. For a planning-only request, stop at a fully specified plan with no unresolved material choices, not at implemented code.

## Ask questions the user can answer

Every clarification question must explain its context in plain language before asking for a decision. A cryptic one-line question, an unexplained identifier, or a file reference does not supply that context. Use enough complete sentences that the user can answer without reconstructing the conversation or reading linked code.

For each question:

- Describe the concrete situation and what the user or system would experience. Explain technical terms that affect the choice.
- State exactly what is unknown and why the answer changes the plan. Distinguish a user decision from an implementation detail the agent can resolve.
- Describe the viable options and their practical consequences. Give a recommendation and its reason when the evidence supports one; mark it as a recommendation until the user selects it.
- End with a direct question that makes the requested answer clear. A statement such as "the recovery contract is missing" is not a question.

Put this explanation inside each question, including when using a question tool or multiple-choice options. Option labels and citations may supplement it but cannot replace it. Group related questions that can be answered together without hiding several unrelated decisions in one prompt. Ask newly discovered questions promptly, rather than waiting for the user to ask whether anything remains unclear.

For example, replace "What is the revocation policy?" with: "When an administrator disables an account, it may already have a request running. Disconnecting immediately can prevent the user from receiving that result. We can instead reject new requests and let only the already accepted request finish before disconnecting. Should an existing request be allowed to finish, or must disabling the account interrupt it too?"

## Choose the working guide

Choose the guide that matches the requested work and read it in full before drafting or changing a memory file:

- For research, feasibility work, vendor evaluation, architecture investigation, or another spike, read and follow [Spike Report Guidelines](${LIXPI_REPOSITORY_PATH}/skills/implementation-plans/references/spike-report-guidelines.md).
- For an implementation plan, technical proposal, design doc, RFC, feature spec, detailed ticket, or implementation from an approved plan, read and follow [Writing and Running Implementation Plans](${LIXPI_REPOSITORY_PATH}/skills/implementation-plans/references/writing-implementation-plans.md).
- When a spike moves into implementation, read both guides and continue using the same file under `documentation/memory/`.

Follow the command rules linked from `${LIXPI_REPOSITORY_PATH}/documentation/development-workflow/AGENT-SKILLS.md` before running commands.
