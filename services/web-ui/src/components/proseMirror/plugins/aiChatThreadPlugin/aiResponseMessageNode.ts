// @ts-nocheck
import { createAiResponseMessageShell } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatMessageShells.ts'

// Define the unique type name for this custom node
export const aiResponseMessageNodeType = 'aiResponseMessage'

// Define the node specification for the AI response message
export const aiResponseMessageNodeSpec = {
    // Attributes that can be set on the node
    attrs: {
        id: { default: '' }, // Unique identifier for the node
        style: { default: '' }, // Custom styles to be applied
        isInitialRenderAnimation: { default: false }, // Flag for initial render animation
        isReceivingAnimation: { default: false }, // Flag for receiving message animation
        aiProvider: { default: '' }, // AI provider (Anthropic or OpenAI)
        generationRequestId: { default: '' },
        reasoningRunId: { default: '' },
        mediaRunId: { default: '' },
        reasoningModelId: { default: '' },
        mediaModelId: { default: '' },
        mediaType: { default: '' },
    },
    // Content allowed inside this node (paragraphs or other block elements)
    // Allow zero-or-more so we can create an empty shell on START_STREAM
    content: '(paragraph | block)*',
    // This node belongs to the 'block' group
    group: 'block',
    // Prevent dragging of this node
    draggable: false,
    // Rules for parsing this node from DOM
    parseDOM: [
        {
            // Only match our specific AI response container, not every div in the editor
            tag: 'div.ai-response-message',
            getAttrs(dom) {
                // Extract attributes from the DOM element
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
    // Rules for rendering this node to DOM
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
        }, 0] // 0 is a placeholder for the node's content
    },
}

// Define the node view for custom rendering and behavior
export const aiResponseMessageNodeView = (node, view, getPos) => {
    const responseShell = createAiResponseMessageShell({
        messageId: node.attrs.id,
    })

    // Get references to the nested elements for manipulation
    const parentWrapper = responseShell.wrapper
    const aiResponseMessageContainer = responseShell.messageEl
    const loadingElement = responseShell.loadingEl
    const responseMessageContent = responseShell.contentEl

    // // Create an accept button
    // const acceptButton = document.createElement('button')
    // acceptButton.className = 'accept-button'
    // acceptButton.innerHTML = checkMarkIcon
    // aiResponseMessageContainer.appendChild(acceptButton)

    // // Create a delete button
    // const deleteButton = document.createElement('button')
    // deleteButton.className = 'delete-button'
    // deleteButton.innerHTML = trashBinIcon
    // aiResponseMessageContainer.appendChild(deleteButton)

    // The only response animation is the one-shot content reveal on first render.
    // Receiving state is conveyed by the loading indicator.
    const updateAnimation = () => {
        responseMessageContent.classList.toggle('node-render-animation', node.attrs.isInitialRenderAnimation)
    }

    const updateLoadingState = () => {
        const isWaitingForContent = node.childCount === 0 && node.attrs.isReceivingAnimation

        aiResponseMessageContainer.classList.toggle('is-waiting', isWaitingForContent)
        aiResponseMessageContainer.classList.toggle('is-empty', isWaitingForContent)

        if (loadingElement) {
            loadingElement.classList.toggle('is-active', isWaitingForContent)
        }
    }

    updateAnimation()
    updateLoadingState()

    // Return the node view object
    return {
        dom: parentWrapper, // The outer DOM node of the node view
        contentDOM: responseMessageContent, // The DOM node that holds the node's content
        ignoreMutation: (mutation) => {
            // Ignore style attribute changes on the wrapper. Without this,
            // ProseMirror's internal MutationObserver can detect a canvas-driven
            // style change and reconcile away the externally-set margin.
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                return true
            }
            return false
        },
        update: (updatedNode) => {
            // Check if the updated node is still of the same type
            if (updatedNode.type.name !== aiResponseMessageNodeType) {
                return false
            }

            node = updatedNode    // Update the node reference and refresh the animation
            responseShell.setMessageId(node.attrs.id)
            updateAnimation()    // Update the content-reveal animation state
            updateLoadingState()

            return true    // Indicate successful update
        },
        destroy: () => {},
    }
}
