// @ts-nocheck
import { v4 as uuidv4 } from 'uuid'
import { keyboardMacCommandIcon,
    keyboardEnterKeyIcon,
    sendIcon,
    pauseIcon,
    chatThreadBoundariesInfoIcon,
    aiRobotFaceIcon,
    gptAvatarIcon,
    claudeIcon,
    chevronDownIcon,
    contextIcon,
    contextFilledIcon,
    documentIcon,
    eyeSlashIcon
} from '../../../../svgIcons/index.ts'
import { TextSelection } from 'prosemirror-state'
import { AI_CHAT_THREAD_PLUGIN_KEY, USE_AI_CHAT_META, STOP_AI_CHAT_META } from './aiChatThreadPluginConstants.ts'
import { html } from '../../components/domTemplates.ts'
import { aiModelsStore } from '../../../../stores/aiModelsStore.js'
import { documentStore } from '../../../../stores/documentStore.js'
import { createPureDropdown } from '../primitives/dropdown/index.ts'
import { createInfoBubble } from '../primitives/infoBubble/index.ts'
import { createContextSelector } from '../primitives/contextSelector/index.ts'
import { getThreadPositionInfo } from './threadPositionUtils.ts'

export const aiChatThreadNodeType = 'aiChatThread'

export const aiChatThreadNodeSpec = {
    group: 'block',
    // Allow paragraphs, AI response messages, code blocks
    // Put 'paragraph' first so PM's contentMatch.defaultType picks it when creating an empty thread
    // Dropdowns are UI controls (outside document schema) managed by thread NodeView
    content: '(paragraph | code_block | aiResponseMessage)+', // Must contain at least one child; default child = paragraph
    defining: false, // Changed to false to allow better cursor interaction
    draggable: false,
    isolating: false, // Changed to false to allow cursor interaction
    attrs: {
        threadId: { default: null },
        status: { default: 'active' }, // active, paused, completed
        // Leave aiModel blank initially; we'll assign first available model from store when models load
        aiModel: { default: '' },
        // Thread context determines scope of content extraction: 'Thread' or 'Document'
        threadContext: { default: 'Thread' },
        // Collapsed state - content is hidden but still receives streaming updates
        isCollapsed: { default: false },
        // Workspace selection state - whether this thread is selected for workspace context
        workspaceSelected: { default: false }
    },
    parseDOM: [
        {
            tag: 'div.ai-chat-thread-wrapper',
            getAttrs: (dom) => ({
                threadId: dom.getAttribute('data-thread-id'),
                status: dom.getAttribute('data-status') || 'active',
                aiModel: dom.getAttribute('data-ai-model') || '',
                threadContext: dom.getAttribute('data-thread-context') || 'Thread',
                isCollapsed: dom.getAttribute('data-is-collapsed') === 'true',
                workspaceSelected: dom.getAttribute('data-workspace-selected') === 'true'
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
            'data-thread-context': node.attrs.threadContext,
            'data-is-collapsed': node.attrs.isCollapsed,
            'data-workspace-selected': node.attrs.workspaceSelected
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

    // Create controls container (absolutely positioned, flex layout)
    const controlsContainer = document.createElement('div')
    controlsContainer.className = 'ai-chat-thread-controls'

    // Create dropdowns outside document schema (like submit button - not document nodes)
    const creationTimestamp = Date.now()
    console.log('[AI_DBG][THREAD.nodeView] CONSTRUCTOR CALLED', {
        threadId,
        initialAiModel: node.attrs.aiModel,
        creationTimestamp,
        contentSize: node.content.size
    })

    const threadContextDropdown = createThreadContextDropdown(view, node, getPos, threadId)
    const modelSelectorDropdown = createAiModelSelectorDropdown(view, node, getPos, threadId)

    // Create AI submit button
    const submitButton = createAiSubmitButton(view, threadId, getPos)

    // Create thread boundary indicator for context visualization
    const { boundaryIndicator: threadBoundaryIndicator, collapseToggleIcon, infoBubble, contextSelector } = createThreadBoundaryIndicator(dom, view, threadId, getPos, node.attrs.isCollapsed)

    // Append controls to controls container (flex layout: context, model, submit)
    controlsContainer.appendChild(threadContextDropdown.dom)
    controlsContainer.appendChild(modelSelectorDropdown.dom)
    controlsContainer.appendChild(submitButton)

    // Append all elements to main wrapper
    dom.appendChild(contentDOM)
    dom.appendChild(controlsContainer)
    dom.appendChild(threadBoundaryIndicator)

    // Setup content focus handling
    setupContentFocus(contentDOM, view, getPos)

    return {
        dom,
        contentDOM,
        ignoreMutation: (mutation) => {
            // Ignore all mutations in controls container (dropdowns, submit button)
            if (mutation.target === controlsContainer || controlsContainer.contains(mutation.target)) {
                console.log('[AI_DBG][THREAD.nodeView.ignoreMutation] IGNORING controls mutation', { type: mutation.type, target: mutation.target })
                return true
            }
            // Ignore mutations in boundary indicator
            if (mutation.target === threadBoundaryIndicator || threadBoundaryIndicator.contains(mutation.target)) {
                return true
            }
            // Let ProseMirror handle content mutations
            console.log('[AI_DBG][THREAD.nodeView.ignoreMutation] ALLOWING mutation', { type: mutation.type, target: mutation.target })
            return false
        },
        update: (updatedNode, decorations) => {
            console.log('[AI_DBG][THREAD.nodeView.update] CALLED', {
                threadId: updatedNode.attrs.threadId,
                nodeType: updatedNode.type.name,
                attrs: updatedNode.attrs,
                oldAttrs: node.attrs,
                decorationsCount: decorations?.length || 0,
                contentSizeChanged: node.content.size !== updatedNode.content.size,
                oldContentSize: node.content.size,
                newContentSize: updatedNode.content.size
            })

            if (updatedNode.type.name !== aiChatThreadNodeType) {
                console.log('[AI_DBG][THREAD.nodeView.update] REJECTED - wrong type', { expected: aiChatThreadNodeType, got: updatedNode.type.name })
                return false
            }

            // Note: We DO NOT check content size changes here!
            // ProseMirror will handle content updates via contentDOM automatically.
            // Returning false would destroy/recreate the NodeView (including dropdowns),
            // which breaks event listeners and state.

            // Update attributes if changed
            dom.setAttribute('data-thread-id', updatedNode.attrs.threadId)
            dom.setAttribute('data-status', updatedNode.attrs.status)
            dom.setAttribute('data-is-collapsed', updatedNode.attrs.isCollapsed)

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
                    console.log('[AI_DBG][THREAD.nodeView.update] assigned new threadId', { threadId: newThreadId })
                }
            }

            // Auto-assign first model if thread has no aiModel set
            if (!updatedNode.attrs.aiModel) {
                const aiModelsData = aiModelsStore.getData()
                if (aiModelsData.length > 0) {
                    const firstModel = aiModelsData[0]
                    const pos = getPos()
                    if (pos !== undefined) {
                        const newAttrs = { ...updatedNode.attrs, aiModel: `${firstModel.provider}:${firstModel.model}` }
                        const tr = view.state.tr.setNodeMarkup(pos, undefined, newAttrs)
                        view.dispatch(tr)
                        console.log('[AI_DBG][THREAD.nodeView.update] auto-assigned first model', {
                            threadId: updatedNode.attrs.threadId,
                            assignedModel: newAttrs.aiModel
                        })
                    }
                }
            }

            // Sync aiModel change to model dropdown
            if (node.attrs.aiModel !== updatedNode.attrs.aiModel) {
                console.log('[AI_DBG][THREAD.nodeView.update] aiModel attr changed', { from: node.attrs.aiModel, to: updatedNode.attrs.aiModel, threadId: updatedNode.attrs.threadId })

                // Find new selected value from store
                const aiModelsData = aiModelsStore.getData()
                const aiAvatarIcons = { gptAvatarIcon, claudeIcon }
                const newSelectedModel = aiModelsData.find(m => `${m.provider}:${m.model}` === updatedNode.attrs.aiModel)

                if (newSelectedModel) {
                    modelSelectorDropdown.update({
                        title: newSelectedModel.shortTitle,
                        icon: aiAvatarIcons[newSelectedModel.iconName],
                        color: newSelectedModel.color,
                        aiModel: `${newSelectedModel.provider}:${newSelectedModel.model}`
                    })
                }
            }

            // Sync threadContext change to context dropdown and context selector
            if (node.attrs.threadContext !== updatedNode.attrs.threadContext) {
                console.log('[AI_DBG][THREAD.nodeView.update] threadContext attr changed', { from: node.attrs.threadContext, to: updatedNode.attrs.threadContext, threadId: updatedNode.attrs.threadContext })

                threadContextDropdown.update({
                    title: updatedNode.attrs.threadContext,
                    icon: contextIcon,
                    value: updatedNode.attrs.threadContext
                })

                // Also update the context selector in the info bubble
                contextSelector?.update({
                    selectedValue: updatedNode.attrs.threadContext
                })
            }

            // Update context selector with current thread position (always, in case threads added/removed)
            const threadPosInfo = getThreadPositionInfo(view, updatedNode.attrs.threadId)
            if (threadPosInfo && contextSelector) {
                // Collect all thread selection states for workspace mode
                const threadSelections: Array<{ threadId: string; selected: boolean }> = []
                view.state.doc.descendants((node, pos) => {
                    if (node.type.name === aiChatThreadNodeType) {
                        threadSelections.push({
                            threadId: node.attrs.threadId,
                            selected: node.attrs.workspaceSelected ?? false
                        })
                    }
                })

                contextSelector.update({
                    threadCount: threadPosInfo.totalCount,
                    currentThreadIndex: threadPosInfo.index,
                    threadSelections
                })
            }

            // Sync isCollapsed change to collapse toggle icon
            if (node.attrs.isCollapsed !== updatedNode.attrs.isCollapsed) {
                console.log('[AI_DBG][THREAD.nodeView.update] isCollapsed attr changed', { from: node.attrs.isCollapsed, to: updatedNode.attrs.isCollapsed, threadId: updatedNode.attrs.threadId })
                // Note: The .collapsed class on wrapper is managed by decorations in the plugin
                // We don't need to manually sync any classes here
            }

            node = updatedNode

            console.log('[AI_DBG][THREAD.nodeView.update] ACCEPTED - returning true')
            return true
        },
        destroy: () => {
            console.log('[AI_DBG][THREAD.nodeView.destroy] CALLED', { threadId: node.attrs.threadId })
            // Clean up pure dropdowns
            modelSelectorDropdown?.destroy()
            threadContextDropdown?.destroy()
            // Clean up info bubble and context selector
            infoBubble?.destroy()
            contextSelector?.destroy()
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

// Helper function to create thread boundary indicator
function createThreadBoundaryIndicator(wrapperDOM, view, threadId, getPos, isCollapsed) {
    // Create the boundary line element (append to wrapper so it can span full thread height)
    const boundaryLine = html`
        <div className="ai-thread-boundary-indicator-line"></div>
    `
    wrapperDOM.appendChild(boundaryLine)

    // Cache event handlers
    const handleEnter = () => view.dispatch(view.state.tr.setMeta('hoverThread', threadId))
    const handleLeave = () => view.dispatch(view.state.tr.setMeta('hoverThread', null))

    // Will be populated after creating the collapse toggle element
    let collapseToggleIcon

    const handleCollapseToggle = (e) => {
        e.stopPropagation()

        // Add click feedback animation
        collapseToggleIcon.classList.add('click-feedback')
        setTimeout(() => {
            collapseToggleIcon.classList.remove('click-feedback')
        }, 150) // Match animation duration

        view.dispatch(view.state.tr.setMeta('toggleCollapse', { threadId, nodePos: getPos() }))
    }

    // Create the info bubble and boundary icon (boundary icon is now the anchor)
    const { boundaryIcon, infoBubble, contextSelector } = createThreadInfoBubble(view, threadId, getPos)

    // Create the collapse toggle icon - uses eyeSlashIcon with color changes based on state
    collapseToggleIcon = html`
        <div className="ai-thread-collapse-toggle" onclick=${handleCollapseToggle}>
            <div className="collapse-icon" innerHTML=${eyeSlashIcon}></div>
        </div>
    `

    // Note: The collapsed state color is managed by CSS based on the .collapsed class
    // on the wrapper, which is applied via decorations in the plugin

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
// Helper to create a small info bubble near the boundary indicator
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
    const threadSelections: Array<{ threadId: string; selected: boolean }> = []
    view.state.doc.descendants((node, pos) => {
        if (node.type.name === aiChatThreadNodeType) {
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
    ` as HTMLElement

    // Create context selector with dynamic thread count
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
                if (node.type.name === aiChatThreadNodeType && node.attrs.threadId === changedThreadId) {
                    const newAttrs = { ...node.attrs, workspaceSelected: selected }
                    const tr = view.state.tr.setNodeMarkup(nodePos, undefined, newAttrs)
                    view.dispatch(tr)
                    return false  // Stop searching
                }
            })
        }
    })

    // Create boundary icon that will act as the anchor
    const boundaryIcon = html`
        <div className="ai-thread-boundary-icon" innerHTML=${chatThreadBoundariesInfoIcon}></div>
    ` as HTMLElement

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
        className: 'thread-info-bubble'
    })

    return { boundaryIcon, infoBubble, contextSelector }
}

// Note: Dropdowns are UI controls (outside document schema), not document nodes
// They dispatch transactions to update thread node attrs directly

// Helper function to create AI model selector dropdown (direct DOM, no document node)
function createAiModelSelectorDropdown(view, node, getPos, threadId) {
    const dropdownId = `ai-model-dropdown-${threadId}`

    const aiAvatarIcons = {
        gptAvatarIcon,
        claudeIcon,
    }

    // Get AI models from store
    const aiModelsData = aiModelsStore.getData()
    const currentAiModel = node.attrs.aiModel || ''
    console.log('[AI_DBG][THREAD.modelDropdown] creating dropdown', { threadId, currentAiModel, modelsCount: aiModelsData.length })

    // Transform data to match dropdown format
    const aiModelsSelectorDropdownOptions = aiModelsData.map(aiModel => ({
        title: aiModel.shortTitle,
        icon: aiAvatarIcons[aiModel.iconName],
        color: aiModel.color,
        aiModel: `${aiModel.provider}:${aiModel.model}`,
        provider: aiModel.provider,
        model: aiModel.model,
        tags: aiModel.modalities?.map(m => m.shortTitle) || []
    }))

    // Extract all unique tags from all models for the filter
    const allTags = new Set<string>()
    aiModelsData.forEach(aiModel => {
        aiModel.modalities?.forEach(m => allTags.add(m.shortTitle))
    })
    const availableTags = Array.from(allTags).sort()

    // Find selected value
    let selectedValue = aiModelsSelectorDropdownOptions.find(model => model.aiModel === currentAiModel)

    // If current thread has no aiModel or it's invalid, use first available model
    if (!selectedValue && aiModelsSelectorDropdownOptions.length > 0) {
        selectedValue = aiModelsSelectorDropdownOptions[0]
    }

    // Default to first if still no selection
    if (!selectedValue) {
        selectedValue = { title: 'Select Model', icon: '', color: '' }
    }

    // Create pure dropdown (no document node, just DOM)
    return createPureDropdown({
        id: dropdownId,
        selectedValue,
        options: aiModelsSelectorDropdownOptions,
        theme: 'dark',

        buttonIcon: chevronDownIcon,
        ignoreColorValuesForOptions: true,
        ignoreColorValuesForSelectedValue: false,
        renderIconForSelectedValue: false,
        renderIconForOptions: true,
        enableTagFilter: true,
        availableTags,
        onSelect: (option) => {
            console.log('[AI_DBG][THREAD.modelDropdown] onSelect', { threadId, option })

            // Update thread node attrs via transaction
            const pos = getPos()
            if (pos !== undefined) {
                const threadNode = view.state.doc.nodeAt(pos)
                if (threadNode) {
                    const newAttrs = { ...threadNode.attrs, aiModel: option.aiModel }
                    const tr = view.state.tr.setNodeMarkup(pos, undefined, newAttrs)
                    view.dispatch(tr)
                }
            }
        }
    })
}

// Helper function to create thread context selector dropdown (direct DOM, no document node)
function createThreadContextDropdown(view, node, getPos, threadId) {
    const dropdownId = `thread-context-dropdown-${threadId}`

    const currentThreadContext = node.attrs.threadContext || 'Thread'
    console.log('[AI_DBG][THREAD.contextDropdown] creating dropdown', { threadId, currentThreadContext })

    // Define thread context options
    const threadContextOptions = [
        {
            title: 'Thread',
            icon: contextIcon,
            value: 'Thread'
        },
        {
            title: 'Document',
            icon: contextIcon,
            value: 'Document'
        }
    ]

    // Find selected value
    const selectedValue = threadContextOptions.find(opt => opt.value === currentThreadContext) || threadContextOptions[0]

    // Create pure dropdown (no document node, just DOM)
    return createPureDropdown({
        id: dropdownId,
        selectedValue,
        options: threadContextOptions,
        theme: 'dark',

        buttonIcon: chevronDownIcon,
        ignoreColorValuesForOptions: true,
        ignoreColorValuesForSelectedValue: false,
        renderIconForSelectedValue: false,
        renderIconForOptions: true,
        onSelect: (option) => {
            console.log('[AI_DBG][THREAD.contextDropdown] onSelect', { threadId, option })

            // Update thread node attrs via transaction
            const pos = getPos()
            if (pos !== undefined) {
                const threadNode = view.state.doc.nodeAt(pos)
                if (threadNode) {
                    const newAttrs = { ...threadNode.attrs, threadContext: option.value }
                    const tr = view.state.tr.setNodeMarkup(pos, undefined, newAttrs)
                    view.dispatch(tr)
                }
            }
        }
    })
}

// Helper function to create AI submit button
function createAiSubmitButton(view, threadId, getPos) {
    // Cache the click handler to avoid recreation
    const handleClick = (e) => {
        e.preventDefault()
        e.stopPropagation()

        // Get plugin state to check if this specific thread is receiving
        const pluginState = AI_CHAT_THREAD_PLUGIN_KEY.getState(view.state)

        if (pluginState?.receivingThreadIds.has(threadId)) {
            // Dispatch stop transaction - plugin will handle the logic
            const tr = view.state.tr.setMeta(STOP_AI_CHAT_META, { threadId })
            view.dispatch(tr)
        } else {
            // Trigger AI chat submission - PASS THE THREAD ID!
            const tr = view.state.tr.setMeta(USE_AI_CHAT_META, { threadId, nodePos: getPos() })
            view.dispatch(tr)
        }
    }

    return html`
        <div
            className="ai-submit-button"
            onclick=${handleClick}
            style=${{ pointerEvents: 'auto', cursor: 'pointer' }}
        >
            <div className="button-default">
                <span className="send-icon" innerHTML=${sendIcon}></span>
            </div>
            <div className="button-hover">
                <span className="send-icon" innerHTML=${sendIcon}></span>
            </div>
            <div className="button-receiving">
                <span className="stop-icon" innerHTML=${pauseIcon}></span>
            </div>
        </div>
    `
}
