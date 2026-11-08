// One option of a horizontal radio row. The row is independent of the tree.
export type TreeChoice = {
    value: string
    label: string
    hint?: string
}

export type TreeNode = {
    value: string
    label: string
    hint?: string
    children?: TreeNode[]

    // Makes this a top-level radio row, drawn as `Label  o One / * Two`. It isn't a
    // selectable item itself.
    choices?: TreeChoice[]

    // Makes this a preset row inside the tree, drawn with a radio mark. Space applies
    // this exact selection, and the mark is filled while the tree matches it.
    selection?: string[]
}

export type SelectionState = 'all' | 'some' | 'none'

export type TreeRow = {
    node: TreeNode
    parent?: TreeNode

    // One entry per ancestor below the root: whether that ancestor has a later
    // sibling, which decides if its vertical guide continues through this row.
    guides: boolean[]
    depth: number
    isLast: boolean
}

// Selection is stored on leaves only. A group's state is always derived from its
// leaves, so a group and its members can never disagree.
export class TreeSelection {
    private readonly selected: Set<string>
    private readonly collapsed = new Set<string>()
    private readonly chosen = new Map<string, string>()

    constructor(
        readonly roots: TreeNode[],
        initiallySelected: string[],
    ) {
        this.selected = new Set(initiallySelected)
    }

    rows(): TreeRow[] {
        const rows: TreeRow[] = []

        const visit = (
            nodes: TreeNode[],
            parent: TreeNode | undefined,
            guides: boolean[],
            depth: number,
        ): void => {
            nodes.forEach((node, index) => {
                const isLast = index === nodes.length - 1

                rows.push({
                    node,
                    parent,
                    guides,
                    depth,
                    isLast,
                })

                if (
                    node.children
                    && !this.isCollapsed(node)
                )
                    visit(
                        node.children,
                        node,
                        depth === 0 ? [] : [...guides, !isLast],
                        depth + 1,
                    )
            })
        }

        visit(
            this.roots,
            undefined,
            [],
            0,
        )

        return rows
    }

    stateOf(node: TreeNode): SelectionState {
        if (node.selection)
            return this.matches(node.selection) ? 'all' : 'none'

        const leaves = this.leavesOf(node)
        const selectedCount = leaves.filter(leaf => this.selected.has(leaf)).length

        if (selectedCount === 0)
            return 'none'

        return selectedCount === leaves.length ? 'all' : 'some'
    }

    // A partly selected group becomes fully selected first, matching how a parent
    // checkbox behaves in a file tree.
    toggle(node: TreeNode): void {
        if (node.choices) {
            this.switchChoice(node, 1)

            return
        }

        if (node.selection) {
            this.selected.clear()

            for (const value of node.selection)
                this.selected.add(value)

            return
        }

        const shouldSelect = this.stateOf(node) !== 'all'

        for (const leaf of this.leavesOf(node)) {
            if (shouldSelect)
                this.selected.add(leaf)
            else
                this.selected.delete(leaf)
        }
    }

    isCollapsed(node: TreeNode): boolean {
        return this.collapsed.has(node.value)
    }

    setCollapsed(
        node: TreeNode,
        collapsed: boolean,
    ): void {
        if (collapsed)
            this.collapsed.add(node.value)
        else
            this.collapsed.delete(node.value)
    }

    selectedLeaves(): string[] {
        return this.serviceRoots().flatMap(root => this.leavesOf(root)).filter(leaf => this.selected.has(leaf))
    }

    // Names the largest fully selected nodes instead of listing every leaf.
    summary(): string[] {
        const summarize = (node: TreeNode): string[] => {
            const state = this.stateOf(node)

            if (state === 'none')
                return []

            return state === 'all' ? [node.label] : (node.children ?? []).flatMap(summarize)
        }

        const preset = this.roots.find(root => root.selection && this.matches(root.selection))

        return [
            ...this.roots.filter(root => root.choices).map(root => `${root.label}: ${this.activeChoice(root).label}`),
            ...(preset ? [preset.label] : this.serviceRoots().flatMap(summarize)),
        ]
    }

    activeChoice(node: TreeNode): TreeChoice {
        const choices = node.choices ?? []

        return choices.find(choice => choice.value === this.chosen.get(node.value)) ?? choices[0]
    }

    switchChoice(
        node: TreeNode,
        direction: 1 | -1,
    ): void {
        const choices = node.choices ?? []
        const current = choices.indexOf(
            this.activeChoice(node),
        )

        this.chosen.set(node.value, choices[(current + direction + choices.length) % choices.length].value)
    }

    // The chosen values of rows that are independent of the tree.
    selectedOptions(): string[] {
        return this.roots.filter(root => root.choices).map(root => this.activeChoice(root).value)
    }

    private serviceRoots(): TreeNode[] {
        return this.roots.filter(root => !root.choices && !root.selection)
    }

    private matches(values: string[]): boolean {
        return values.length === this.selected.size && values.every(value => this.selected.has(value))
    }

    private leavesOf(node: TreeNode): string[] {
        return node.children
            ? node.children.flatMap(child => this.leavesOf(child))
            : [node.value]
    }
}
