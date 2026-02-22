import { Plugin, EditorState, Transaction, TextSelection } from 'prosemirror-state'
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

import { AI_PROMPT_INPUT_PLUGIN_KEY, SUBMIT_AI_PROMPT_META, STOP_AI_PROMPT_META } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputPluginConstants.ts'
import { aiPromptInputNodeType, createAiPromptInputNodeView } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'

type SubmitHandler = (data: {
    contentJSON: any[]
    aiModel: string
    imageOptions?: {
        imageGenerationEnabled: boolean
        imageGenerationSize: string
    }
}) => void

type StopHandler = () => void

type AiPromptInputPluginOptions = {
    onSubmit: SubmitHandler
    onStop: StopHandler
    isReceiving: () => boolean
    createModelDropdown: Parameters<typeof createAiPromptInputNodeView>[0]['createModelDropdown']
    createImageSizeDropdown: Parameters<typeof createAiPromptInputNodeView>[0]['createImageSizeDropdown']
    createSubmitButton: Parameters<typeof createAiPromptInputNodeView>[0]['createSubmitButton']
    placeholderText: string
}

class KeyboardHandler {
    static isModEnter(event: KeyboardEvent): boolean {
        return (event.metaKey || event.ctrlKey) && event.key === 'Enter'
    }
}

function extractContentJSON(state: EditorState): any[] | null {
    // Find the aiPromptInput node and extract its content as JSON
    let inputNode: ProseMirrorNode | null = null
    state.doc.descendants((node: ProseMirrorNode) => {
        if (node.type.name === aiPromptInputNodeType) {
            inputNode = node
            return false
        }
    })

    if (!inputNode) return null
    if ((inputNode as ProseMirrorNode).textContent.trim() === '') return null

    // Convert content to JSON array
    const content: any[] = []
    ;(inputNode as ProseMirrorNode).content.forEach((child: ProseMirrorNode) => {
        content.push(child.toJSON())
    })

    return content
}

function getInputAttrs(state: EditorState): { aiModel: string; imageGenerationSize: string } {
    let attrs = { aiModel: '', imageGenerationSize: 'auto' }
    state.doc.descendants((node: ProseMirrorNode) => {
        if (node.type.name === aiPromptInputNodeType) {
            attrs = {
                aiModel: node.attrs.aiModel || '',
                imageGenerationSize: node.attrs.imageGenerationSize || 'auto',
            }
            return false
        }
    })
    return attrs
}

function clearInputContent(view: EditorView): void {
    const { state } = view
    const paragraphType = state.schema.nodes.paragraph

    let inputPos = -1
    let inputNode: ProseMirrorNode | null = null

    state.doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (node.type.name === aiPromptInputNodeType) {
            inputPos = pos
            inputNode = node
            return false
        }
    })

    if (inputPos === -1 || !inputNode) return

    const emptyParagraph = paragraphType.createAndFill()
    if (!emptyParagraph) return

    const contentFrom = inputPos + 1
    const contentTo = inputPos + (inputNode as ProseMirrorNode).nodeSize - 1

    let tr = state.tr.replaceWith(contentFrom, contentTo, emptyParagraph)

    // Place cursor at start of the empty paragraph
    const cursorPos = inputPos + 2
    tr = tr.setSelection(TextSelection.create(tr.doc, cursorPos))

    view.dispatch(tr)
}

export function createAiPromptInputPlugin(options: AiPromptInputPluginOptions): Plugin {
    const {
        onSubmit,
        onStop,
        isReceiving,
        createModelDropdown,
        createImageSizeDropdown,
        createSubmitButton,
        placeholderText,
    } = options

    const handleSubmit = (view: EditorView) => {
        const contentJSON = extractContentJSON(view.state)
        if (!contentJSON) return

        const attrs = getInputAttrs(view.state)

        onSubmit({
            contentJSON,
            aiModel: attrs.aiModel,
            imageOptions: {
                imageGenerationEnabled: true,
                imageGenerationSize: attrs.imageGenerationSize,
            },
        })

        clearInputContent(view)
    }

    let editorViewRef: EditorView | null = null

    return new Plugin({
        key: AI_PROMPT_INPUT_PLUGIN_KEY,

        state: {
            init: () => ({ decorations: DecorationSet.empty }),
            apply: (tr: Transaction, prev: { decorations: DecorationSet }) => {
                return {
                    decorations: prev.decorations.map(tr.mapping, tr.doc),
                }
            },
        },

        props: {
            handleDOMEvents: {
                keydown: (_view: EditorView, event: KeyboardEvent) => {
                    if (KeyboardHandler.isModEnter(event)) {
                        event.preventDefault()
                        handleSubmit(_view)
                        return true
                    }
                    return false
                },
            },

            decorations: (state: EditorState) => {
                const decorations: Decoration[] = []

                state.doc.descendants((node: ProseMirrorNode, pos: number) => {
                    if (node.type.name === aiPromptInputNodeType && node.textContent.trim() === '') {
                        decorations.push(
                            Decoration.node(pos, pos + node.nodeSize, {
                                class: 'empty-node-placeholder',
                                'data-placeholder': placeholderText,
                            })
                        )
                    }
                })

                return DecorationSet.create(state.doc, decorations)
            },

            nodeViews: {
                [aiPromptInputNodeType]: createAiPromptInputNodeView({
                    onSubmit: () => {
                        if (editorViewRef) handleSubmit(editorViewRef)
                    },
                    onStop,
                    isReceiving,
                    createModelDropdown,
                    createImageSizeDropdown,
                    createSubmitButton,
                }),
            },
        },

        view: (editorView: EditorView) => {
            editorViewRef = editorView
            return {
                update: () => {},
                destroy: () => {
                    editorViewRef = null
                },
            }
        },

        appendTransaction: (transactions: Transaction[], _oldState: EditorState, newState: EditorState) => {
            // Handle submit meta if dispatched
            const submitTx = transactions.find(tr => tr.getMeta(SUBMIT_AI_PROMPT_META))
            if (submitTx) {
                const contentJSON = extractContentJSON(newState)
                if (contentJSON) {
                    const attrs = getInputAttrs(newState)
                    onSubmit({
                        contentJSON,
                        aiModel: attrs.aiModel,
                        imageOptions: {
                            imageGenerationEnabled: true,
                            imageGenerationSize: attrs.imageGenerationSize,
                        },
                    })
                }
            }

            // Handle stop meta if dispatched
            const stopTx = transactions.find(tr => tr.getMeta(STOP_AI_PROMPT_META))
            if (stopTx) {
                onStop()
            }

            return null
        },
    })
}
