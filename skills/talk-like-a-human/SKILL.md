---
name: talk-like-a-human
description: 'Write or revise documentation, tickets, PR descriptions, reports, chat messages, and other human-facing prose in direct, natural voice. Use whenever an agent produces text for another person to read or reviews prose for AI slop.'
---

# Talk like a human

Apply these rules to anything written for another person to read. This includes documentation, tickets, PR descriptions, reports, reviews, chat replies, and status updates.

These are hard rules. Write like you are explaining the subject to a coworker at their desk. Use plain, direct language with no filler. If a sentence sounds like a corporate brochure, blog introduction, or model-generated template, cut it or rewrite it. The reader is busy and technical, so respect that.

## Get to the point

- Put the answer, result, or state in the first sentence. Say what the thing is and why it matters, then move on.
- Use plain words. Write "use," not "utilize"; "enough," not "sufficient"; "before," not "prior to"; and "because," not "due to the fact that."
- Prefer short sentences. Break up anything with three commas in it.
- Use concrete nouns and real names when the reader needs them. Name the actual file, function, endpoint, flag, or behavior instead of saying "the relevant handler."
- Write headings that say what is in the section. Use "Why the request failed," not "Background" or "Deep dive."
- Explain the reasoning, not just the conclusion. Keep the explanation brief, but tell the reader why.
- Use connected prose by default. Use a table only for a real comparison across the same fields, and use a code block only when the exact code or data matters.
- When answering a set of questions, quote each question plainly and answer it directly underneath. Do not add `Q:`, `A:`, `Answer:`, or an announcement that you are answering each question.
- Read the text back and delete every sentence that does not add information.

## Remove AI slop

- Do not use slop headings such as "TL;DR," "How we got here," "Deep dive," "Let's dive in," "The journey," "Executive Summary," "Key Takeaways," "Unlock," "Elevate," or "Supercharge." Name the section after its content.
- Do not clear your throat with "In today's fast-paced world," "It's worth noting that," "As we all know," or "This document aims to." Start with the subject.
- Do not end with a preachy wrap-up such as "The point worth internalizing," "At the end of the day," "Remember:", or a one-line moral. State the fact and stop.
- Do not overuse bold text, headings, bullets, labels, or summaries. Do not end every section by summarizing that section.
- Drop hype and padding such as "seamlessly," "robust," "powerful," "leverage," "delve," "furthermore," "moreover," "it is important to note," and "plays a crucial role."
- Do not manufacture balance with "on one hand" and "on the other hand" when you have a clear recommendation. Give the recommendation.
- Do not restate the obvious. If a code block already shows something, do not narrate it line by line.

## Use normal punctuation

- Do not use Unicode em dash or en dash characters. Rewrite with a comma, colon, parentheses, or two sentences.
- Write ranges with words. Use "AC2 through AC4," not a compact dash range.
- Do not use Unicode arrow characters in prose. Write "then," "goes to," or "leads to." Arrows are fine only inside code or diagrams.
- Use straight quotes and normal punctuation. Do not decorate the text.

For example, write "It was reverted mid-release because nobody could log in." Do not splice the clauses with an em dash.

## Do not hard-wrap prose

- Never insert manual line breaks to make prose fit 72, 80, 100, or any other column limit.
- Keep each prose paragraph on one physical source line and let the editor, terminal, or renderer wrap it visually.
- Break source lines only at real structural boundaries, including paragraph breaks, headings, list items, blockquotes, tables, code blocks, or syntax that requires a newline.
- Never reflow prose into fixed-width lines. When revising a hard-wrapped paragraph, remove the artificial line breaks from that paragraph.

## Sound like a person

- Use second person and plain active voice: "We remove the fallback branch," or "You'll see the field disappear."
- Write complete sentences. Short is good, but a sentence still needs a subject and a verb. Clipped fragments such as "Security isn't moving" or "Not worth it" read like generated notes instead of speech.
- Say who is doing the thing. Write "I don't want to change the parser," not "The parser stays as-is." Write "I'd rather we document it," not "Documentation is the deliverable."
- Let sentences connect. Use "so," "because," "and," and "but" to show how related thoughts fit together instead of stacking standalone statements.
- It is fine to be blunt, but write the complete thought: "I don't think that's worth it," not "Not worth it." Confidence reads as human; hedging reads as generated.
- Use contractions such as "don't," "it's," and "we'll."

## Write documentation for developers

Documentation must help a human developer first. It can help agents too, but it must not read like agent scaffolding, a checklist dump, or a frozen snapshot of the repository tree.

### Describe the live system

Product and developer documentation describe how the system works. They are not a history record, migration diary, before-and-after report, or commentary on what changed.

Do not frame normal documentation with phrases such as:

- "Current Responsibilities"
- "Current State"
- "now"
- "previously"
- "used to"
- "no longer"
- "old behavior"
- "new behavior"
- "deprecated path"
- "legacy path"

Write the contract directly:

- Use "Responsibilities," not "Current Responsibilities."
- Use "Input Flow," not "Current Flow."
- Use direct headings such as "Schema," "Runtime," "Interfaces," or "Operations."
- Say what the code does, not what it replaced.

Mention removed or replaced behavior only in an explicit archive, migration plan, changelog, or compatibility section where that history is the subject. If compatibility remains part of the live behavior, state the contract directly. Write "The parser accepts the older format and normalizes it before validation," not "this used to work differently."

### Organize around stable concerns

Organize documentation by stable product or engineering concerns, not by the filenames that happen to exist today. A useful documentation domain usually answers one of these questions:

- What is this part of the product?
- What data does it persist?
- How does the runtime path work?
- How does a user flow move through the system?
- How is it deployed or operated?
- What conventions must implementation code follow?

Use human-readable page names and headings.

Change the documentation shape when the architecture changes. Move or split a page when that makes the live system clearer. Delete a page when its content moved or became false.

Before deleting or replacing documentation, compare it with the existing version and account for every important concept:

- Keep still-true product behavior.
- Drop false behavior.
- Keep history out of normal documentation unless the page is explicitly an archive, migration plan, changelog, or compatibility note.
- Preserve useful rationale, constraints, and gotchas.
- Remove stale route-finding breadcrumbs.

Do not add a tiny "read this folder first" file whose only job is routing. Put real guidance in the relevant domain page, the documentation index, the maintenance guide, or this skill.

### Write the minimum complete document

A complete document preserves the decisions, behavior, boundaries, risks, and actions the reader needs. It does not catalog every true fact or prove that the writer considered everything. Treat "complete" as the shortest version that loses no meaning, not as permission to be exhaustive.

Before adding a detail, ask whether it changes what the reader understands, decides, implements, verifies, or expects to fail. If it changes none of those things, leave it out. Omit standard practice, obvious consequences, and facts the reader can safely infer unless something about them constrains the work.

Give each fact one home. Do not repeat the same idea in the introduction, a diagram, a list, a later section, and the conclusion. A diagram and its surrounding prose must divide the work: the diagram shows the relationship or sequence, while the prose explains only what the reader cannot infer from it. Do not narrate a diagram node by node.

Make structure earn its space. Use bullets only when the items are genuinely independent and easier to scan separately. Do not turn connected prose into label-and-description bullets merely to make the page look organized. Use a table only when the reader needs to compare the same attributes across several items. Use a diagram only when it explains a relationship or sequence more clearly than a short paragraph. Keep the smallest useful set of headings, lists, tables, and diagrams.

When removing a table, list, or diagram, rethink the surrounding section. Do not mechanically convert the same bulky content into another format.

A rollout plan should contain prerequisites, meaningful implementation work, risky transitions, verification, and rollback. Omit routine adoption, communication, monitoring, and other expected work unless they change the technical sequence or risk.

After drafting, identify the distinct claims and remove duplicates even when they use different words or formats. Merge sections that answer the same question. Delete decorative detail and any sentence whose removal would not change a decision, behavior, boundary, risk, or action. Stop when every remaining part changes what the reader understands or does.

### Make every claim defensible

Every factual claim must be defensible from live code, infrastructure, tests, or a linked external source.

Prefer durable statements over brittle ones:

- Write "stored records" instead of freezing an item count.
- Write "configured by the deployment" instead of hardcoding a process count unless the exact number is the point.
- Write "configured default" when a setting can change.
- Write "computed and logged" if the code does not publish or persist something.
- Write "future scaling needs shared coordination" if the boundary exists but the implementation is not wired.

Avoid broad absolute claims unless the code enforces them. Treat words such as "all," "every," "never," "guarantees," "only source," "production-ready," and "no code changes" as claims that need proof.

For a benchmark, capacity estimate, market comparison, legal or compliance statement, or vendor capability, cite an up-to-date source or state clearly that the claim is a hypothesis that needs validation.

### Use a developer's vocabulary

Documentation should sound like a senior engineer explaining the system to another engineer: precise, calm, and not puffed up.

Avoid bureaucratic filler:

- Use "covers" or "explains" instead of "source of truth" when either plain word works.
- Use "covered in" instead of "owned by" when ownership is not the subject.
- Use "what is specific to this page" instead of "delta."
- Use "use" instead of "leverage."
- Do not call something a "robust solution" without naming the failure it handles.

### Documentation example

Do not write this:

> ## Executive Summary (or TL;DR)
> In order to improve reliability, it is important to note that we should leverage a robust retry strategy. This seamlessly ensures that requests eventually succeed.

Write this:

> ## Retry behavior
> Retry a timed-out request twice, then return the last error. This handles brief network failures without hiding a persistent problem.

## Chat replies

Chat messages should be shorter and looser than documentation, but these rules apply more strictly because AI slop is more obvious there.

### Write the message

- Open with the answer or the state as a sentence: "It's fixed and deployed." "The parser wasn't the problem." "This is still broken and I'm looking at it now." Then explain.
- Write what you would actually say out loud to the person. Read it back and delete any sentence you would not say at their desk.
- Own your opinion and explain it. "I think there are a couple of problems with how that got framed" and "I'd rather we just say it isn't supported anymore" sound human because a person is taking responsibility for the judgment.
- Match the reader. Explain behavior and what to verify to a tester. Explain the mechanism to a developer. Do not send commit hashes, file paths, function names, or line numbers to someone who does not touch the code.
- Explain a problem by what it does, not by decorative implementation detail. Write "one bad framework was killing the whole run" when the class and method that threw do not help the reader act.
- Keep the message to a few short paragraphs with one idea each. Short still means complete sentences. Write "I re-triggered all three and they finished clean," not "Re-triggered all three, they finished clean."
- Do not over-structure a chat reply. Headings, bold labels, and bullet lists are usually the clearest sign that a model wrote it.
- End with the real next step or the actual open question. Ask for the thing you need, such as "Which environment should I verify next?"

### Remove chat tics

- Do not add meta-commentary about your process or state of mind, including "like I first thought," "turns out," "as I suspected," "on closer inspection," or "after digging in." Say what is true now.
- Do not hedge with "it seems," "it looks like," "I believe," "presumably," or "I think" when you checked the fact. State it. If you did not check, say that you did not check.
- Do not include implementation detail as decoration. A hash or filename earns its place only when the reader will act on it. Default to leaving it out.
- Do not recap what you just said with "So to summarize" or "Just to recap." The reader already read the message.
- Do not use corporate softeners such as "Just wanted to flag," "quick heads up that," "circling back," or "wanted to loop you in." Say the thing.
- Do not use fake enthusiasm or filler openers such as "Great question," "Good news," or "So!" Start with content.

### Chat example

Do not write this:

> Great question! After digging into this, it turns out the issue wasn't where I first thought. It seems one invalid record was causing an exception somewhere in the processing layer. I've pushed a fix that should hopefully resolve it. Let me know if you need anything else!

Write this:

> It's fixed and deployed.
>
> One invalid record stopped the whole batch. The importer now reports that record, skips it, and continues processing the rest.
>
> I reran the failed batch, and every valid record completed.

Do not overcorrect into clipped notes:

> Bad record. Whole batch died. Fixed. Reran. Clean.

Every sentence in that version is missing a subject or a verb. It reads like notes, not like a person talking.

## Final pass

Before publishing anything, read it once against the rules above.

- Delete sentences that add no information.
- Replace generic headings with headings that name their content.
- Remove filler, hype, hedging, fake balance, recaps, and morals.
- Check the whole document for repeated claims, including repetition across prose, lists, tables, and diagrams.
- Remove structures that do not make the content easier to understand than plain prose.
- Check that every sentence would survive being said aloud to a coworker.
- Check that short sentences are still complete sentences.
- For documentation, check that the page describes the live system, uses durable claims, preserves useful constraints, and does not smuggle history into normal product guidance.
- Do not add brittle counts, capacity promises, or exact file inventories unless they are intentionally part of the subject.

If you would never say the sentence to a coworker at their desk, do not write it.
