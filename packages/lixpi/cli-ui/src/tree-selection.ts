// One option of a horizontal radio row. A row whose choices carry no selection is
// independent of the tree.
export type TreeChoice = {
    value: string
    label: string
    hint?: string

    // Makes this a preset choice. Choosing it replaces the tree's selection with these
    // services, and the row shows the choice whose services the tree holds, so its
    // mark follows changes made in the tree. When none matches, the row shows its
    // choice with an empty selection, which stands for a custom pick.
    selection?: string[]
}

export type TreeNode = {
    value: string
    label: string
    hint?: string
    children?: TreeNode[]

    // Makes this a top-level radio row, drawn as `Label  o One / * Two`. It isn't a
    // selectable item itself.
    choices?: TreeChoice[]

    // Holds a radio row on its first choice and is shown in place of the choice's
    // hint, saying why the row can't change.
    locked?: string
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

        const presets = this.roots.filter(root => this.isPresetRow(root)).map(root => this.activeChoice(root))
        const preset = presets.find(choice => choice.selection?.length)

        return [
            ...this.independentRows().map(root => `${root.label}: ${this.activeChoice(root).label}`),
            ...(preset ? [preset.label] : this.serviceRoots().flatMap(summarize)),
        ]
    }

    activeChoice(node: TreeNode): TreeChoice {
        const choices = node.choices ?? []

        if (this.isPresetRow(node))
            return choices.find(choice => this.matches(choice.selection ?? []))
                ?? choices.find(choice => !choice.selection?.length)
                ?? choices[0]

        return choices.find(choice => choice.value === this.chosen.get(node.value)) ?? choices[0]
    }

    switchChoice(
        node: TreeNode,
        direction: 1 | -1,
    ): void {
        if (node.locked)
            return

        const choices = node.choices ?? []
        const current = choices.indexOf(
            this.activeChoice(node),
        )
        const next = choices[(current + direction + choices.length) % choices.length]

        if (this.isPresetRow(node)) {
            this.selected.clear()

            for (const value of next.selection ?? [])
                this.selected.add(value)

            return
        }

        this.chosen.set(node.value, next.value)
    }

    // The chosen values of rows that are independent of the tree. A preset row only
    // changes the tree, so its value is the selected services.
    selectedOptions(): string[] {
        return this.independentRows().map(root => this.activeChoice(root).value)
    }

    private isPresetRow(node: TreeNode): boolean {
        return Boolean(node.choices?.some(choice => choice.selection))
    }

    private independentRows(): TreeNode[] {
        return this.roots.filter(root => root.choices && !this.isPresetRow(root))
    }

    private serviceRoots(): TreeNode[] {
        return this.roots.filter(root => !root.choices)
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
