// @ts-nocheck
import { v4 as uuidv4 } from 'uuid'
import { TextSelection } from 'prosemirror-state'

export const aiChatThreadNodeType = 'aiChatThread'

export const aiChatThreadNodeSpec = {
    group: 'block',
    // Thread is a pure container: messages + a dedicated input node always at the end
    // New documents start with only `aiUserInput`.
    content: '(aiUserMessage | aiResponseMessage)* aiUserInput',
    defining: false, // Changed to false to allow better cursor interaction
    draggable: false,
    isolating: false, // Changed to false to allow cursor interaction
    attrs: {
        threadId: { default: null },
        status: { default: 'active' }, // active, paused, completed
        // Leave aiModel blank initially; we'll assign first available model from store when models load
        aiModel: { default: '' },
        // Image generation settings
        imageGenerationEnabled: { default: false },
        imageGenerationSize: { default: '1024x1024' }, // 1024x1024, 1536x1024, 1024x1536, auto
        // Previous response ID for multi-turn image editing
        previousResponseId: { default: '' }
    },
    parseDOM: [
        {
            tag: 'div.ai-chat-thread-wrapper',
            getAttrs: (dom) => ({
                threadId: dom.getAttribute('data-thread-id'),
                status: dom.getAttribute('data-status') || 'active',
                aiModel: dom.getAttribute('data-ai-model') || '',
                imageGenerationEnabled: dom.getAttribute('data-image-generation-enabled') === 'true',
                imageGenerationSize: dom.getAttribute('data-image-generation-size') || '1024x1024',
                previousResponseId: dom.getAttribute('data-previous-response-id') || ''
            })
        }
    ],
    toDOM: (node) => [
        'div',
        {
            class: 'ai-chat-thread-wrapper',
            'data-thread-id': node.attrs.threadId,
            'data-status': node.attrs.status,
            'data-ai-model': node.attrs.aiModel,
            'data-image-generation-enabled': node.attrs.imageGenerationEnabled,
            'data-image-generation-size': node.attrs.imageGenerationSize,
            'data-previous-response-id': node.attrs.previousResponseId
        },
        0
    ]
}

export const defaultAttrs = {
    threadId: () => uuidv4(),
    status: 'active'
}

// Define the node view for AI chat thread
export const aiChatThreadNodeView = (node, view, getPos) => {
    // Ensure node has a proper threadId for initial render
    const threadId = node.attrs.threadId || defaultAttrs.threadId()

    // Create DOM structure - the plugin will apply decoration classes like 'receiving' and 'thread-boundary-visible' to this DOM element
    const dom = document.createElement('div')
    dom.className = 'ai-chat-thread-wrapper'
    dom.setAttribute('data-thread-id', threadId)
    dom.setAttribute('data-status', node.attrs.status)

    // Create content container
    const contentDOM = document.createElement('div')
    contentDOM.className = 'ai-chat-thread-content'

    // Append all elements to main wrapper
    dom.appendChild(contentDOM)

    // Setup content focus handling
    setupContentFocus(contentDOM, view, getPos)

    return {
        dom,
        contentDOM,
        ignoreMutation: (mutation) => {
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
            dom.setAttribute('data-thread-id', updatedNode.attrs.threadId)
            dom.setAttribute('data-status', updatedNode.attrs.status)

            // Auto-assign threadId if missing
            if (!updatedNode.attrs.threadId) {
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
        view.focus()
        const pos = getPos()
        if (pos !== undefined) {
            const $pos = view.state.doc.resolve(pos + 1)
            const selection = TextSelection.create(view.state.doc, $pos.pos)
            view.dispatch(view.state.tr.setSelection(selection))
        }
    })
}
