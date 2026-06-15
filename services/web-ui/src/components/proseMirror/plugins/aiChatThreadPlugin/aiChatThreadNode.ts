// @ts-nocheck
import { v4 as uuidv4 } from 'uuid'
import { TextSelection } from 'prosemirror-state'
import { html } from '$src/utils/domTemplates.ts'

export const aiChatThreadNodeType = 'aiChatThread'

export const aiChatThreadNodeSpec = {
    group: 'block',
    // Thread is a pure conversation container: messages only.
    // The composer input is now a separate floating canvas element.
    // Starts empty — messages are added when the user submits from the floating input.
    content: '(aiUserMessage | aiResponseMessage)*',
    defining: false, // Changed to false to allow better cursor interaction
    draggable: false,
    isolating: false, // Changed to false to allow cursor interaction
    attrs: {
        threadId: { default: null },
        status: { default: 'active' }, // active, paused, completed
        // Leave aiModel blank initially; we'll assign first available model from store when models load
        aiModel: { default: '' },
        aiModels: { default: '' },
        useMultipleModels: { default: false },
        useMultipleReasoningModels: { default: false },
        useMultipleImageModels: { default: false },
        useMultipleVideoModels: { default: false },
        // Image model for image generation routing (Provider:model format)
        aiImageModel: { default: '' },
        aiImageModels: { default: '' },
        // Image generation settings
        imageGenerationEnabled: { default: false },
        imageGenerationSize: { default: 'auto' }, // 1024x1024, 1536x1024, 1024x1536, auto
        // Previous response ID for multi-turn image editing
        previousResponseId: { default: '' },
        // Video model for video generation routing (Provider:model format)
        aiVideoModel: { default: '' },
        aiVideoModels: { default: '' },
        // Video generation parameters (VEO 3)
        videoAspectRatio: { default: '' },   // e.g. '16:9' | '9:16'
        videoResolution: { default: '' },    // e.g. '720p' | '1080p' | '4k'
        videoDuration: { default: '' },      // string seconds: '4' | '6' | '8'
        // Source VideoCanvasNode id when this thread is "Extend in new thread"
        // off an existing generated video. Read at submit time so the LLM
        // request passes VEO's `video` (extension) parameter via the workspace
        // Object Store URI built from the source node's fileId + workspaceId.
        sourceVideoNodeId: { default: '' }
    },
    parseDOM: [
        {
            tag: 'div.ai-chat-thread-wrapper',
            getAttrs: (dom) => {
                const legacyUseMultipleModels = dom.getAttribute('data-use-multiple-models') === 'true'
                const hasSectionModeAttrs = dom.hasAttribute('data-use-multiple-reasoning-models')
                    || dom.hasAttribute('data-use-multiple-image-models')
                    || dom.hasAttribute('data-use-multiple-video-models')
                const useLegacyModeFallback = legacyUseMultipleModels && !hasSectionModeAttrs
                return {
                    threadId: dom.getAttribute('data-thread-id'),
                    status: dom.getAttribute('data-status') || 'active',
                    aiModel: dom.getAttribute('data-ai-model') || '',
                    aiModels: dom.getAttribute('data-ai-models') || '',
                    useMultipleModels: legacyUseMultipleModels,
                    useMultipleReasoningModels: dom.getAttribute('data-use-multiple-reasoning-models') === 'true' || useLegacyModeFallback,
                    useMultipleImageModels: dom.getAttribute('data-use-multiple-image-models') === 'true' || useLegacyModeFallback,
                    useMultipleVideoModels: dom.getAttribute('data-use-multiple-video-models') === 'true' || useLegacyModeFallback,
                    aiImageModel: dom.getAttribute('data-ai-image-model') || '',
                    aiImageModels: dom.getAttribute('data-ai-image-models') || '',
                    imageGenerationEnabled: dom.getAttribute('data-image-generation-enabled') === 'true',
                    imageGenerationSize: dom.getAttribute('data-image-generation-size') || 'auto',
                    previousResponseId: dom.getAttribute('data-previous-response-id') || '',
                    aiVideoModel: dom.getAttribute('data-ai-video-model') || '',
                    aiVideoModels: dom.getAttribute('data-ai-video-models') || '',
                    videoAspectRatio: dom.getAttribute('data-video-aspect-ratio') || '',
                    videoResolution: dom.getAttribute('data-video-resolution') || '',
                    videoDuration: dom.getAttribute('data-video-duration') || '',
                    sourceVideoNodeId: dom.getAttribute('data-source-video-node-id') || ''
                }
            }
        }
    ],
    toDOM: (node) => {
        const legacyUseMultipleModels = node.attrs.useMultipleModels === true || node.attrs.useMultipleModels === 'true'
        const hasSectionMode = node.attrs.useMultipleReasoningModels === true
            || node.attrs.useMultipleReasoningModels === 'true'
            || node.attrs.useMultipleImageModels === true
            || node.attrs.useMultipleImageModels === 'true'
            || node.attrs.useMultipleVideoModels === true
            || node.attrs.useMultipleVideoModels === 'true'
        const useLegacyModeFallback = legacyUseMultipleModels && !hasSectionMode
        const useMultipleReasoningModels = node.attrs.useMultipleReasoningModels === true
            || node.attrs.useMultipleReasoningModels === 'true'
            || useLegacyModeFallback
        const useMultipleImageModels = node.attrs.useMultipleImageModels === true
            || node.attrs.useMultipleImageModels === 'true'
            || useLegacyModeFallback
        const useMultipleVideoModels = node.attrs.useMultipleVideoModels === true
            || node.attrs.useMultipleVideoModels === 'true'
            || useLegacyModeFallback
        return [
            'div',
            {
                class: 'ai-chat-thread-wrapper',
                'data-thread-id': node.attrs.threadId,
                'data-status': node.attrs.status,
                'data-ai-model': node.attrs.aiModel,
                'data-ai-models': node.attrs.aiModels,
                'data-use-multiple-models': String(useMultipleReasoningModels || useMultipleImageModels || useMultipleVideoModels),
                'data-use-multiple-reasoning-models': String(useMultipleReasoningModels),
                'data-use-multiple-image-models': String(useMultipleImageModels),
                'data-use-multiple-video-models': String(useMultipleVideoModels),
                'data-ai-image-model': node.attrs.aiImageModel,
                'data-ai-image-models': node.attrs.aiImageModels,
                'data-image-generation-enabled': node.attrs.imageGenerationEnabled,
                'data-image-generation-size': node.attrs.imageGenerationSize,
                'data-previous-response-id': node.attrs.previousResponseId,
                'data-ai-video-model': node.attrs.aiVideoModel,
                'data-ai-video-models': node.attrs.aiVideoModels,
                'data-video-aspect-ratio': node.attrs.videoAspectRatio,
                'data-video-resolution': node.attrs.videoResolution,
                'data-video-duration': node.attrs.videoDuration,
                'data-source-video-node-id': node.attrs.sourceVideoNodeId
            },
            0
        ]
    }
}

export const defaultAttrs = {
    threadId: () => uuidv4(),
    status: 'active'
}

// Define the node view for AI chat thread
export const aiChatThreadNodeView = (node, view, getPos) => {
    // Ensure node has a proper threadId for initial render
    const threadId = node.attrs.threadId || defaultAttrs.threadId()

    // The plugin applies decoration classes like receiving/thread boundary to this wrapper.
    const dom = html`
        <div className="ai-chat-thread-wrapper" data=${{ threadId, status: node.attrs.status }}>
            <div className="ai-chat-thread-content"></div>
        </div>
    `
    const contentDOM = dom.querySelector('.ai-chat-thread-content')

    // Setup content focus handling
    setupContentFocus(contentDOM, view, getPos)

    return {
        dom,
        contentDOM,
        ignoreMutation: (mutation) => {
            // Ignore style attribute changes on the wrapper. Without this,
            // ProseMirror's MutationObserver can detect canvas-driven height
            // changes and reconcile away the externally-grown thread height.
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                return true
            }
            // Let ProseMirror handle content mutations
            return false
        },
        update: (updatedNode, decorations) => {
            if (updatedNode.type.name !== aiChatThreadNodeType) {
                return false
            }

            // Note: We DO NOT check content size changes here!
            // ProseMirror will handle content updates via contentDOM automatically.
            // Returning false would destroy/recreate the NodeView (including dropdowns),
            // which breaks event listeners and state.

            // Update attributes if changed
            dom.dataset.threadId = updatedNode.attrs.threadId
            dom.dataset.status = updatedNode.attrs.status

            // Auto-assign threadId if missing
            if (!updatedNode.attrs.threadId && view.editable) {
                const pos = getPos()
                if (pos !== undefined) {
                    const newThreadId = defaultAttrs.threadId()
                    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
                        ...updatedNode.attrs,
                        threadId: newThreadId
                    })
                    view.dispatch(tr)
                }
            }

            node = updatedNode
            return true
        },
        destroy: () => {
            // No-op
        }
    }
}

// Helper function to setup content focus
function setupContentFocus(contentDOM, view, getPos) {
    contentDOM.addEventListener('mousedown', () => {
        if (!view.editable) return

        view.focus()
        const pos = getPos()
        if (pos !== undefined) {
            const $pos = view.state.doc.resolve(pos + 1)
            const selection = TextSelection.create(view.state.doc, $pos.pos)
            view.dispatch(view.state.tr.setSelection(selection))
        }
    })
}
