// ===== BOUNDARY INDICATOR AND COLLAPSE TOGGLE =====
// This code was extracted from aiChatThreadNode.ts
// These functions create the thread boundary indicator UI which includes:
// - A vertical line on the right side of threads
// - An info icon that opens a bubble with context selector
// - A collapse toggle icon (eye slash) for collapsing thread content

import { html } from '$src/utils/domTemplates.ts'
import { chatThreadBoundariesInfoIcon, eyeSlashIcon, contextFilledIcon, documentIcon } from '$src/svgIcons/index.ts'
import { createInfoBubble } from '$src/components/proseMirror/plugins/primitives/infoBubble/index.ts'
import { createContextSelector } from './contextSelector/index.ts'
import { getThreadPositionInfo } from './threadPositionUtils.ts'

// Helper function to create thread boundary indicator
// This creates the visual boundary line and icons on the right side of AI chat threads
function createThreadBoundaryIndicator(wrapperDOM, view, threadId, getPos, isCollapsed) {
    // Create the boundary line element (append to wrapper so it can span full thread height)
    const boundaryLine = html`
        <div className="ai-thread-boundary-indicator-line"></div>
    `
    wrapperDOM.appendChild(boundaryLine)

    // Cache event handlers for hover state
    // These dispatch transactions with 'hoverThread' meta to toggle boundary visibility
    const handleEnter = () => view.dispatch(view.state.tr.setMeta('hoverThread', threadId))
    const handleLeave = () => view.dispatch(view.state.tr.setMeta('hoverThread', null))

    // Will be populated after creating the collapse toggle element
    let collapseToggleIcon

    // Handler for collapse toggle click
    // Dispatches 'toggleCollapse' meta which is handled by appendTransaction in the plugin
    const handleCollapseToggle = (e) => {
        e.stopPropagation()

        // Add click feedback animation (iOS-style tactile feedback)
        collapseToggleIcon.classList.add('click-feedback')
        setTimeout(() => {
            collapseToggleIcon.classList.remove('click-feedback')
        }, 150) // Match animation duration

        view.dispatch(view.state.tr.setMeta('toggleCollapse', { threadId, nodePos: getPos() }))
    }

    // Create the info bubble and boundary icon (boundary icon is now the anchor)
    const { boundaryIcon, infoBubble, contextSelector } = createThreadInfoBubble(view, threadId, getPos)

    // Create the collapse toggle icon - uses eyeSlashIcon with color changes based on state
    // Color is managed by CSS based on .collapsed class on wrapper (applied via decorations)
    collapseToggleIcon = html`
        <div className="ai-thread-collapse-toggle" onclick=${handleCollapseToggle}>
            <div className="collapse-icon" innerHTML=${eyeSlashIcon}></div>
        </div>
    `

    // The boundary indicator container - positioned absolutely to the right of the thread
    const boundaryIndicator = html`
        <div
            className="ai-thread-boundary-indicator"
            onmouseenter=${handleEnter}
            onmouseleave=${handleLeave}
        >
            ${boundaryIcon}
            ${collapseToggleIcon}
        </div>
    `

    // Append infoBubble to document.body to escape stacking context
    // InfoBubble uses position: fixed and will position itself relative to the anchor
    document.body.appendChild(infoBubble.dom)

    return { boundaryIndicator, collapseToggleIcon, infoBubble, contextSelector }
}

// Helper to create a small info bubble near the boundary indicator
// This bubble contains the context selector for choosing Thread/Document/Workspace mode
function createThreadInfoBubble(view, threadId, getPos) {
    // Get current thread context from the node
    const pos = getPos()
    const threadNode = pos !== undefined ? view.state.doc.nodeAt(pos) : null
    const currentThreadContext = threadNode?.attrs.threadContext || 'Thread'

    // Get thread position info for dynamic visualization
    const threadPosInfo = getThreadPositionInfo(view, threadId)
    const threadCount = threadPosInfo?.totalCount || 1
    const currentThreadIndex = threadPosInfo?.index || 0

    // Collect all thread selection states for workspace mode
    const threadSelections = []
    view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'aiChatThread') {
            threadSelections.push({
                threadId: node.attrs.threadId,
                selected: node.attrs.workspaceSelected ?? false
            })
        }
    })

    const headerContent = html`
        <div class="flex justify-start items-center">
            <div class="thread-info-bubble-header">
                <h2>Thread</h2>
                <p>Auto generated title will be here</p>
            </div>
        </div>
    `

    // Create context selector with dynamic thread count
    // Pass currentThreadId so Workspace mode can disable toggle for current thread (always included)
    const contextSelector = createContextSelector({
        id: `thread-context-selector-${threadId}`,
        options: [
            {
                label: 'Thread',
                value: 'Thread',
                icon: chatThreadBoundariesInfoIcon,
                description: 'Only content from this thread is included in the AI context'
            },
            {
                label: 'Document',
                value: 'Document',
                icon: documentIcon,
                description: 'All content from the entire document, including all threads, is included in the AI context'
            },
            {
                label: 'Workspace',
                value: 'Workspace',
                icon: contextFilledIcon,
                description: 'You can configure which threads are included in the AI context below'
            }
        ],
        selectedValue: currentThreadContext,
        threadCount,
        currentThreadIndex,
        currentThreadId: threadId,  // For disabling toggle on current thread in Workspace mode
        threadSelections,
        onChange: (value) => {
            console.log('[AI_DBG][THREAD.contextSelector] onChange', { threadId, value })

            // Update thread node attrs via transaction
            const pos = getPos()
            if (pos !== undefined) {
                const threadNode = view.state.doc.nodeAt(pos)
                if (threadNode) {
                    const newAttrs = { ...threadNode.attrs, threadContext: value }
                    const tr = view.state.tr.setNodeMarkup(pos, undefined, newAttrs)
                    view.dispatch(tr)
                }
            }
        },
        onThreadSelectionChange: (changedThreadId, selected) => {
            console.log('[AI_DBG][THREAD.contextSelector] onThreadSelectionChange', { changedThreadId, selected })

            // Find and update the thread node with matching threadId
            view.state.doc.descendants((node, nodePos) => {
                if (node.type.name === 'aiChatThread' && node.attrs.threadId === changedThreadId) {
                    const newAttrs = { ...node.attrs, workspaceSelected: selected }
                    const tr = view.state.tr.setNodeMarkup(nodePos, undefined, newAttrs)
                    view.dispatch(tr)
                    return false  // Stop searching
                }
            })
        }
    })

    // Create boundary icon that will act as the anchor for the info bubble
    const boundaryIcon = html`
        <div className="ai-thread-boundary-icon" innerHTML=${chatThreadBoundariesInfoIcon}></div>
    `

    // Create info bubble with boundary icon as anchor
    const infoBubble = createInfoBubble({
        id: `thread-info-bubble-${threadId}`,
        anchor: boundaryIcon,
        theme: 'dark',
        arrowSide: 'right',
        headerContent,
        bodyContent: contextSelector.dom,
        visible: false,
        offset: { x: 0, y: 30 },
        arrowCrossOffset: 15, // Move arrow further from corner to accommodate larger border-radius (10px)
        className: 'thread-info-bubble'
    })

    return { boundaryIcon, infoBubble, contextSelector }
}

export { createThreadBoundaryIndicator, createThreadInfoBubble }
