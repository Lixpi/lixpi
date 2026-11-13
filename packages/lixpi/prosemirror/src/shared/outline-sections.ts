// Outline rules for one sibling sequence. A heading's section is every entry
// after it until the next heading of the same or a higher level (a lower or
// equal number). Lower-level headings inside that section form subgroups, and
// entries before the first heading are ungrouped. The sequence itself stays
// flat; sections are computed from it.

export type OutlineSequenceEntry = {
    entryId: string
    // Set for headings, left out for items.
    headingLevel?: number
}

export type OutlineRange = {
    start: number
    // Exclusive.
    end: number
}

// The range the heading at `index` carries when it moves: the heading and its
// whole section. For an item, the range is the item alone.
export const outlineSectionRange = (
    entries: OutlineSequenceEntry[],
    index: number,
): OutlineRange => {
    const level = entries[index]?.headingLevel

    if (level === undefined)
        return {
            start: index,
            end: index + 1,
        }

    let end = index + 1

    while (end < entries.length) {
        const nextLevel = entries[end].headingLevel

        if (
            nextLevel !== undefined
            && nextLevel <= level
        )
            break

        end += 1
    }

    return {
        start: index,
        end,
    }
}

// For each entry, the levels of the headings whose sections contain it,
// outermost first. A heading's own list leaves out the heading itself.
export const enclosingHeadingLevels = (entries: OutlineSequenceEntry[]): number[][] => {
    const stack: number[] = []

    return entries.map(entry => {
        if (entry.headingLevel === undefined)
            return [...stack]

        while (
            stack.length > 0
            && stack.at(-1)! >= entry.headingLevel
        )
            stack.pop()

        const enclosing = [...stack]
        stack.push(entry.headingLevel)

        return enclosing
    })
}
