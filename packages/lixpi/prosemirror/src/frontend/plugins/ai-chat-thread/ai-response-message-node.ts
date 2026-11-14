// @ts-nocheck
import { createAiResponseMessageShell } from './ai-chat-message-shells.ts'
import {
    aiResponseMessageNodeSpec,
    aiResponseMessageNodeType,
} from '@lixpi/prosemirror'

export {
    aiResponseMessageNodeSpec,
    aiResponseMessageNodeType,
}

// Define the node view for custom rendering and behavior
export const aiResponseMessageNodeView = (
    node,
    view,
    getPos,
) => {
    const responseShell = createAiResponseMessageShell({
        messageId: node.attrs.id,
    })

    // Get references to the nested elements for manipulation
    const parentWrapper = responseShell.wrapper
    const aiResponseMessageContainer = responseShell.messageEl
    const loadingElement = responseShell.loadingEl
    const responseMessageContent = responseShell.contentEl
    const capabilityProgressElement = responseShell.capabilityProgressEl
    const failureLabelElement = responseShell.failureLabelEl

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
    const updateAnimation = () => void responseMessageContent.classList.toggle(
        'node-render-animation',
        node.attrs.isInitialRenderAnimation && !node.attrs.failure,
    )

    const updateLoadingState = () => {
        parentWrapper.hidden = node.attrs.conversationRole === 'configuration'
        parentWrapper.dataset.conversationRole = node.attrs.conversationRole ?? 'assistant'
        const failure = node.attrs.failure
        failureLabelElement.hidden = !failure
        aiResponseMessageContainer.classList.toggle(
            'is-failed',
            Boolean(failure),
        )

        if (failure) {
            parentWrapper.dataset.failureCode = failure.code
            aiResponseMessageContainer.setAttribute('role', 'group')
            aiResponseMessageContainer.setAttribute('aria-label', 'Response failed')
        } else {
            delete parentWrapper.dataset.failureCode
            aiResponseMessageContainer.removeAttribute('role')
            aiResponseMessageContainer.removeAttribute('aria-label')
        }

        const isWaitingForContent = !failure
            && node.childCount === 0
            && node.attrs.isReceivingAnimation

        aiResponseMessageContainer.classList.toggle('is-waiting', isWaitingForContent)
        aiResponseMessageContainer.classList.toggle('is-empty', isWaitingForContent)

        if (loadingElement)
            loadingElement.classList.toggle('is-active', isWaitingForContent)
    }

    updateAnimation()
    updateLoadingState()

    // Return the node view object
    return {
        dom: parentWrapper, // The outer DOM node of the node view
        contentDOM: responseMessageContent, // The DOM node that holds the node's content
        ignoreMutation: mutation => {
            if (
                mutation.target === capabilityProgressElement
                || capabilityProgressElement.contains(mutation.target)
                || mutation.target === failureLabelElement
                || failureLabelElement.contains(mutation.target)
            )
                return true

            // Ignore style attribute changes on the wrapper. Without this,
            // ProseMirror's internal MutationObserver can detect a canvas-driven
            // style change and reconcile away the externally-set margin.
            if (
                mutation.type === 'attributes'
                && mutation.attributeName === 'style'
            )
                return true

            return false
        },
        update: updatedNode => {
            // Check if the updated node is still of the same type
            if (updatedNode.type.name !== aiResponseMessageNodeType)
                return false

            node = updatedNode // Update the node reference and refresh the animation
            responseShell.setMessageId(node.attrs.id)
            updateAnimation() // Update the content-reveal animation state
            updateLoadingState()

            return true // Indicate successful update
        },
        destroy: () => {},
    }
}
