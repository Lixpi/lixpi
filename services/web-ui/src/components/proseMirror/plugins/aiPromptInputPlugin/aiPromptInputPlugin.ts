import {
    Plugin,
    EditorState,
    Transaction,
    TextSelection,
} from 'prosemirror-state'
import {
    EditorView,
    Decoration,
    DecorationSet,
} from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type {
    CapabilityJsonValue,
    MediaGenerationConfigSelectionGroup,
} from '@lixpi/constants'

import {
    AI_PROMPT_INPUT_PLUGIN_KEY,
    SUBMIT_AI_PROMPT_META,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputPluginConstants.ts'
import {
    aiPromptInputNodeType,
    createAiPromptInputNodeView,
    hasAiPromptInputContent,
    parseAiModelSelectionAttr,
    parseCapabilityInputsAttr,
    parseMediaGenerationConfigSelectionAttr,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'

type SubmitHandler = (data: {
    contentJSON: any[]
    mediaGenerationMode: 'image' | 'video'
    aiReasoningModels: string[]
    useMultipleReasoningModels: boolean
    useMultipleImageModels: boolean
    useMultipleVideoModels: boolean
    reasoningOptions?: {
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
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
    capabilityInputs: Record<string, Record<string, CapabilityJsonValue>>
}) => void

type AiPromptInputPluginOptions = {
    onSubmit: SubmitHandler
    createContextTray?: Parameters<typeof createAiPromptInputNodeView>[0]['createContextTray']
    mountMediaModeSwitch?: Parameters<typeof createAiPromptInputNodeView>[0]['mountMediaModeSwitch']
    mountModelMenuControl?: Parameters<typeof createAiPromptInputNodeView>[0]['mountModelMenuControl']
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
    createCapabilityControls?: Parameters<typeof createAiPromptInputNodeView>[0]['createCapabilityControls']
    placeholderText: string
}

class KeyboardHandler {
    static isModEnter(event: KeyboardEvent): boolean {
        return (event.metaKey || event.ctrlKey) && event.key === 'Enter'
    }
}

export function extractContentJSON(state: EditorState): any[] | null {
    // Find the aiPromptInput node and extract its content as JSON
    let inputNode: ProseMirrorNode | null = null
    state.doc.descendants((node: ProseMirrorNode) => {
        if (node.type.name === aiPromptInputNodeType) {
            inputNode = node
            return false
        }
    })

    if (!inputNode) return null
    if (!hasAiPromptInputContent(inputNode as ProseMirrorNode)) return null

    // Convert content to JSON array
    const content: any[] = []
    ;(inputNode as ProseMirrorNode).content.forEach((child: ProseMirrorNode) => {
        content.push(child.toJSON())
    })

    return content
}

type InputAttrs = {
    mediaGenerationMode: 'image' | 'video'
    aiReasoningModels: string[]
    reasoningGenerationConfigGroups: MediaGenerationConfigSelectionGroup[]
    aiImageModels: string[]
    imageGenerationSize: string
    imageGenerationConfigGroups: MediaGenerationConfigSelectionGroup[]
    aiVideoModels: string[]
    videoAspectRatio: string
    videoResolution: string
    videoDuration: string
    videoGenerationConfigGroups: MediaGenerationConfigSelectionGroup[]
    capabilityInputs: Record<string, Record<string, CapabilityJsonValue>>
}

function getInputAttrs(state: EditorState): InputAttrs {
    let attrs: InputAttrs = {
        mediaGenerationMode: 'image',
        aiReasoningModels: [],
        reasoningGenerationConfigGroups: [],
        aiImageModels: [],
        imageGenerationSize: 'auto',
        imageGenerationConfigGroups: [],
        aiVideoModels: [],
        videoAspectRatio: '',
        videoResolution: '',
        videoDuration: '',
        videoGenerationConfigGroups: [],
        capabilityInputs: {},
    }
    state.doc.descendants((node: ProseMirrorNode) => {
        if (node.type.name === aiPromptInputNodeType) {
            attrs = {
                mediaGenerationMode: node.attrs.mediaGenerationMode === 'video' ? 'video' : 'image',
                aiReasoningModels: parseAiModelSelectionAttr(node.attrs.aiReasoningModels),
                reasoningGenerationConfigGroups: parseMediaGenerationConfigSelectionAttr(node.attrs.reasoningGenerationConfigGroups),
                aiImageModels: parseAiModelSelectionAttr(node.attrs.aiImageModels),
                imageGenerationSize: node.attrs.imageGenerationSize || 'auto',
                imageGenerationConfigGroups: parseMediaGenerationConfigSelectionAttr(node.attrs.imageGenerationConfigGroups),
                aiVideoModels: parseAiModelSelectionAttr(node.attrs.aiVideoModels),
                videoAspectRatio: node.attrs.videoAspectRatio || '',
                videoResolution: node.attrs.videoResolution || '',
                videoDuration: node.attrs.videoDuration || '',
                videoGenerationConfigGroups: parseMediaGenerationConfigSelectionAttr(node.attrs.videoGenerationConfigGroups),
                capabilityInputs: parseCapabilityInputsAttr(node.attrs.capabilityInputs),
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
        mountMediaModeSwitch,
        mountModelMenuControl,
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
        createCapabilityControls,
        placeholderText,
    } = options

    const buildSubmitPayload = (contentJSON: any[], attrs: InputAttrs) => {
        const aiReasoningModels = attrs.aiReasoningModels
        const aiImageModels = attrs.aiImageModels
        const aiVideoModels = attrs.aiVideoModels
        const reasoningGenerationConfigGroups = attrs.reasoningGenerationConfigGroups
        const imageGenerationConfigGroups = attrs.imageGenerationConfigGroups
        const videoGenerationConfigGroups = attrs.videoGenerationConfigGroups

        return {
            contentJSON,
            mediaGenerationMode: attrs.mediaGenerationMode,
            aiReasoningModels,
            useMultipleReasoningModels: aiReasoningModels.length > 1,
            useMultipleImageModels: aiImageModels.length > 1,
            useMultipleVideoModels: aiVideoModels.length > 1,
            reasoningOptions: reasoningGenerationConfigGroups.length > 0
                ? {
                    configGroups: reasoningGenerationConfigGroups,
                }
                : undefined,
            imageOptions: attrs.mediaGenerationMode === 'image'
                ? {
                    aiImageModels,
                    imageGenerationSize: attrs.imageGenerationSize,
                    ...(imageGenerationConfigGroups.length > 0 ? { configGroups: imageGenerationConfigGroups } : {}),
                }
                : undefined,
            videoOptions: attrs.mediaGenerationMode === 'video'
                ? {
                    aiVideoModels,
                    videoAspectRatio: attrs.videoAspectRatio,
                    videoResolution: attrs.videoResolution,
                    videoDuration: attrs.videoDuration,
                    ...(videoGenerationConfigGroups.length > 0 ? { configGroups: videoGenerationConfigGroups } : {}),
                }
                : undefined,
            capabilityInputs: attrs.capabilityInputs,
        }
    }

    const handleSubmit = (view: EditorView) => {
        const contentJSON = extractContentJSON(view.state)
        if (!contentJSON) return

        const attrs = getInputAttrs(view.state)
        if (!attrs.aiReasoningModels[0]) return

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
                    if (node.type.name === aiPromptInputNodeType && !hasAiPromptInputContent(node)) {
                        decorations.push(
                            Decoration.node(pos, pos + node.nodeSize, {
                                class: 'empty-node-placeholder',
                                'data-placeholder': placeholderText,
                            }),
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
                    mountMediaModeSwitch,
                    mountModelMenuControl,
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
                    createCapabilityControls,
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
                    if (!attrs.aiReasoningModels[0]) return null
                    onSubmit(buildSubmitPayload(contentJSON, attrs))
                }
            }

            return null
        },
    })
}
