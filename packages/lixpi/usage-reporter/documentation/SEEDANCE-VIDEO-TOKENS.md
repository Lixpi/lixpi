---
title: Seedance video tokens
description: The vendor token formula for token-metered video models, the provisional frame-size table behind it, and the bias rule that has to survive any replacement.
---

# Seedance video tokens

Seedance models on BytePlus ModelArk report vendor video tokens. Request authorization uses that unit, so clip duration is converted into a token estimate before authorization.

`estimateVideoTokens` does that conversion.

## The formula

```text
tokens = (input video seconds + output video seconds) × width × height × frame rate / 1024
```

Frame rate is fixed at 24fps for the Seedance 2.0 series, which exposes no `frames` parameter.

This part is sourced. BytePlus states the Seedance 1.x form first-party as "Tokens per video = Width×Height×Frame Rate×Duration/1024" in its [Seedance 1.0 Pro guide](https://www.byteplus.com/en/blog/seedance-1-0-pro-guide-api-pricing), and its pricing page states the 2.0 form verbatim as "Estimated token consumption = (Input video duration + Output video duration) × Output video width × Output video height × Output video frame rate / 1024".

## The frame sizes are not sourced

The formula needs the output frame's pixel dimensions, and every number in `PROVISIONAL_SEEDANCE_FRAME_SIZES` is a placeholder. That is why the constant is named the way it is and why every estimate comes back with `provisional: true`.

The vendor table that would settle it ([ModelArk 2291680](https://docs.byteplus.com/en/docs/ModelArk/2291680), the Seedance 2.0 series tutorial) is a client-rendered page, as is the Volcengine equivalent, so neither can be read programmatically. The two readable tables disagree with each other on nearly every cell:

| Source | Covers | 480p 16:9 | 720p 16:9 | 1080p 16:9 |
|--------|--------|-----------|-----------|------------|
| BytePlus first-party blog | Seedance 1.0 Pro, not 2.0 | 864x480 | not published | 1920x1088 |
| docs.apiyi.com, a third-party reseller | Seedance 2.0 | 864x496 | 1280x720 | 1920x1080 |

720p is the worst case: it is one of only two tiers the catalog offers for Seedance, and no first-party source publishes its dimensions at all.

## How the placeholders were derived, and the bias to keep

For each cell, take the larger of the two sources on each axis independently, then round each axis up to a multiple of 16, which is the padding the first-party page shows (1080p 16:9 is 1920x1088, not 1920x1080). Every result sits at or above both sources.

Keep the estimate conservative when replacing the provisional table. Underestimating allows a provider request whose actual usage exceeds the authorized estimate. If a value is uncertain, round the usage estimate up.

The bias is not merely cautious. Inverting BytePlus's published per-video prices for 5s 16:9 clips back through the formula gives the true pixel area, and the placeholders land just above it every time:

| Tier | Published price | Rate | Implied area | Placeholder area |
|------|-----------------|------|--------------|------------------|
| 480p | $0.35 | $7.0/M | 426,667 px | 864x496 = 428,544 px (+0.4%) |
| 720p | $0.76 | $7.0/M | ~926,476 px | 1280x720 = 921,600 px (agrees within the rounding of a two-decimal price: 1280x720 prices at $0.756) |
| 1080p | $1.87 | $7.7/M | 2,072,381 px | 1920x1088 = 2,088,960 px (+0.8%) |

Source A's 480p 16:9 of 864x480 would have come in 2.8% low and underestimated usage. Everything except 16:9 remains unvalidated, as does 720p and 1080p beyond that single published sample, so no cell is promoted out of provisional status on this evidence.

## Unknown tiers and ratios

An unrecognized resolution tier resolves to the largest one on file, and an unrecognized aspect ratio to the largest within that tier. Seedance also advertises 4K, so a tier the catalog has not been taught about is over-estimated rather than silently priced as the smallest option.

## The input-video minimum

BytePlus documents that a minimum token consumption applies when the input contains video, which is the extension path, but not what that minimum is. `PROVISIONAL_MINIMUM_VIDEO_INPUT_TOKENS` is 0, which makes it inert: the computed count always wins. Raising it can only make the gate stricter, so fill in the documented value when the frame-size table is replaced.

## When the vendor table lands

Both `TODO(seedance-frame-sizes)` markers in `src/video-token-accounting.ts` are the work: replace the frame sizes with BytePlus's own table, fill in the input minimum, drop the `PROVISIONAL_` naming and the `provisional` flag, and update this page. Until then `logRequestAuthorization` warns on every provisional estimate so no one reads one as a real cost.
