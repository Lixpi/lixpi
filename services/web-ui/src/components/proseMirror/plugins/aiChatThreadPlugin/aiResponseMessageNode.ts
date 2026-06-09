// @ts-nocheck
// Import SVG icons for various UI elements
import { claudeAnimatedFrameIcon, claudeIcon } from '$src/svgIcons/index.ts'
import { createAiResponseMessageShell } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatMessageShells.ts'
import { html } from '$src/utils/domTemplates.ts'

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
        currentFrame: { default: 0 }, // Current frame for Claude's animation
        generationRequestId: { default: '' },
        reasoningRunId: { default: '' },
        mediaRunId: { default: '' },
        reasoningModelId: { default: '' },
        mediaModelId: { default: '' },
        mediaType: { default: '' },
        variantIndex: { default: null },
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
                    variantIndex: parseVariantIndex(dom.getAttribute('data-variant-index')),
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
            'data-variant-index': node.attrs.variantIndex == null ? '' : String(node.attrs.variantIndex),
        }, 0] // 0 is a placeholder for the node's content
    },
}

function parseVariantIndex(value) {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function formatModelLabel(modelId) {
    if (!modelId) return ''
    const parts = String(modelId).split(':')
    return parts[1] || parts[0] || ''
}

function formatVariantLabel(variantIndex) {
    if (variantIndex == null || !Number.isFinite(Number(variantIndex))) return ''
    return `Variant ${Number(variantIndex) + 1}`
}

// Define the node view for custom rendering and behavior
export const aiResponseMessageNodeView = (node, view, getPos) => {
    let animationInterval
    const totalFrames = 8    // Total frames in Claude's animation

    const responseShell = createAiResponseMessageShell({
        provider: node.attrs.aiProvider,
        messageId: node.attrs.id,
    })

    // Get references to the nested elements for manipulation
    const parentWrapper = responseShell.wrapper
    const aiResponseMessageContainer = responseShell.messageEl
    const userAvatarContainer = responseShell.avatarEl
    const spinnerElement = responseShell.spinnerEl
    const bubbleElement = responseShell.bubbleEl
    const responseMessageContent = responseShell.contentEl
    const runMetaElement = html`<div className="ai-response-run-meta"></div>`
    responseShell.metaEl.appendChild(runMetaElement)

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

    // Function to update the animation state
    const updateAnimation = () => {
        if (node.attrs.aiProvider === 'Anthropic') {
            if (node.attrs.isReceivingAnimation) {
                // Set up Claude's animated avatar
                if (!userAvatarContainer.querySelector('.animated-frame-claude')) {
                    userAvatarContainer.innerHTML = claudeAnimatedFrameIcon
                }

                const svg = userAvatarContainer.querySelector('svg')
                svg.setAttribute('viewBox', `0 ${node.attrs.currentFrame * 100} 100 100`)
                userAvatarContainer.setAttribute('data-frame', node.attrs.currentFrame.toString())    // Set data-frame attribute for animation tracking and external interaction

                // Start the animation interval if not already running
                if (!animationInterval) {
                    animationInterval = setInterval(() => {
                        const newFrame = (node.attrs.currentFrame + 1) % totalFrames
                        // Update the node's attributes with the new frame
                        // IMPORTANT: This triggers an update to the node in the ProseMirror document, I couldn't find a better way to do this :(
                        view.dispatch(view.state.tr.setNodeMarkup(getPos(), null, {...node.attrs, currentFrame: newFrame}))
                    }, 90) // Change frame every 90ms
                }
            } else {
                // Stop the animation when not receiving
                clearInterval(animationInterval)
                animationInterval = null
                userAvatarContainer.innerHTML = claudeIcon    // Reset to the static avatar
            }
        } else {
            responseShell.setProvider(node.attrs.aiProvider)
        }

        // Toggle classes for animations
        responseMessageContent.classList.toggle('node-render-animation', node.attrs.isInitialRenderAnimation)
        userAvatarContainer.classList.toggle('node-receiving-animation', node.attrs.isReceivingAnimation)
    }

    const updateSpinnerState = () => {
        const isWaitingForContent = node.childCount === 0 && node.attrs.isReceivingAnimation

        bubbleElement.classList.toggle('is-waiting', isWaitingForContent)
        aiResponseMessageContainer.classList.toggle('is-empty', isWaitingForContent)

        if (spinnerElement) {
            spinnerElement.classList.toggle('is-active', isWaitingForContent)
        }
    }

    const updateRunMeta = () => {
        const reasoningLabel = formatModelLabel(node.attrs.reasoningModelId)
        const variantLabel = formatVariantLabel(node.attrs.variantIndex)
        runMetaElement.replaceChildren()

        if (reasoningLabel) {
            const modelPill = html`<span className="ai-response-run-pill" title=${String(node.attrs.reasoningModelId || '')}>${reasoningLabel}</span>`
            runMetaElement.appendChild(modelPill)
        }

        if (variantLabel) {
            const variantPill = html`<span className="ai-response-run-pill is-variant">${variantLabel}</span>`
            runMetaElement.appendChild(variantPill)
        }

        runMetaElement.hidden = runMetaElement.childElementCount === 0
    }

    updateAnimation()
    updateSpinnerState()
    updateRunMeta()

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
            responseShell.setProvider(node.attrs.aiProvider)
            updateAnimation()    // Update the animation state
            updateSpinnerState()
            updateRunMeta()

            return true    // Indicate successful update
        },
        destroy: () => {
            clearInterval(animationInterval)    // Clean up the animation interval when the node is removed
        }
    }
}
