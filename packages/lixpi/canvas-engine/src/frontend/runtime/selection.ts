export class CanvasSelection {
    private selected = new Set<string>()
    private marquee = false

    get nodeIds(): ReadonlySet<string> {
        return this.selected
    }
    get fromMarquee(): boolean {
        return this.marquee
    }
    get singleNodeId(): string | null {
        return this.selected.size === 1 ? (this.selected.values().next().value ?? null) : null
    }
    has(nodeId: string): boolean {
        return this.selected.has(nodeId)
    }

    replace(
        nodeIds: Iterable<string>,
        fromMarquee = false,
    ): ReadonlySet<string> {
        const previous = this.selected
        this.selected = new Set(nodeIds)
        this.marquee = fromMarquee && this.selected.size > 0

        return previous
    }

    toggle(nodeId: string): ReadonlySet<string> {
        const next = new Set(this.selected)

        if (next.has(nodeId))
            next.delete(nodeId)
        else
            next.add(nodeId)

        return this.replace(next)
    }

    remove(nodeId: string): void {
        if (!this.selected.has(nodeId))
            return

        const next = new Set(this.selected)
        next.delete(nodeId)
        this.replace(next, this.marquee)
    }

    clear(): void {
        this.replace([])
    }
}
