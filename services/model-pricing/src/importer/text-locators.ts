'use strict'

export type LocatedAmount = {
    amount: string
    locator: string
}

const AMOUNT_PATTERN = /\$([0-9]+(?:\.[0-9]+)?)/g
const MAX_LABEL_OCCURRENCES_TRIED = 500

// Includes "-" and "." so a bare model id like "gpt-image-1" or "claude-opus-4"
// is never treated as bounded when it's actually a prefix of a longer id
// like "gpt-image-1-mini" or "claude-opus-4.1".
const isWordChar = (character: string | undefined): boolean =>
    character !== undefined && /[A-Za-z0-9.-]/.test(character)

// Yields every occurrence of `label` that is not itself a substring of a
// longer label - e.g. "Claude Opus 4" must not match inside "Claude Opus
// 4.8". Requires a non-word character (or start/end of string) on both
// sides of the match. Still O(n) overall: each occurrence advances the
// search past itself, so the scan never revisits text regardless of how
// many occurrences a caller ends up trying.
//
// A page's real content is frequently not the first occurrence of a model's
// display name - nav menus, breadcrumbs, and "related models" links can all
// name it earlier than the pricing table itself. Callers below try each
// occurrence in turn and accept the first one that actually has a nearby
// dollar amount, rather than trusting the first occurrence blindly.
function* findBoundedLabelIndexes(text: string, label: string): Generator<number> {
    let fromIndex = 0
    let tried = 0
    while (fromIndex <= text.length && tried < MAX_LABEL_OCCURRENCES_TRIED) {
        const candidate = text.indexOf(label, fromIndex)
        if (candidate === -1) return

        const before = candidate > 0 ? text[candidate - 1] : undefined
        const after = text[candidate + label.length]
        if (!isWordChar(before) && !isWordChar(after)) {
            tried++
            yield candidate
        }

        fromIndex = candidate + 1
    }
}

// Bounded, linear-time helpers over plain fetched text. No HTML parser, no
// unbounded regex over the whole document - every scan is confined to a
// small window after a fixed, word-boundary-checked label, and every
// function returns `undefined` on no-match rather than throwing, so callers
// can hold with a specific reason instead of crashing the import run.

// Returns the text window starting at the first occurrence of `label` whose
// window actually contains a dollar amount, extending `withinChars`
// further. Returns `undefined` if `label` never appears with a nearby
// amount (e.g. every occurrence was nav chrome, not pricing content).
export const findLabeledWindow = (
    text: string,
    label: string,
    { withinChars = 400 }: { withinChars?: number } = {},
): string | undefined => {
    for (const labelIndex of findBoundedLabelIndexes(text, label)) {
        const window = text.slice(labelIndex, labelIndex + label.length + withinChars)
        AMOUNT_PATTERN.lastIndex = 0
        if (AMOUNT_PATTERN.test(window)) return window
    }
    return undefined
}

// Finds `label` as its own token, then the first `$X.XX`-shaped token within
// `withinChars` characters after it - trying each occurrence of `label` in
// document order until one has a nearby amount.
export const findLabeledAmount = (
    text: string,
    label: string,
    { withinChars = 400 }: { withinChars?: number } = {},
): LocatedAmount | undefined => {
    for (const labelIndex of findBoundedLabelIndexes(text, label)) {
        const windowStart = labelIndex + label.length
        const window = text.slice(windowStart, windowStart + withinChars)
        AMOUNT_PATTERN.lastIndex = 0
        const match = AMOUNT_PATTERN.exec(window)
        if (match) return { amount: match[1]!, locator: `${label}${match[0]}` }
    }
    return undefined
}

// Returns the Nth (0-indexed) `$X.XX`-shaped token inside an already-bounded
// window (e.g. one produced by `findLabeledWindow`) - lets a caller pull
// several columns (input/output/cache/etc.) out of one table row without
// re-scanning the source text for the row label each time.
export const findNthAmountInWindow = (
    window: string,
    occurrenceIndex: number,
): LocatedAmount | undefined => {
    AMOUNT_PATTERN.lastIndex = 0
    let match: RegExpExecArray | null
    let index = 0
    while ((match = AMOUNT_PATTERN.exec(window)) !== null) {
        if (index === occurrenceIndex) {
            return { amount: match[1]!, locator: match[0] }
        }
        index++
    }
    return undefined
}

export type LocatedNumber = {
    value: string
    locator: string
}

const NUMBER_PATTERN = /([0-9]+(?:\.[0-9]+)?)/

// Like `findLabeledAmount`, but for a plain number rather than a
// "$"-prefixed one (e.g. a credit count in prose: "requires 6.5 credits").
export const findLabeledNumber = (
    text: string,
    label: string,
    { withinChars = 200 }: { withinChars?: number } = {},
): LocatedNumber | undefined => {
    for (const labelIndex of findBoundedLabelIndexes(text, label)) {
        const windowStart = labelIndex + label.length
        const window = text.slice(windowStart, windowStart + withinChars)
        const match = NUMBER_PATTERN.exec(window)
        if (match) return { value: match[1]!, locator: `${label}${match[0]}` }
    }
    return undefined
}

export type TaggedAmount = LocatedAmount & { tag: string }

// Bounded (parenthesized span capped at 40 chars, so no unbounded scan) -
// finds every `$X.XX (tag)` pair in `window`, the shape Google's Veo pricing
// rows use to carry a resolution qualifier after the amount rather than
// before it (e.g. "$0.40 (720p and 1080p)").
const TAGGED_AMOUNT_PATTERN = /\$([0-9]+(?:\.[0-9]+)?)\s*\(([^)]{1,40})\)/g

export const findTaggedAmounts = (window: string): TaggedAmount[] => {
    TAGGED_AMOUNT_PATTERN.lastIndex = 0
    const results: TaggedAmount[] = []
    let match: RegExpExecArray | null
    while ((match = TAGGED_AMOUNT_PATTERN.exec(window)) !== null) {
        results.push({ amount: match[1]!, tag: match[2]!.trim(), locator: match[0] })
    }
    return results
}
