# Writing style

How to write docs, tickets, PR descriptions, and reports so they read like a person wrote them, not a language model. Applies to anything written for other people to read.

## The point

Write like you're explaining it to a coworker at their desk. Plain, direct, no filler. If a sentence sounds like a corporate brochure or a blog intro, cut it or rewrite it. The reader is busy and technical; respect that.

## Do

- Get to the point in the first sentence. Say what the thing is and why it matters, then move on.
- Use plain words. "Use," not "utilize." "Enough," not "sufficient." "Before," not "prior to." "Because," not "due to the fact that."
- Prefer short sentences. Break up anything with three commas in it.
- Use concrete nouns and real names: the actual file, function, endpoint, flag. `authController.js:62`, not "the relevant handler."
- Write headings that say what's in the section: "Why LIX-12 broke," not "Background" or "Deep dive."
- Explain the reasoning, not just the conclusion. A coworker wants to know *why*, briefly.
- Use tables and code blocks when they're genuinely clearer than prose. Don't pad them out.
- When answering a set of questions, quote each question plainly and answer it directly underneath.
- Read it back and delete any sentence that doesn't add information.

## Don't

- **No slop headings.** Avoid "TL;DR," "How we got here," "Deep dive," "Let's dive in," "The journey," "Executive Summary," "Key Takeaways," "Unlock," "Elevate," "Supercharge." Name the section after its content instead.
- **No throat-clearing.** Don't open with "In today's fast-paced world," "It's worth noting that," "As we all know," or "This document aims to." Just start.
- **No preachy wrap-up lines.** Skip "The point worth internalizing," "At the end of the day," "Remember:," and one-liner morals. State the fact and stop.
- **No AI tics.** Don't prefix answers with "Q:" / "A:" or "Answer:". Don't announce "Answering each question directly." Don't over-bold or over-bullet. Don't end every section with a summary of the section.
- **No hype or hedging padding.** Drop "seamlessly," "robust," "powerful," "leverage," "delve," "furthermore," "moreover," "it is important to note," "plays a crucial role."
- **No fake balance.** Don't write "on one hand / on the other hand" when you have a clear recommendation. Give the recommendation.
- **Don't restate the obvious.** If the code block already shows it, don't narrate it line by line.

## Punctuation

- **No em dashes or en dashes** (— –). Rewrite with a comma, a colon, parentheses, or two sentences.
  - Bad: "It was reverted mid-release — nobody could log in."
  - Good: "It was reverted mid-release, since nobody could log in."
- **No arrow characters** (→) in prose. Write "then," "goes to," or "leads to." Arrows are fine only inside code or diagrams.
- Use straight quotes and normal punctuation. Don't decorate.
- Ranges: write "AC2 through AC4," not "AC2–4."

## Voice

- Second person and plain active voice: "We drop the email branch," "You'll see the field vanish."
- Write in complete sentences. Short is good, but a sentence still needs a subject and a verb. Clipped fragments like "Security isn't moving." or "Not worth it." read as generated, because nobody talks that way at a desk.
- Say who is doing the thing. "I don't want to touch the auth code," not "The auth code stays as-is." "I'd rather we document it," not "Documentation is the deliverable."
- Let sentences connect. Use "so," "because," "and," "but" to join ideas instead of stacking standalone statements. Two sentences that clearly relate should say how they relate.
- It's fine to be a little blunt, but say it as a sentence: "I don't think that's worth it," not "Not worth it." Confidence reads as human; hedging reads as generated.
- Contractions are good: "don't," "it's," "we'll."

## Quick before/after

Before (slop):

> ## TL;DR
> In order to address the user enumeration vulnerability, it is important to note that we must leverage a robust, button-based solution — this seamlessly empowers users to select their authentication method. At the end of the day, security is crucial.

After (plain):

> ## Summary
> The endpoint leaks whether an email is a real SSO user. Fix it by letting the user pick SSO or password with a button, instead of the server deciding. That removes the leak and keeps SSO-Bypass users working.

## Chat and Slack replies

Messages to a coworker in Slack, a chat reply, a quick status update. Shorter and looser than a doc, but the same rules apply, harder. This is where AI slop is most obvious, so watch it.

### Do

- Open with the answer or the state, as a sentence: "It's fixed and deployed." "It wasn't the fetcher." "This is still broken and I'm looking at it now." Then explain.
- Write the way you'd actually say it out loud to the person. If you wouldn't say a sentence at their desk, delete it. Read it back and check every sentence would survive being said out loud.
- It's fine to say what you think and why: "I think there are a couple of problems with how that got framed," "I'd rather we just say it isn't supported anymore." Owning the opinion reads as human.
- Match the reader. Talk to QE about behavior and what to check. Talk to a dev about the mechanism. Don't send commit hashes, file paths, function names, or line numbers to someone who doesn't touch the code. It's noise to them.
- Explain a problem by what it does, not how the code does it: "one bad framework was killing the whole run," not the class and method that threw.
- Keep it to a few short paragraphs, one idea each. Short is still full sentences: "I re-triggered all 3 and they finished clean," not "Re-triggered all 3, they finished clean."
- Don't over-structure a chat reply. Headings, bold labels and bullet lists in Slack are the clearest tell that a model wrote it. Write paragraphs.
- End with the real next step or the actual open question. "Any idea how the regression subs get set up?" Ask the thing you need.

### Don't

- No meta-commentary about your own process or state of mind: not "like I first thought," "turns out," "as I suspected," "on closer inspection," "after digging in." Just say what's true now.
- No hedging tics: "it seems," "it looks like," "I believe," "presumably," "I think." If you checked, state it. If you didn't, say you didn't.
- No implementation detail as decoration. A hash or a filename earns its place only when the reader will act on it. Default to leaving it out.
- No recap of what you just did as if narrating: "So to summarize," "Just to recap." They read the message.
- No corporate softeners: "Just wanted to flag," "quick heads up that," "circling back," "wanted to loop you in." Say the thing.
- No fake enthusiasm or filler openers: "Great question," "Good news," "So!" Start with content.

### Before/after

Before (slop):

> Great question! So after digging into this, it turns out the issue wasn't actually in the apex fetcher like I first thought. It seems the RegVaultFetcherLambda was throwing an ApiFetcherLambdaException at RegVaultDynamoRepository.cs:191 because one of the framework subscriptions couldn't be resolved. I've pushed a fix (commit a1b2c3d) that should hopefully resolve this. Let me know if you need anything else!

After (plain):

> It's fixed and deployed.
>
> It wasn't the apex fetcher. The 3 integrations point at APEX frameworks that aren't in the hierarchy, and one bad framework was killing the whole run, so they triggered but didn't process anything. I changed it to skip a missing framework instead of failing everything.
>
> I re-triggered all 3 and they finished clean with real content coming through.

Still clipped (don't do this):

> Not the apex fetcher. Bad framework, whole run died. Fixed. Re-triggered, all clean.

Every one of those is missing a subject or a verb. It reads like notes, not like a person talking.

## How to use this

Before you publish anything for other people to read, skim it once against the Don't list. If a heading or sentence trips it, rewrite it. A good gut check: read it out loud. If you'd never say it to a coworker, don't write it.
