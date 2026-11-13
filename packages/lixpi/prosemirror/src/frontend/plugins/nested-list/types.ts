import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import {
    type Command,
    type EditorState,
    type Transaction,
} from 'prosemirror-state'
import {
    type NodeViewConstructor,
    type EditorView,
} from 'prosemirror-view'

export type NestedListMode = 'view' | 'edit'
export type NestedListTag = {
    name: string
    color: string
}
export type NestedListChange = {
    previous: ProseMirrorNode
    document: ProseMirrorNode
    transactions: readonly Transaction[]
}
export type NestedListActivation = {
    entryId: string
    node: ProseMirrorNode
    event: MouseEvent | KeyboardEvent
}
export type NestedListMove = {
    entryId: string
    targetEntryId: string
    placement: 'before' | 'after' | 'inside'
}
export type NestedListBlockContext = {
    entryId: string
    node: ProseMirrorNode
    label: ProseMirrorNode
    isListItem: boolean
}
export type NestedListBlockMenuItem = {
    label: string
    icon?: string
    checked?: boolean
    disabled?: boolean
    entersEdit?: boolean
    children?: () => NestedListBlockMenuItem[]
    onSelect?: () => void | Promise<void>
}
export type NestedListBlockMenuExtension = {
    insert?: NestedListBlockMenuItem[]
    actions?: NestedListBlockMenuItem[]
}

export type NestedListPluginOptions = {
    scrollContainer?: () => HTMLElement | null
    isEditable?: () => boolean
    readOnly?: boolean
    itemViews?: Readonly<Record<string, NodeViewConstructor>>
    // A registered command owns Enter in its item title, including refusal.
    itemEnter?: Readonly<Record<string, Command>>
    blockMenu?: (context: NestedListBlockContext) => NestedListBlockMenuExtension | null
    tags?: () => Readonly<Record<string, NestedListTag>>
    filterTransaction?: (
        transaction: Transaction,
        state: EditorState,
    ) => boolean
    onChange?: (change: NestedListChange) => void
    onActivate?: (activation: NestedListActivation) => void
    onCollapseChange?: (
        entryId: string,
        collapsed: boolean,
    ) => void
    collapsed?: () => ReadonlySet<string>
    onEnterEdit?: () => void
    onExitEdit?: () => void
    controlOwnerId?: string
}
export type MountNestedListOptions = {
    scrollContainer?: () => HTMLElement | null
    container: HTMLElement
    document?: unknown
    readOnly?: boolean
    itemViews?: NestedListPluginOptions['itemViews']
    itemEnter?: NestedListPluginOptions['itemEnter']
    blockMenu?: NestedListPluginOptions['blockMenu']
    tags?: Readonly<Record<string, NestedListTag>>
    filterTransaction?: NestedListPluginOptions['filterTransaction']
    onChange?: NestedListPluginOptions['onChange']
    onActivate?: NestedListPluginOptions['onActivate']
    onCollapseChange?: NestedListPluginOptions['onCollapseChange']
    collapsed?: Iterable<string>
    onModeChange?: (mode: NestedListMode) => void
}
export type NestedListHandle = {
    readonly view: EditorView
    readonly mode: NestedListMode
    readonly collapsed: ReadonlySet<string>
    enterEdit: () => boolean
    exitEdit: () => boolean
    // A host must retain a deferred update and resolve it before replacing local edits.
    setDocument: (json: unknown) => 'applied' | 'unchanged' | 'deferred'
    setTags: (tags: Readonly<Record<string, NestedListTag>>) => void
    setActive: (entryId: string | undefined) => void
    setCollapsed: (ids: Iterable<string>) => void
    move: (move: NestedListMove) => boolean
    destroy: () => void
}
