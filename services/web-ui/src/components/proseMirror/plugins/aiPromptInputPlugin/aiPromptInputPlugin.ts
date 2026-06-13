import { Plugin, EditorState, Transaction, TextSelection } from 'prosemirror-state'
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

import { AI_PROMPT_INPUT_PLUGIN_KEY, SUBMIT_AI_PROMPT_META, STOP_AI_PROMPT_META } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputPluginConstants.ts'
import { aiPromptInputNodeType, createAiPromptInputNodeView, parseAiModelSelectionAttr } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'

type SubmitHandler = (data: {
    contentJSON: any[]
    aiModel: string
    aiModels: string[]
    useMultipleModels: boolean
    useMultipleReasoningModels: boolean
    useMultipleImageModels: boolean
    useMultipleVideoModels: boolean
    imageOptions?: {
        aiImageModel?: string
        aiImageModels?: string[]
        imageGenerationSize: string
    }
    videoOptions?: {
        aiVideoModel?: string
        aiVideoModels?: string[]
        videoAspectRatio?: string
        videoResolution?: string
        videoDuration?: string
    }
}) => void

type StopHandler = () => void

type AiPromptInputPluginOptions = {
    onSubmit: SubmitHandler
    onStop: StopHandler
    isReceiving: () => boolean
    createContextTray?: Parameters<typeof createAiPromptInputNodeView>[0]['createContextTray']
    createModelDropdown: Parameters<typeof createAiPromptInputNodeView>[0]['createModelDropdown']
    createModelMultiSelect?: Parameters<typeof createAiPromptInputNodeView>[0]['createModelMultiSelect']
    createImageModelDropdown: Parameters<typeof createAiPromptInputNodeView>[0]['createImageModelDropdown']
    createImageModelMultiSelect?: Parameters<typeof createAiPromptInputNodeView>[0]['createImageModelMultiSelect']
    createImageSizeDropdown: Parameters<typeof createAiPromptInputNodeView>[0]['createImageSizeDropdown']
    createVideoModelDropdown: Parameters<typeof createAiPromptInputNodeView>[0]['createVideoModelDropdown']
    createVideoModelMultiSelect?: Parameters<typeof createAiPromptInputNodeView>[0]['createVideoModelMultiSelect']
    createVideoAspectDropdown: Parameters<typeof createAiPromptInputNodeView>[0]['createVideoAspectDropdown']
    createVideoResolutionDropdown: Parameters<typeof createAiPromptInputNodeView>[0]['createVideoResolutionDropdown']
    createVideoDurationDropdown: Parameters<typeof createAiPromptInputNodeView>[0]['createVideoDurationDropdown']
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

type InputAttrs = {
    aiModel: string
    aiModels: string[]
    useMultipleModels: boolean
    useMultipleReasoningModels: boolean
    useMultipleImageModels: boolean
    useMultipleVideoModels: boolean
    aiImageModel: string
    aiImageModels: string[]
    imageGenerationSize: string
    aiVideoModel: string
    aiVideoModels: string[]
    videoAspectRatio: string
    videoResolution: string
    videoDuration: string
}

function getInputAttrs(state: EditorState): InputAttrs {
    let attrs: InputAttrs = {
        aiModel: '',
        aiModels: [],
        useMultipleModels: false,
        useMultipleReasoningModels: false,
        useMultipleImageModels: false,
        useMultipleVideoModels: false,
        aiImageModel: '',
        aiImageModels: [],
        imageGenerationSize: 'auto',
        aiVideoModel: '',
        aiVideoModels: [],
        videoAspectRatio: '',
        videoResolution: '',
        videoDuration: '',
    }
    state.doc.descendants((node: ProseMirrorNode) => {
        if (node.type.name === aiPromptInputNodeType) {
            const legacyUseMultipleModels = node.attrs.useMultipleModels === true || node.attrs.useMultipleModels === 'true'
            const rawUseMultipleReasoningModels = node.attrs.useMultipleReasoningModels === true || node.attrs.useMultipleReasoningModels === 'true'
            const rawUseMultipleImageModels = node.attrs.useMultipleImageModels === true || node.attrs.useMultipleImageModels === 'true'
            const rawUseMultipleVideoModels = node.attrs.useMultipleVideoModels === true || node.attrs.useMultipleVideoModels === 'true'
            const hasSectionModelMode = rawUseMultipleReasoningModels || rawUseMultipleImageModels || rawUseMultipleVideoModels
            const useLegacyModeFallback = legacyUseMultipleModels && !hasSectionModelMode
            attrs = {
                aiModel: node.attrs.aiModel || '',
                aiModels: parseAiModelSelectionAttr(node.attrs.aiModels),
                useMultipleModels: legacyUseMultipleModels,
                useMultipleReasoningModels: rawUseMultipleReasoningModels || useLegacyModeFallback,
                useMultipleImageModels: rawUseMultipleImageModels || useLegacyModeFallback,
                useMultipleVideoModels: rawUseMultipleVideoModels || useLegacyModeFallback,
                aiImageModel: node.attrs.aiImageModel || '',
                aiImageModels: parseAiModelSelectionAttr(node.attrs.aiImageModels),
                imageGenerationSize: node.attrs.imageGenerationSize || 'auto',
                aiVideoModel: node.attrs.aiVideoModel || '',
                aiVideoModels: parseAiModelSelectionAttr(node.attrs.aiVideoModels),
                videoAspectRatio: node.attrs.videoAspectRatio || '',
                videoResolution: node.attrs.videoResolution || '',
                videoDuration: node.attrs.videoDuration || '',
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
        createContextTray,
        createModelDropdown,
        createModelMultiSelect,
        createImageModelDropdown,
        createImageModelMultiSelect,
        createImageSizeDropdown,
        createVideoModelDropdown,
        createVideoModelMultiSelect,
        createVideoAspectDropdown,
        createVideoResolutionDropdown,
        createVideoDurationDropdown,
        createSubmitButton,
        placeholderText,
    } = options

    const buildSubmitPayload = (contentJSON: any[], attrs: InputAttrs) => {
        const aiModels = attrs.useMultipleReasoningModels
            ? (attrs.aiModels.length > 0 ? attrs.aiModels : attrs.aiModel ? [attrs.aiModel] : [])
            : []
        const aiImageModels = attrs.useMultipleImageModels
            ? (attrs.aiImageModels.length > 0 ? attrs.aiImageModels : attrs.aiImageModel ? [attrs.aiImageModel] : [])
            : []
        const aiVideoModels = attrs.useMultipleVideoModels
            ? (attrs.aiVideoModels.length > 0 ? attrs.aiVideoModels : attrs.aiVideoModel ? [attrs.aiVideoModel] : [])
            : []
        const useMultipleModels = attrs.useMultipleReasoningModels
            || attrs.useMultipleImageModels
            || attrs.useMultipleVideoModels

        return {
            contentJSON,
            aiModel: attrs.aiModel,
            aiModels,
            useMultipleModels,
            useMultipleReasoningModels: attrs.useMultipleReasoningModels,
            useMultipleImageModels: attrs.useMultipleImageModels,
            useMultipleVideoModels: attrs.useMultipleVideoModels,
            imageOptions: {
                aiImageModel: attrs.aiImageModel,
                aiImageModels,
                imageGenerationSize: attrs.imageGenerationSize,
            },
            videoOptions: {
                aiVideoModel: attrs.aiVideoModel,
                aiVideoModels,
                videoAspectRatio: attrs.videoAspectRatio,
                videoResolution: attrs.videoResolution,
                videoDuration: attrs.videoDuration,
            },
        }
    }

    const handleSubmit = (view: EditorView) => {
        const contentJSON = extractContentJSON(view.state)
        if (!contentJSON) return

        const attrs = getInputAttrs(view.state)

        onSubmit(buildSubmitPayload(contentJSON, attrs))

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
                    placeholderText,
                    createContextTray,
                    createModelDropdown,
                    createModelMultiSelect,
                    createImageModelDropdown,
                    createImageModelMultiSelect,
                    createImageSizeDropdown,
                    createVideoModelDropdown,
                    createVideoModelMultiSelect,
                    createVideoAspectDropdown,
                    createVideoResolutionDropdown,
                    createVideoDurationDropdown,
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
                    onSubmit(buildSubmitPayload(contentJSON, attrs))
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
