import { EditorState as CodeMirrorEditorState } from '@codemirror/state'
import {
    drawSelection,
    EditorView as CodeMirrorEditorView,
    highlightSpecialChars,
    keymap as codeMirrorKeymap,
    lineNumbers,
    type KeyBinding,
    type ViewUpdate,
} from '@codemirror/view'
import {
    defaultKeymap,
    indentWithTab,
} from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import {
    defaultHighlightStyle,
    syntaxHighlighting,
} from '@codemirror/language'
import { html } from '@lixpi/ui-primitives/dom'
import { exitCode } from 'prosemirror-commands'
import {
    InputRule,
    inputRules,
} from 'prosemirror-inputrules'
import {
    redo,
    undo,
} from 'prosemirror-history'
import {
    Plugin,
    PluginKey,
    Selection,
    TextSelection,
    type EditorState,
    type Transaction,
} from 'prosemirror-state'
import {
    type Node as ProseMirrorNode,
    type NodeType,
    type Schema,
} from 'prosemirror-model'
import {
    Decoration,
    DecorationSet,
    type EditorView,
    type NodeView,
} from 'prosemirror-view'

import { gruvboxLight } from '$src/components/proseMirror/themes/cm6-themes/packages/gruvbox-light/src/index.ts'

type CodeBlockTransactionMeta = {
    type: NodeType
    start: number
    end: number
    theme?: string
}

const pluginKey = new PluginKey<undefined>('codeBlockPlugin')
const transactionName = 'insertCodeBlock'
const codeBlockViews = new WeakMap<Node, CodeBlockView>()

class CodeBlockView implements NodeView {
    readonly dom: HTMLElement

    private node: ProseMirrorNode
    private readonly codeMirror: CodeMirrorEditorView
    private updating = false

    constructor(
        node: ProseMirrorNode,
        private readonly view: EditorView,
        private readonly getPos: () => number | undefined,
        private readonly schema: Schema,
    ) {
        this.node = node
        this.dom = html`<div className="code-block-wrapper"></div>` as HTMLDivElement
        this.codeMirror = new CodeMirrorEditorView({
            state: CodeMirrorEditorState.create({
                doc: node.textContent,
                extensions: [
                    gruvboxLight,
                    codeMirrorKeymap.of([
                        ...this.createCodeMirrorKeymap(),
                        ...defaultKeymap,
                        indentWithTab,
                    ]),
                    drawSelection(),
                    syntaxHighlighting(defaultHighlightStyle),
                    javascript(),
                    highlightSpecialChars(),
                    CodeMirrorEditorView.lineWrapping,
                    CodeMirrorEditorState.allowMultipleSelections.of(true),
                    CodeMirrorEditorView.updateListener.of(this.forwardUpdate),
                    lineNumbers(),
                ],
            }),
            parent: this.dom,
        })
        codeBlockViews.set(this.dom, this)
        this.codeMirror.dom.addEventListener('mouseup', this.handleMouseUp)
    }

    private readonly handleMouseUp = (): void => {
        if (this.updating || !this.codeMirror.hasFocus) {
            return
        }
        if (this.codeMirror.state.selection.ranges.some((range) => !range.empty)) {
            return
        }
        this.clearAllCodeMirrorSelections()
        this.syncProseMirrorSelection()
    }

    private clearAllCodeMirrorSelections(): void {
        this.view.state.doc.descendants((node, position) => {
            if (node.type.name !== 'code_block') {
                return undefined
            }
            const codeBlockView = getCodeBlockView(this.view.nodeDOM(position))
            const cursor = codeBlockView?.codeMirror.state.selection.main.head
            if (codeBlockView && cursor !== undefined) {
                codeBlockView.codeMirror.dispatch({ selection: { anchor: cursor, head: cursor } })
            }
            return undefined
        })
    }

    private clearOtherCodeMirrorSelections(): void {
        const currentPosition = this.getPos()
        this.view.state.doc.descendants((node, position) => {
            if (node.type.name !== 'code_block' || position === currentPosition) {
                return undefined
            }
            const codeBlockView = getCodeBlockView(this.view.nodeDOM(position))
            if (!codeBlockView || codeBlockView === this) {
                return undefined
            }
            const cursor = codeBlockView.codeMirror.state.selection.main.head
            codeBlockView.codeMirror.dispatch({ selection: { anchor: cursor, head: cursor } })
            return undefined
        })
    }

    private syncProseMirrorSelection(): void {
        const position = this.getPos()
        if (position === undefined) {
            return
        }
        const {
            from,
            to,
        } = this.view.state.selection
        const start = position + 1
        const end = position + this.node.nodeSize - 1
        if (from < start || to > end) {
            return
        }
        this.codeMirror.dispatch({
            selection: {
                anchor: from - start,
                head: to - start,
            },
        })
    }

    private readonly forwardUpdate = (update: ViewUpdate): void => {
        if (this.updating || !this.codeMirror.hasFocus) {
            return
        }
        const position = this.getPos()
        if (position === undefined) {
            return
        }

        let offset = position + 1
        const selection = update.state.selection.main
        const selectionFrom = offset + selection.from
        const selectionTo = offset + selection.to
        const proseMirrorSelection = this.view.state.selection
        if (
            !update.docChanged
            && proseMirrorSelection.from === selectionFrom
            && proseMirrorSelection.to === selectionTo
        ) {
            return
        }

        const transaction = this.view.state.tr
        update.changes.iterChanges((fromA, toA, fromB, toB, text) => {
            if (text.length > 0) {
                transaction.replaceWith(offset + fromA, offset + toA, this.schema.text(text.toString()))
                return
            }
            transaction.delete(offset + fromA, offset + toA)
            offset += toB - fromB - (toA - fromA)
        })
        transaction.setSelection(TextSelection.create(transaction.doc, selectionFrom, selectionTo))
        this.view.dispatch(transaction)
    }

    private maybeEscape(unit: 'line' | 'character', direction: -1 | 1): boolean {
        const state = this.codeMirror.state
        const selection = state.selection.main
        if (!selection.empty) {
            return false
        }
        const range = unit === 'line' ? state.doc.lineAt(selection.head) : selection
        if (direction < 0 ? range.from > 0 : range.to < state.doc.length) {
            return false
        }
        const position = this.getPos()
        if (position === undefined) {
            return false
        }
        const targetPosition = position + (direction < 0 ? 0 : this.node.nodeSize)
        const proseMirrorSelection = Selection.near(this.view.state.doc.resolve(targetPosition), direction)
        this.view.dispatch(this.view.state.tr.setSelection(proseMirrorSelection).scrollIntoView())
        this.view.focus()
        return true
    }

    private createCodeMirrorKeymap(): KeyBinding[] {
        return [
            { key: 'ArrowUp', run: () => this.maybeEscape('line', -1) },
            { key: 'ArrowLeft', run: () => this.maybeEscape('character', -1) },
            { key: 'ArrowDown', run: () => this.maybeEscape('line', 1) },
            { key: 'Shift-Enter', run: () => this.maybeEscape('line', 1) },
            { key: 'ArrowRight', run: () => this.maybeEscape('character', 1) },
            { key: 'Mod-a', run: () => this.selectAllCommand() },
            {
                key: 'Mod-Enter',
                run: () => {
                    if (!exitCode(this.view.state, this.view.dispatch)) {
                        return false
                    }
                    this.view.focus()
                    return true
                },
            },
            { key: 'Mod-z', run: () => undo(this.view.state, this.view.dispatch) },
            { key: 'Mod-Shift-z', run: () => redo(this.view.state, this.view.dispatch) },
            {
                key: 'Mod-y',
                mac: 'Mod-Shift-z',
                run: () => redo(this.view.state, this.view.dispatch),
            },
        ]
    }

    private selectAllCommand(): boolean {
        this.codeMirror.dispatch({ selection: { anchor: 0, head: this.codeMirror.state.doc.length } })
        this.view.dispatch(
            this.view.state.tr.setSelection(
                TextSelection.create(this.view.state.doc, 0, this.view.state.doc.content.size),
            ),
        )
        this.view.focus()
        return true
    }

    selectAll(): void {
        this.codeMirror.dispatch({ selection: { anchor: 0, head: this.codeMirror.state.doc.length } })
    }

    clearSelection(): void {
        const cursor = this.codeMirror.state.selection.main.head
        this.codeMirror.dispatch({ selection: { anchor: cursor, head: cursor } })
    }

    update(node: ProseMirrorNode): boolean {
        if (node.type !== this.node.type) {
            return false
        }
        if (this.updating) {
            return true
        }
        this.node = node
        const nextText = node.textContent
        const currentText = this.codeMirror.state.doc.toString()
        if (nextText === currentText) {
            return true
        }

        let start = 0
        let currentEnd = currentText.length
        let nextEnd = nextText.length
        while (start < currentEnd && currentText.charCodeAt(start) === nextText.charCodeAt(start)) start += 1
        while (
            currentEnd > start
            && nextEnd > start
            && currentText.charCodeAt(currentEnd - 1) === nextText.charCodeAt(nextEnd - 1)
        ) {
            currentEnd -= 1
            nextEnd -= 1
        }

        this.updating = true
        this.codeMirror.dispatch({
            changes: {
                from: start,
                to: currentEnd,
                insert: nextText.slice(start, nextEnd),
            },
        })
        this.updating = false
        return true
    }

    stopEvent(event: Event): boolean {
        if (event.type === 'mousedown' && !this.codeMirror.dom.contains(event.target as Node)) {
            this.clearOtherCodeMirrorSelections()
        }
        return true
    }

    destroy(): void {
        this.codeMirror.dom.removeEventListener('mouseup', this.handleMouseUp)
        codeBlockViews.delete(this.dom)
        this.codeMirror.destroy()
        this.dom.remove()
    }
}

const getCodeBlockView = (node: Node | null): CodeBlockView | undefined => (node ? codeBlockViews.get(node) : undefined)

const clearAllCodeMirrorSelections = (view: EditorView): void => {
    view.state.doc.descendants((node, position) => {
        if (node.type.name !== 'code_block') {
            return undefined
        }
        const codeBlockView = getCodeBlockView(view.nodeDOM(position))
        codeBlockView?.clearSelection()
        return undefined
    })
}

const selectAllContentIncludingCodeBlocks = (view: EditorView): void => {
    const transaction = view.state.tr.setSelection(
        TextSelection.create(view.state.doc, 0, view.state.doc.content.size),
    )
    view.dispatch(transaction)
    transaction.doc.descendants((node, position) => {
        if (node.type.name !== 'code_block') {
            return undefined
        }
        getCodeBlockView(view.nodeDOM(position))?.selectAll()
        return undefined
    })
    view.focus()
}

export const createCodeBlockPlugin = (schema: Schema): Plugin =>
    new Plugin({
        key: pluginKey,
        props: {
            decorations: (state) => {
                const decorations: Decoration[] = []
                state.doc.descendants((node, position) => {
                    if (node.type.name !== 'code_block') {
                        return undefined
                    }
                    const from = position + 1
                    const to = from + node.content.size
                    if (state.selection.from >= to || state.selection.to <= from) {
                        return undefined
                    }
                    decorations.push(
                        Decoration.inline(
                            Math.max(state.selection.from, from),
                            Math.min(state.selection.to, to),
                            { class: 'selected' },
                        ),
                    )
                    return undefined
                })
                return DecorationSet.create(state.doc, decorations)
            },
            nodeViews: {
                code_block: (node, view, getPos): NodeView => new CodeBlockView(node, view, getPos, schema),
            },
            handleDOMEvents: {
                mousedown: (view) => {
                    clearAllCodeMirrorSelections(view)
                    return false
                },
                keydown: (view, event) => {
                    if (
                        event.key !== 'a'
                        || (!event.ctrlKey && !event.metaKey)
                    ) {
                        return false
                    }
                    selectAllContentIncludingCodeBlocks(view)
                    event.preventDefault()
                    return true
                },
            },
        },
        appendTransaction: (transactions, _oldState, newState) => {
            let outputTransaction: Transaction | null = null
            for (const transaction of transactions) {
                const meta = transaction.getMeta(transactionName) as CodeBlockTransactionMeta | undefined
                if (!meta) {
                    continue
                }
                const codeBlock = meta.type.createAndFill({ theme: meta.theme })
                if (!codeBlock) {
                    continue
                }
                outputTransaction = newState.tr.replaceWith(meta.start, meta.end, codeBlock).scrollIntoView()
            }
            return outputTransaction
        },
    })

export const codeBlockInputRulef = (schema: Schema): Plugin =>
    inputRules({
        rules: [
            new InputRule(/^```$/, (state, _match, start, end) =>
                state.tr.setMeta(
                    transactionName,
                    {
                        type: schema.nodes.code_block,
                        start,
                        end,
                        theme: 'gruvboxDark',
                    } satisfies CodeBlockTransactionMeta,
                )),
        ],
    })

const ensureEmptyLineAfterNode = (
    transaction: Transaction,
    nodeType: string,
    schema: Schema,
): Transaction => {
    let positionAfterNode: number | undefined
    transaction.doc.descendants((node, position) => {
        if (node.type.name === nodeType) {
            positionAfterNode = position + node.nodeSize
        }
    })
    if (positionAfterNode === undefined) {
        return transaction
    }

    const nextNode = transaction.doc.nodeAt(positionAfterNode)
    if (nextNode?.type.name === 'paragraph' && nextNode.textContent === '') {
        return transaction
    }
    const paragraph = schema.nodes.paragraph.createAndFill()
    if (paragraph) {
        transaction.insert(positionAfterNode, paragraph)
    }
    return transaction
}

export const codeBlockInputRule = (schema: Schema): Plugin =>
    inputRules({
        rules: [
            new InputRule(/^```$/, (state: EditorState, _match, start) => {
                const startPosition = state.doc.resolve(start)
                const paragraphStart = startPosition.before(startPosition.depth)
                const paragraphEnd = startPosition.after(startPosition.depth)
                const codeBlock = state.schema.nodes.code_block.createAndFill({ theme: 'gruvboxDark' })
                if (!codeBlock) {
                    return null
                }
                const transaction = state.tr.replaceWith(paragraphStart, paragraphEnd, codeBlock)
                return ensureEmptyLineAfterNode(transaction, 'code_block', schema)
            }),
        ],
    })
