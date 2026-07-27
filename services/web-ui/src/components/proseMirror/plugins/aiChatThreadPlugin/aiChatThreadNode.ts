// @ts-nocheck
import { v4 as uuidv4 } from 'uuid'
import { Selection } from 'prosemirror-state'
import { html } from '$src/utils/domTemplates.ts'
import {
    aiChatThreadNodeSpec,
    aiChatThreadNodeType,
} from '@lixpi/prosemirror'

export {
    aiChatThreadNodeSpec,
    aiChatThreadNodeType,
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
            const selection = Selection.near($pos, 1)
            view.dispatch(view.state.tr.setSelection(selection))
        }
    })
}
