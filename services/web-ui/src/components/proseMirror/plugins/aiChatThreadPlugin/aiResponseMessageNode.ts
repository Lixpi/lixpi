// @ts-nocheck
// Import SVG icons for various UI elements
import {
    gptAvatarIcon,
    microphoneIcon,
    trashBinIcon,
    checkMarkIcon,
    claudeIcon,
    claudeAnimatedFrameIcon,
} from '../../../../svgIcons/index.ts'
import { html } from '../../components/domTemplates.ts'

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
            'data-ai-provider': node.attrs.aiProvider
        }, 0] // 0 is a placeholder for the node's content
    },
}

// Define the node view for custom rendering and behavior
export const aiResponseMessageNodeView = (node, view, getPos) => {
    let animationInterval
    const totalFrames = 8    // Total frames in Claude's animation

    // Create the main wrapper structure using htm
    const parentWrapper = html`
        <div className="ai-response-message-wrapper">
            <div className="ai-response-message">
                <div className="user-avatar assistant-${node.attrs.aiProvider.toLowerCase()}"></div>
                <div className="ai-response-message-boundaries-indicator"></div>
                <div className="ai-response-message-spinner" aria-hidden="true"></div>
                <div className="ai-response-message-content"></div>
            </div>
        </div>
    `

    // Get references to the nested elements for manipulation
    const aiResponseMessageContainer = parentWrapper.querySelector('.ai-response-message')
    const userAvatarContainer = parentWrapper.querySelector('.user-avatar')
    const messageBoundariesIndicator = parentWrapper.querySelector('.ai-response-message-boundaries-indicator')
    const spinnerElement = parentWrapper.querySelector('.ai-response-message-spinner')
    const responseMessageContent = parentWrapper.querySelector('.ai-response-message-content')

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

    // Set the appropriate avatar based on the AI provider
    switch (node.attrs.aiProvider) {
        case 'Anthropic':
            userAvatarContainer.innerHTML = claudeIcon
            break
        case 'OpenAI':
            userAvatarContainer.innerHTML = gptAvatarIcon
            break
        default:
            break
    }

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
        }

        // Toggle classes for animations
        responseMessageContent.classList.toggle('node-render-animation', node.attrs.isInitialRenderAnimation)
        messageBoundariesIndicator.classList.toggle('node-render-animation', node.attrs.isInitialRenderAnimation)
        userAvatarContainer.classList.toggle('node-receiving-animation', node.attrs.isReceivingAnimation)
    }

    const updateSpinnerState = () => {
        const isWaitingForContent = node.childCount === 0 && node.attrs.isReceivingAnimation

        aiResponseMessageContainer.classList.toggle('is-empty', isWaitingForContent)

        if (spinnerElement) {
            spinnerElement.classList.toggle('is-active', isWaitingForContent)
        }
    }

    updateAnimation()
    updateSpinnerState()

    // Return the node view object
    return {
        dom: parentWrapper, // The outer DOM node of the node view
        contentDOM: responseMessageContent, // The DOM node that holds the node's content
        update: (updatedNode) => {
            // Check if the updated node is still of the same type
            if (updatedNode.type.name !== aiResponseMessageNodeType) {
                return false
            }

            node = updatedNode    // Update the node reference and refresh the animation
            updateAnimation()    // Update the animation state
            updateSpinnerState()

            return true    // Indicate successful update
        },
        destroy: () => {
            clearInterval(animationInterval)    // Clean up the animation interval when the node is removed
        }
    }
}