import {
    type NodeSpec,
} from 'prosemirror-model'
import {
    getAiLineageEventLabel,
    normalizeAiLineageEventKind,
    normalizeAiLineageProjectionScope,
} from './lineage-events.ts'
import {
    normalizeAiModelSelectionAttr,
    normalizeCapabilityInputsAttr,
    normalizeMediaGenerationConfigSelectionAttr,
    parseBooleanAttr,
} from './model-selection-attrs.ts'

export const codeBlockNodeType = 'code_block'

export const codeBlockNodeSpec = {
    attrs: {
        theme: { default: 'gruvboxDark' },
    },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    draggable: false,
    selectable: true,
    parseDOM: [
        {
            tag: 'pre',
            preserveWhitespace: 'full',
            getAttrs(dom: HTMLElement) {
                return {
                    theme: dom.getAttribute('data-theme') || 'gruvboxDark',
                }
            },
        },
    ],
    toDOM(node) {
        return ['pre', { 'data-theme': node.attrs.theme }, ['code', 0]]
    },
} as NodeSpec

export const documentTitleNodeType = 'documentTitle'

export const documentTitleNodeSpec = {
    content: 'inline*',
    group: 'block',
    defining: true,
    draggable: false,
    selectable: false,
    parseDOM: [{ tag: 'h1.document-title' }],
    toDOM() {
        return ['h1', { class: 'document-title' }, 0]
    },
} as NodeSpec

export const taskRowDefaultAttrs = {
    taskKey: 'LIX-1',
    status: 'New Task Status',
    title: 'New Task Title',
    description: 'New Task Description',
}

export const taskRowNodeType = 'taskRow'

export const taskRowNodeSpec = {
    inline: false,
    group: 'block',
    draggable: false,
    attrs: taskRowDefaultAttrs,
} as NodeSpec

export const customNodeSpecs = {
    [documentTitleNodeType]: documentTitleNodeSpec,
    [taskRowNodeType]: taskRowNodeSpec,
    [codeBlockNodeType]: codeBlockNodeSpec,
}

export const aiChatThreadNodeType = 'aiChatThread'

export const aiChatThreadNodeSpec = {
    group: 'block',
    content: '(aiUserMessage | aiResponseMessage)*',
    defining: false,
    draggable: false,
    isolating: false,
    attrs: {
        threadId: { default: null },
        status: { default: 'active' },
        mediaGenerationMode: { default: 'image' },
        aiReasoningModels: { default: '' },
        reasoningGenerationConfigGroups: { default: '' },
        useMultipleReasoningModels: { default: false },
        useMultipleImageModels: { default: false },
        useMultipleVideoModels: { default: false },
        aiImageModels: { default: '' },
        imageGenerationEnabled: { default: false },
        imageGenerationSize: { default: 'auto' },
        imageGenerationConfigGroups: { default: '' },
        previousResponseId: { default: '' },
        aiVideoModels: { default: '' },
        videoAspectRatio: { default: '' },
        videoResolution: { default: '' },
        videoDuration: { default: '' },
        videoGenerationConfigGroups: { default: '' },
        sourceVideoNodeId: { default: '' },
        capabilityInputs: { default: '' },
    },
    parseDOM: [
        {
            tag: 'div.ai-chat-thread-wrapper',
            getAttrs: (dom: HTMLElement) => {
                return {
                    threadId: dom.getAttribute('data-thread-id'),
                    status: dom.getAttribute('data-status') || 'active',
                    mediaGenerationMode: dom.getAttribute('data-media-generation-mode') === 'video' ? 'video' : 'image',
                    aiReasoningModels: dom.getAttribute('data-ai-reasoning-models') || '',
                    reasoningGenerationConfigGroups: normalizeMediaGenerationConfigSelectionAttr(dom.getAttribute('data-reasoning-generation-config-groups')),
                    useMultipleReasoningModels: dom.getAttribute('data-use-multiple-reasoning-models') === 'true',
                    useMultipleImageModels: dom.getAttribute('data-use-multiple-image-models') === 'true',
                    useMultipleVideoModels: dom.getAttribute('data-use-multiple-video-models') === 'true',
                    aiImageModels: dom.getAttribute('data-ai-image-models') || '',
                    imageGenerationEnabled: dom.getAttribute('data-image-generation-enabled') === 'true',
                    imageGenerationSize: dom.getAttribute('data-image-generation-size') || 'auto',
                    imageGenerationConfigGroups: normalizeMediaGenerationConfigSelectionAttr(dom.getAttribute('data-image-generation-config-groups')),
                    previousResponseId: dom.getAttribute('data-previous-response-id') || '',
                    aiVideoModels: dom.getAttribute('data-ai-video-models') || '',
                    videoAspectRatio: dom.getAttribute('data-video-aspect-ratio') || '',
                    videoResolution: dom.getAttribute('data-video-resolution') || '',
                    videoDuration: dom.getAttribute('data-video-duration') || '',
                    videoGenerationConfigGroups: normalizeMediaGenerationConfigSelectionAttr(dom.getAttribute('data-video-generation-config-groups')),
                    sourceVideoNodeId: dom.getAttribute('data-source-video-node-id') || '',
                    capabilityInputs: normalizeCapabilityInputsAttr(dom.getAttribute('data-capability-inputs')),
                }
            },
        },
    ],
    toDOM: (node) => {
        const useMultipleReasoningModels = parseBooleanAttr(node.attrs.useMultipleReasoningModels)
        const useMultipleImageModels = parseBooleanAttr(node.attrs.useMultipleImageModels)
        const useMultipleVideoModels = parseBooleanAttr(node.attrs.useMultipleVideoModels)
        return [
            'div',
            {
                class: 'ai-chat-thread-wrapper',
                'data-thread-id': node.attrs.threadId,
                'data-status': node.attrs.status,
                'data-media-generation-mode': node.attrs.mediaGenerationMode === 'video' ? 'video' : 'image',
                'data-ai-reasoning-models': node.attrs.aiReasoningModels,
                'data-reasoning-generation-config-groups': normalizeMediaGenerationConfigSelectionAttr(node.attrs.reasoningGenerationConfigGroups),
                'data-use-multiple-reasoning-models': String(useMultipleReasoningModels),
                'data-use-multiple-image-models': String(useMultipleImageModels),
                'data-use-multiple-video-models': String(useMultipleVideoModels),
                'data-ai-image-models': node.attrs.aiImageModels,
                'data-image-generation-enabled': node.attrs.imageGenerationEnabled,
                'data-image-generation-size': node.attrs.imageGenerationSize,
                'data-image-generation-config-groups': normalizeMediaGenerationConfigSelectionAttr(node.attrs.imageGenerationConfigGroups),
                'data-previous-response-id': node.attrs.previousResponseId,
                'data-ai-video-models': node.attrs.aiVideoModels,
                'data-video-aspect-ratio': node.attrs.videoAspectRatio,
                'data-video-resolution': node.attrs.videoResolution,
                'data-video-duration': node.attrs.videoDuration,
                'data-video-generation-config-groups': normalizeMediaGenerationConfigSelectionAttr(node.attrs.videoGenerationConfigGroups),
                'data-source-video-node-id': node.attrs.sourceVideoNodeId,
                'data-capability-inputs': normalizeCapabilityInputsAttr(node.attrs.capabilityInputs),
            },
            0,
        ]
    },
} as NodeSpec

export const aiResponseMessageNodeType = 'aiResponseMessage'

export const aiResponseMessageNodeSpec = {
    attrs: {
        id: { default: '' },
        style: { default: '' },
        isInitialRenderAnimation: { default: false },
        isReceivingAnimation: { default: false },
        aiProvider: { default: '' },
        generationRequestId: { default: '' },
        reasoningRunId: { default: '' },
        mediaRunId: { default: '' },
        reasoningModelId: { default: '' },
        mediaModelId: { default: '' },
        mediaType: { default: '' },
    },
    content: '(paragraph | block)*',
    group: 'block',
    draggable: false,
    parseDOM: [
        {
            tag: 'div.ai-response-message',
            getAttrs(dom: HTMLElement) {
                return {
                    id: dom.getAttribute('id'),
                    style: dom.getAttribute('style'),
                    aiProvider: dom.getAttribute('data-ai-provider'),
                    generationRequestId: dom.getAttribute('data-generation-request-id') || '',
                    reasoningRunId: dom.getAttribute('data-reasoning-run-id') || '',
                    mediaRunId: dom.getAttribute('data-media-run-id') || '',
                    reasoningModelId: dom.getAttribute('data-reasoning-model-id') || '',
                    mediaModelId: dom.getAttribute('data-media-model-id') || '',
                    mediaType: dom.getAttribute('data-media-type') || '',
                }
            },
        },
    ],
    toDOM(node) {
        return ['div', {
            id: node.attrs.id,
            style: node.attrs.style,
            class: 'ai-response-message',
            'data-ai-provider': node.attrs.aiProvider,
            'data-generation-request-id': node.attrs.generationRequestId,
            'data-reasoning-run-id': node.attrs.reasoningRunId,
            'data-media-run-id': node.attrs.mediaRunId,
            'data-reasoning-model-id': node.attrs.reasoningModelId,
            'data-media-model-id': node.attrs.mediaModelId,
            'data-media-type': node.attrs.mediaType,
        }, 0]
    },
} as NodeSpec

export const aiUserMessageNodeType = 'aiUserMessage'

export const aiUserMessageNodeSpec = {
    attrs: {
        id: { default: '' },
        createdAt: { default: 0 },
        referenceNodeIds: { default: [] },
    },
    content: '(paragraph | block)+',
    group: 'block',
    draggable: false,
    parseDOM: [
        {
            tag: 'div.ai-user-message',
            getAttrs(dom: HTMLElement) {
                return {
                    id: dom.getAttribute('data-id') || '',
                    createdAt: Number(dom.getAttribute('data-created-at') || 0),
                    referenceNodeIds: normalizeReferenceNodeIds(dom.getAttribute('data-reference-node-ids') || ''),
                }
            },
        },
    ],
    toDOM(node) {
        return [
            'div',
            {
                class: 'ai-user-message',
                'data-id': node.attrs.id,
                'data-created-at': String(node.attrs.createdAt || 0),
                'data-reference-node-ids': JSON.stringify(normalizeReferenceNodeIds(node.attrs.referenceNodeIds)),
            },
            0,
        ]
    },
} as NodeSpec

export function normalizeReferenceNodeIds(value: unknown): string[] {
    const rawIds = Array.isArray(value)
        ? value
        : typeof value === 'string' && value.trim()
        ? parseReferenceNodeIds(value)
        : []
    const ids: string[] = []
    const seen = new Set<string>()
    for (const rawId of rawIds) {
        const nodeId = typeof rawId === 'string' ? rawId.trim() : ''
        if (!nodeId || seen.has(nodeId)) continue
        seen.add(nodeId)
        ids.push(nodeId)
    }
    return ids
}

function parseReferenceNodeIds(value: string): unknown[] {
    try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return value.split(',')
    }
}

export const aiPromptInputNodeType = 'aiPromptInput'

export const aiPromptInputNodeSpec = {
    content: '(paragraph | block)+',
    group: 'block',
    draggable: false,
    selectable: false,
    isolating: true,
    attrs: {
        mediaGenerationMode: { default: 'image' },
        aiReasoningModels: { default: '' },
        reasoningGenerationConfigGroups: { default: '' },
        useMultipleReasoningModels: { default: false },
        useMultipleImageModels: { default: false },
        useMultipleVideoModels: { default: false },
        aiImageModels: { default: '' },
        imageGenerationSize: { default: 'auto' },
        imageGenerationConfigGroups: { default: '' },
        aiVideoModels: { default: '' },
        videoAspectRatio: { default: '' },
        videoResolution: { default: '' },
        videoDuration: { default: '' },
        videoGenerationConfigGroups: { default: '' },
        capabilityInputs: { default: '' },
    },
    parseDOM: [
        {
            tag: 'div.ai-prompt-input-wrapper',
            getAttrs: (dom: HTMLElement) => {
                const useMultipleReasoningModels = dom.getAttribute('data-use-multiple-reasoning-models') === 'true'
                const useMultipleImageModels = dom.getAttribute('data-use-multiple-image-models') === 'true'
                const useMultipleVideoModels = dom.getAttribute('data-use-multiple-video-models') === 'true'
                return {
                    mediaGenerationMode: dom.getAttribute('data-media-generation-mode') === 'video' ? 'video' : 'image',
                    aiReasoningModels: normalizeAiModelSelectionAttr(dom.getAttribute('data-ai-reasoning-models')),
                    reasoningGenerationConfigGroups: normalizeMediaGenerationConfigSelectionAttr(dom.getAttribute('data-reasoning-generation-config-groups')),
                    useMultipleReasoningModels,
                    useMultipleImageModels,
                    useMultipleVideoModels,
                    aiImageModels: normalizeAiModelSelectionAttr(dom.getAttribute('data-ai-image-models')),
                    imageGenerationSize: dom.getAttribute('data-image-generation-size') || 'auto',
                    imageGenerationConfigGroups: normalizeMediaGenerationConfigSelectionAttr(dom.getAttribute('data-image-generation-config-groups')),
                    aiVideoModels: normalizeAiModelSelectionAttr(dom.getAttribute('data-ai-video-models')),
                    videoAspectRatio: dom.getAttribute('data-video-aspect-ratio') || '',
                    videoResolution: dom.getAttribute('data-video-resolution') || '',
                    videoDuration: dom.getAttribute('data-video-duration') || '',
                    videoGenerationConfigGroups: normalizeMediaGenerationConfigSelectionAttr(dom.getAttribute('data-video-generation-config-groups')),
                    capabilityInputs: normalizeCapabilityInputsAttr(dom.getAttribute('data-capability-inputs')),
                }
            },
        },
    ],
    toDOM(node) {
        const useMultipleReasoningModels = parseBooleanAttr(node.attrs.useMultipleReasoningModels)
        const useMultipleImageModels = parseBooleanAttr(node.attrs.useMultipleImageModels)
        const useMultipleVideoModels = parseBooleanAttr(node.attrs.useMultipleVideoModels)
        return [
            'div',
            {
                class: 'ai-prompt-input-wrapper',
                'data-media-generation-mode': node.attrs.mediaGenerationMode === 'video' ? 'video' : 'image',
                'data-ai-reasoning-models': normalizeAiModelSelectionAttr(node.attrs.aiReasoningModels),
                'data-reasoning-generation-config-groups': normalizeMediaGenerationConfigSelectionAttr(node.attrs.reasoningGenerationConfigGroups),
                'data-use-multiple-reasoning-models': String(useMultipleReasoningModels),
                'data-use-multiple-image-models': String(useMultipleImageModels),
                'data-use-multiple-video-models': String(useMultipleVideoModels),
                'data-ai-image-models': normalizeAiModelSelectionAttr(node.attrs.aiImageModels),
                'data-image-generation-size': node.attrs.imageGenerationSize,
                'data-image-generation-config-groups': normalizeMediaGenerationConfigSelectionAttr(node.attrs.imageGenerationConfigGroups),
                'data-ai-video-models': normalizeAiModelSelectionAttr(node.attrs.aiVideoModels),
                'data-video-aspect-ratio': node.attrs.videoAspectRatio,
                'data-video-resolution': node.attrs.videoResolution,
                'data-video-duration': node.attrs.videoDuration,
                'data-video-generation-config-groups': normalizeMediaGenerationConfigSelectionAttr(node.attrs.videoGenerationConfigGroups),
                'data-capability-inputs': normalizeCapabilityInputsAttr(node.attrs.capabilityInputs),
            },
            0,
        ]
    },
} as NodeSpec

export const aiGeneratedImageNodeType = 'aiGeneratedImage'

export const aiGeneratedImageNodeSpec = {
    attrs: {
        imageData: { default: '' },
        assetId: { default: '' },
        revisedPrompt: { default: '' },
        responseId: { default: '' },
        aiModel: { default: '' },
        isPartial: { default: true },
        partialIndex: { default: 0 },
        generationRequestId: { default: '' },
        reasoningRunId: { default: '' },
        mediaRunId: { default: '' },
        reasoningModelId: { default: '' },
        mediaModelId: { default: '' },
        mediaType: { default: '' },
        generationProgress: { default: null },
        variantIndex: { default: null },
        branchId: { default: '' },
        parentMediaNodeId: { default: '' },
        branchOriginNodeId: { default: '' },
        branchForkNodeId: { default: '' },
        branchLineNodeId: { default: '' },
        lineageParentNodeId: { default: '' },
        width: { default: null },
        alignment: { default: 'left' },
        textWrap: { default: 'none' },
    },
    group: 'block',
    draggable: false,
    atom: true,
    parseDOM: [
        {
            tag: 'div.ai-generated-image',
            getAttrs(dom: HTMLElement) {
                return {
                    imageData: dom.getAttribute('data-image-data') || '',
                    assetId: dom.getAttribute('data-asset-id') || '',
                    revisedPrompt: dom.getAttribute('data-revised-prompt') || '',
                    responseId: dom.getAttribute('data-response-id') || '',
                    aiModel: dom.getAttribute('data-ai-model') || '',
                    isPartial: dom.getAttribute('data-is-partial') === 'true',
                    partialIndex: parseInt(dom.getAttribute('data-partial-index') || '0', 10),
                    generationRequestId: dom.getAttribute('data-generation-request-id') || '',
                    reasoningRunId: dom.getAttribute('data-reasoning-run-id') || '',
                    mediaRunId: dom.getAttribute('data-media-run-id') || '',
                    reasoningModelId: dom.getAttribute('data-reasoning-model-id') || '',
                    mediaModelId: dom.getAttribute('data-media-model-id') || '',
                    mediaType: dom.getAttribute('data-media-type') || '',
                    variantIndex: parseVariantIndex(dom.getAttribute('data-variant-index')),
                    branchId: dom.getAttribute('data-branch-id') || '',
                    parentMediaNodeId: dom.getAttribute('data-parent-media-node-id') || '',
                    branchOriginNodeId: dom.getAttribute('data-branch-origin-node-id') || '',
                    branchForkNodeId: dom.getAttribute('data-branch-fork-node-id') || '',
                    branchLineNodeId: dom.getAttribute('data-branch-line-node-id') || '',
                    lineageParentNodeId: dom.getAttribute('data-lineage-parent-node-id') || '',
                    width: dom.getAttribute('data-width') || null,
                    alignment: dom.getAttribute('data-alignment') || 'left',
                    textWrap: dom.getAttribute('data-text-wrap') || 'none',
                }
            },
        },
    ],
    toDOM(node) {
        return ['div', {
            class: 'ai-generated-image',
            'data-image-data': node.attrs.imageData,
            'data-asset-id': node.attrs.assetId,
            'data-revised-prompt': node.attrs.revisedPrompt,
            'data-response-id': node.attrs.responseId,
            'data-ai-model': node.attrs.aiModel,
            'data-is-partial': String(node.attrs.isPartial),
            'data-partial-index': String(node.attrs.partialIndex),
            'data-generation-request-id': node.attrs.generationRequestId,
            'data-reasoning-run-id': node.attrs.reasoningRunId,
            'data-media-run-id': node.attrs.mediaRunId,
            'data-reasoning-model-id': node.attrs.reasoningModelId,
            'data-media-model-id': node.attrs.mediaModelId,
            'data-media-type': node.attrs.mediaType,
            'data-variant-index': node.attrs.variantIndex == null ? '' : String(node.attrs.variantIndex),
            'data-branch-id': node.attrs.branchId,
            'data-parent-media-node-id': node.attrs.parentMediaNodeId,
            'data-branch-origin-node-id': node.attrs.branchOriginNodeId,
            'data-branch-fork-node-id': node.attrs.branchForkNodeId,
            'data-branch-line-node-id': node.attrs.branchLineNodeId,
            'data-lineage-parent-node-id': node.attrs.lineageParentNodeId,
            'data-width': node.attrs.width || '',
            'data-alignment': node.attrs.alignment || 'left',
            'data-text-wrap': node.attrs.textWrap || 'none',
        }]
    },
} as NodeSpec

export const aiGeneratedVideoNodeType = 'aiGeneratedVideo'

export const aiGeneratedVideoNodeSpec = {
    attrs: {
        videoUrl: { default: '' },
        assetId: { default: '' },
        posterUrl: { default: '' },
        durationSeconds: { default: 0 },
        aspectRatio: { default: 1.777 },
        hasAudio: { default: true },
        revisedPrompt: { default: '' },
        responseId: { default: '' },
        videoModel: { default: '' },
        isPending: { default: true },
        errorMessage: { default: '' },
        generationRequestId: { default: '' },
        reasoningRunId: { default: '' },
        mediaRunId: { default: '' },
        reasoningModelId: { default: '' },
        mediaModelId: { default: '' },
        mediaType: { default: '' },
        generationProgress: { default: null },
        variantIndex: { default: null },
        branchId: { default: '' },
        parentMediaNodeId: { default: '' },
        branchOriginNodeId: { default: '' },
        branchForkNodeId: { default: '' },
        branchLineNodeId: { default: '' },
        lineageParentNodeId: { default: '' },
        width: { default: null },
        alignment: { default: 'left' },
        textWrap: { default: 'none' },
    },
    group: 'block',
    draggable: false,
    atom: true,
    parseDOM: [
        {
            tag: 'div.ai-generated-video',
            getAttrs(dom: HTMLElement) {
                return {
                    videoUrl: dom.getAttribute('data-video-url') || '',
                    assetId: dom.getAttribute('data-asset-id') || '',
                    posterUrl: dom.getAttribute('data-poster-url') || '',
                    durationSeconds: Number(dom.getAttribute('data-duration-seconds') || 0),
                    aspectRatio: Number(dom.getAttribute('data-aspect-ratio') || 1.777),
                    hasAudio: dom.getAttribute('data-has-audio') === 'true',
                    revisedPrompt: dom.getAttribute('data-revised-prompt') || '',
                    responseId: dom.getAttribute('data-response-id') || '',
                    videoModel: dom.getAttribute('data-video-model') || '',
                    isPending: dom.getAttribute('data-is-pending') === 'true',
                    errorMessage: dom.getAttribute('data-error-message') || '',
                    generationRequestId: dom.getAttribute('data-generation-request-id') || '',
                    reasoningRunId: dom.getAttribute('data-reasoning-run-id') || '',
                    mediaRunId: dom.getAttribute('data-media-run-id') || '',
                    reasoningModelId: dom.getAttribute('data-reasoning-model-id') || '',
                    mediaModelId: dom.getAttribute('data-media-model-id') || '',
                    mediaType: dom.getAttribute('data-media-type') || '',
                    variantIndex: parseVariantIndex(dom.getAttribute('data-variant-index')),
                    branchId: dom.getAttribute('data-branch-id') || '',
                    parentMediaNodeId: dom.getAttribute('data-parent-media-node-id') || '',
                    branchOriginNodeId: dom.getAttribute('data-branch-origin-node-id') || '',
                    branchForkNodeId: dom.getAttribute('data-branch-fork-node-id') || '',
                    branchLineNodeId: dom.getAttribute('data-branch-line-node-id') || '',
                    lineageParentNodeId: dom.getAttribute('data-lineage-parent-node-id') || '',
                    width: dom.getAttribute('data-width') || null,
                    alignment: dom.getAttribute('data-alignment') || 'left',
                    textWrap: dom.getAttribute('data-text-wrap') || 'none',
                }
            },
        },
    ],
    toDOM(node) {
        return ['div', {
            class: 'ai-generated-video',
            'data-video-url': node.attrs.videoUrl,
            'data-asset-id': node.attrs.assetId,
            'data-poster-url': node.attrs.posterUrl,
            'data-duration-seconds': String(node.attrs.durationSeconds),
            'data-aspect-ratio': String(node.attrs.aspectRatio),
            'data-has-audio': String(node.attrs.hasAudio),
            'data-revised-prompt': node.attrs.revisedPrompt,
            'data-response-id': node.attrs.responseId,
            'data-video-model': node.attrs.videoModel,
            'data-is-pending': String(node.attrs.isPending),
            'data-error-message': node.attrs.errorMessage,
            'data-generation-request-id': node.attrs.generationRequestId,
            'data-reasoning-run-id': node.attrs.reasoningRunId,
            'data-media-run-id': node.attrs.mediaRunId,
            'data-reasoning-model-id': node.attrs.reasoningModelId,
            'data-media-model-id': node.attrs.mediaModelId,
            'data-media-type': node.attrs.mediaType,
            'data-variant-index': node.attrs.variantIndex == null ? '' : String(node.attrs.variantIndex),
            'data-branch-id': node.attrs.branchId,
            'data-parent-media-node-id': node.attrs.parentMediaNodeId,
            'data-branch-origin-node-id': node.attrs.branchOriginNodeId,
            'data-branch-fork-node-id': node.attrs.branchForkNodeId,
            'data-branch-line-node-id': node.attrs.branchLineNodeId,
            'data-lineage-parent-node-id': node.attrs.lineageParentNodeId,
            'data-width': node.attrs.width || '',
            'data-alignment': node.attrs.alignment || 'left',
            'data-text-wrap': node.attrs.textWrap || 'none',
        }]
    },
} as NodeSpec

export const aiCollapsibleBlockNodeType = 'aiCollapsibleBlock'

export const aiCollapsibleBlockNodeSpec = {
    attrs: {
        title: { default: 'Image generation prompt' },
        isOpen: { default: false },
        isStreaming: { default: true },
        imageGenerationTrace: { default: null },
        imageGenerationTraceId: { default: null },
        videoGenerationTrace: { default: null },
        capabilityGenerationTrace: { default: null },
        generationRequestId: { default: '' },
        reasoningRunId: { default: '' },
        mediaRunId: { default: '' },
        reasoningModelId: { default: '' },
        mediaModelId: { default: '' },
        mediaType: { default: '' },
        variantIndex: { default: null },
    },
    content: '(paragraph | block)*',
    group: 'block',
    draggable: false,
    parseDOM: [
        {
            tag: 'div.ai-generation-trace-block',
            getAttrs(dom: HTMLElement) {
                return parseTraceBlockAttrs(
                    dom,
                    dom.getAttribute('data-title') || 'Image generation prompt',
                )
            },
        },
    ],
    toDOM(node) {
        return [
            'div',
            {
                class: `ai-generation-trace-block${node.attrs.isStreaming ? ' is-streaming' : ''}`,
                'data-title': node.attrs.title,
                'data-generation-request-id': node.attrs.generationRequestId,
                'data-reasoning-run-id': node.attrs.reasoningRunId,
                'data-media-run-id': node.attrs.mediaRunId,
                'data-reasoning-model-id': node.attrs.reasoningModelId,
                'data-media-model-id': node.attrs.mediaModelId,
                'data-media-type': node.attrs.mediaType,
                'data-variant-index': node.attrs.variantIndex == null ? '' : String(node.attrs.variantIndex),
            },
            ['div', { class: 'ai-generation-trace-body' }, ['div', { class: 'ai-generation-trace-content' }, 0]],
        ]
    },
} as NodeSpec

export const aiReasoningSectionNodeType = 'aiReasoningSection'

export const aiReasoningSectionNodeSpec = {
    attrs: {
        generationRequestId: { default: '' },
        reasoningRunId: { default: '' },
        reasoningModelId: { default: '' },
        reasoningIndex: { default: null },
        branchOriginNodeId: { default: '' },
        branchForkNodeId: { default: '' },
        branchLineNodeId: { default: '' },
        lineageProjectionScope: { default: 'conversation' },
        isReceivingAnimation: { default: false },
    },
    content: '(paragraph | block)*',
    group: 'block',
    draggable: false,
    parseDOM: [
        {
            tag: 'div.ai-reasoning-section',
            getAttrs(dom: HTMLElement) {
                return {
                    generationRequestId: dom.getAttribute('data-generation-request-id') || '',
                    reasoningRunId: dom.getAttribute('data-reasoning-run-id') || '',
                    reasoningModelId: dom.getAttribute('data-reasoning-model-id') || '',
                    reasoningIndex: parseReasoningIndex(dom.getAttribute('data-reasoning-index')),
                    branchOriginNodeId: dom.getAttribute('data-branch-origin-node-id') || '',
                    branchForkNodeId: dom.getAttribute('data-branch-fork-node-id') || '',
                    branchLineNodeId: dom.getAttribute('data-branch-line-node-id') || '',
                    lineageProjectionScope: normalizeAiLineageProjectionScope(dom.getAttribute('data-lineage-projection-scope')),
                    isReceivingAnimation: false,
                }
            },
        },
    ],
    toDOM(node) {
        return [
            'div',
            {
                class: 'ai-reasoning-section',
                'data-generation-request-id': node.attrs.generationRequestId,
                'data-reasoning-run-id': node.attrs.reasoningRunId,
                'data-reasoning-model-id': node.attrs.reasoningModelId,
                'data-reasoning-index': node.attrs.reasoningIndex == null ? '' : String(node.attrs.reasoningIndex),
                'data-branch-origin-node-id': node.attrs.branchOriginNodeId,
                'data-branch-fork-node-id': node.attrs.branchForkNodeId,
                'data-branch-line-node-id': node.attrs.branchLineNodeId,
                'data-lineage-projection-scope': node.attrs.lineageProjectionScope,
            },
            0,
        ]
    },
} as NodeSpec

export const aiLineageEventNodeType = 'aiLineageEvent'

export const aiLineageEventNodeSpec = {
    attrs: {
        kind: { default: 'branch-fork' },
        branchOriginNodeId: { default: '' },
        branchForkNodeId: { default: '' },
        branchLineNodeId: { default: '' },
        reasoningModelId: { default: '' },
    },
    group: 'block',
    atom: true,
    selectable: false,
    draggable: false,
    parseDOM: [
        {
            tag: 'div.ai-lineage-event',
            getAttrs(dom: HTMLElement) {
                return {
                    kind: normalizeAiLineageEventKind(dom.getAttribute('data-lineage-event-kind')),
                    branchOriginNodeId: dom.getAttribute('data-branch-origin-node-id') || '',
                    branchForkNodeId: dom.getAttribute('data-branch-fork-node-id') || '',
                    branchLineNodeId: dom.getAttribute('data-branch-line-node-id') || '',
                    reasoningModelId: dom.getAttribute('data-reasoning-model-id') || '',
                }
            },
        },
    ],
    toDOM(node) {
        const kind = normalizeAiLineageEventKind(node.attrs.kind)
        return [
            'div',
            {
                class: `ai-lineage-event ai-lineage-event-${kind}`,
                'aria-label': getAiLineageEventLabel(kind),
                'data-help-tooltip': 'aria-label',
                'data-lineage-event-kind': kind,
                'data-branch-origin-node-id': node.attrs.branchOriginNodeId,
                'data-branch-fork-node-id': node.attrs.branchForkNodeId,
                'data-branch-line-node-id': node.attrs.branchLineNodeId,
                'data-reasoning-model-id': node.attrs.reasoningModelId,
            },
        ]
    },
} as NodeSpec

export const aiMediaGenerationProgressNodeType = 'aiMediaGenerationProgress'

export const aiMediaGenerationProgressNodeSpec = {
    attrs: {
        id: { default: '' },
        state: { default: null },
        showSummaryWhenCollapsedItemIds: { default: [] },
    },
    group: 'block',
    atom: true,
    selectable: false,
    draggable: false,
    parseDOM: [{ tag: 'div.ai-media-generation-progress' }],
    toDOM(node) {
        return [
            'div',
            {
                class: 'ai-media-generation-progress',
                'data-media-generation-progress-id': node.attrs.id,
            },
        ]
    },
} as NodeSpec

export const aiChatNodeSpecs = {
    [aiChatThreadNodeType]: aiChatThreadNodeSpec,
    [aiResponseMessageNodeType]: aiResponseMessageNodeSpec,
    [aiUserMessageNodeType]: aiUserMessageNodeSpec,
    [aiGeneratedImageNodeType]: aiGeneratedImageNodeSpec,
    [aiGeneratedVideoNodeType]: aiGeneratedVideoNodeSpec,
    [aiCollapsibleBlockNodeType]: aiCollapsibleBlockNodeSpec,
    [aiReasoningSectionNodeType]: aiReasoningSectionNodeSpec,
    [aiLineageEventNodeType]: aiLineageEventNodeSpec,
    [aiMediaGenerationProgressNodeType]: aiMediaGenerationProgressNodeSpec,
}

function parseVariantIndex(value: string | null): number | null {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function parseTraceBlockAttrs(dom: HTMLElement, title: string) {
    return {
        title,
        isOpen: false,
        isStreaming: false,
        imageGenerationTrace: null,
        imageGenerationTraceId: null,
        videoGenerationTrace: null,
        capabilityGenerationTrace: null,
        generationRequestId: dom.getAttribute('data-generation-request-id') || '',
        reasoningRunId: dom.getAttribute('data-reasoning-run-id') || '',
        mediaRunId: dom.getAttribute('data-media-run-id') || '',
        reasoningModelId: dom.getAttribute('data-reasoning-model-id') || '',
        mediaModelId: dom.getAttribute('data-media-model-id') || '',
        mediaType: dom.getAttribute('data-media-type') || '',
        variantIndex: parseVariantIndex(dom.getAttribute('data-variant-index')),
    }
}

function parseReasoningIndex(value: string | null): number | null {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}
