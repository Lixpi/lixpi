import { Plugin, EditorState, Transaction, TextSelection } from 'prosemirror-state'
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

import { AI_PROMPT_INPUT_PLUGIN_KEY, SUBMIT_AI_PROMPT_META } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputPluginConstants.ts'
import {
    aiPromptInputNodeType,
    createAiPromptInputNodeView,
    parseAiModelSelectionAttr,
    parseMediaGenerationConfigSelectionAttr,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
import type { MediaGenerationConfigSelectionGroup } from '@lixpi/constants'

type SubmitHandler = (data: {
    contentJSON: any[]
    aiReasoningModels: string[]
    useMultipleReasoningModels: boolean
    useMultipleImageModels: boolean
    useMultipleVideoModels: boolean
    imageOptions?: {
        aiImageModels: string[]
        imageGenerationSize: string
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
    videoOptions?: {
        aiVideoModels: string[]
        videoAspectRatio?: string
        videoResolution?: string
        videoDuration?: string
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
}) => void

type AiPromptInputPluginOptions = {
    onSubmit: SubmitHandler
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
    aiReasoningModels: string[]
    useMultipleReasoningModels: boolean
    useMultipleImageModels: boolean
    useMultipleVideoModels: boolean
    aiImageModels: string[]
    imageGenerationSize: string
    imageGenerationConfigGroups: MediaGenerationConfigSelectionGroup[]
    aiVideoModels: string[]
    videoAspectRatio: string
    videoResolution: string
    videoDuration: string
    videoGenerationConfigGroups: MediaGenerationConfigSelectionGroup[]
}

function getInputAttrs(state: EditorState): InputAttrs {
    let attrs: InputAttrs = {
        aiReasoningModels: [],
        useMultipleReasoningModels: false,
        useMultipleImageModels: false,
        useMultipleVideoModels: false,
        aiImageModels: [],
        imageGenerationSize: 'auto',
        imageGenerationConfigGroups: [],
        aiVideoModels: [],
        videoAspectRatio: '',
        videoResolution: '',
        videoDuration: '',
        videoGenerationConfigGroups: [],
    }
    state.doc.descendants((node: ProseMirrorNode) => {
        if (node.type.name === aiPromptInputNodeType) {
            attrs = {
                aiReasoningModels: parseAiModelSelectionAttr(node.attrs.aiReasoningModels),
                useMultipleReasoningModels: node.attrs.useMultipleReasoningModels === true || node.attrs.useMultipleReasoningModels === 'true',
                useMultipleImageModels: node.attrs.useMultipleImageModels === true || node.attrs.useMultipleImageModels === 'true',
                useMultipleVideoModels: node.attrs.useMultipleVideoModels === true || node.attrs.useMultipleVideoModels === 'true',
                aiImageModels: parseAiModelSelectionAttr(node.attrs.aiImageModels),
                imageGenerationSize: node.attrs.imageGenerationSize || 'auto',
                imageGenerationConfigGroups: parseMediaGenerationConfigSelectionAttr(node.attrs.imageGenerationConfigGroups),
                aiVideoModels: parseAiModelSelectionAttr(node.attrs.aiVideoModels),
                videoAspectRatio: node.attrs.videoAspectRatio || '',
                videoResolution: node.attrs.videoResolution || '',
                videoDuration: node.attrs.videoDuration || '',
                videoGenerationConfigGroups: parseMediaGenerationConfigSelectionAttr(node.attrs.videoGenerationConfigGroups),
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
        // Multi disabled → collapse the section's selection to its first model.
        const collapseForMode = (models: string[], useMultiple: boolean): string[] =>
            useMultiple ? models : models.slice(0, 1)
        const aiReasoningModels = collapseForMode(attrs.aiReasoningModels, attrs.useMultipleReasoningModels)
        const aiImageModels = collapseForMode(attrs.aiImageModels, attrs.useMultipleImageModels)
        const aiVideoModels = collapseForMode(attrs.aiVideoModels, attrs.useMultipleVideoModels)
        const imageGenerationConfigGroups = attrs.useMultipleImageModels
            ? attrs.imageGenerationConfigGroups
            : []
        const videoGenerationConfigGroups = attrs.useMultipleVideoModels
            ? attrs.videoGenerationConfigGroups
            : []

        return {
            contentJSON,
            aiReasoningModels,
            useMultipleReasoningModels: attrs.useMultipleReasoningModels,
            useMultipleImageModels: attrs.useMultipleImageModels,
            useMultipleVideoModels: attrs.useMultipleVideoModels,
            imageOptions: {
                aiImageModels,
                imageGenerationSize: attrs.imageGenerationSize,
                ...(imageGenerationConfigGroups.length > 0 ? { configGroups: imageGenerationConfigGroups } : {}),
            },
            videoOptions: {
                aiVideoModels,
                videoAspectRatio: attrs.videoAspectRatio,
                videoResolution: attrs.videoResolution,
                videoDuration: attrs.videoDuration,
                ...(videoGenerationConfigGroups.length > 0 ? { configGroups: videoGenerationConfigGroups } : {}),
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

            return null
        },
    })
}
