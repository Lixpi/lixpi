
import { html } from '../../../components/domTemplates.ts'
import { createConnectorRenderer } from '../infographics/connectors/index.ts'
import {
    createIconShape,
    createContextShapeSVG,
    startContextSelectionAnimation,
    startThreadGradientAnimation
} from '../infographics/shapes/index.ts'
import { createToggleSwitch } from '../infographics/shapes/toggleSwitch/index.ts'
import { aiLightBulbIcon, contextIcon, documentIcon } from '../../../../../svgIcons/index.ts'
import { ENTRANCE_ANIMATION_DURATION } from '../infographics/animationConstants.ts'

// @ts-ignore - runtime import
import { select } from 'd3-selection'
// @ts-ignore - runtime import
import { easeCubicInOut, easeCubicIn } from 'd3-ease'

type ContextOption = {
    label: string
    value: string
    icon?: string
    description?: string
}

type ThreadSelectionState = {
    threadId: string
    selected: boolean
}

type ContextSelectorConfig = {
    id: string
    options: ContextOption[]
    selectedValue?: string
    onChange?: (value: string) => void
    threadCount?: number           // Total number of threads in document
    currentThreadIndex?: number    // This thread's position (0-based)
    threadSelections?: ThreadSelectionState[]  // Workspace selection state for each thread
    onThreadSelectionChange?: (threadId: string, selected: boolean) => void  // Callback when checkbox changes
}

// ============================================================================
// Helper Functions - Pure, Reusable Logic
// ============================================================================

// Calculate whether a document should be active and connected based on context mode
// Pure function - no side effects
function calculateDocumentState(
    contextValue: string,
    threadIndex: number,
    currentThreadIndex: number,
    threadSelections: ThreadSelectionState[]
): { isActive: boolean; shouldConnect: boolean } {
    if (contextValue === 'Thread') {
        const isCurrentThread = threadIndex === currentThreadIndex
        return { isActive: isCurrentThread, shouldConnect: isCurrentThread }
    } else if (contextValue === 'Document') {
        return { isActive: true, shouldConnect: true }
    } else if (contextValue === 'Workspace') {
        const threadSelection = threadSelections[threadIndex]
        const selected = threadSelection?.selected ?? false
        return { isActive: selected, shouldConnect: selected }
    }
    return { isActive: false, shouldConnect: false }
}

// Calculate Y position for a document in the vertical stack
function calculateDocumentY(
    threadIndex: number,
    totalThreads: number,
    docStackGap: number,
    documentHeight: number,
    baselineY: number
): number {
    const startOffset = -(totalThreads - 1) / 2
    return baselineY + (startOffset + threadIndex) * docStackGap - documentHeight / 2
}

// Calculate Y position for a toggle switch (centered vertically on document)
function calculateToggleSwitchY(
    documentY: number,
    documentHeight: number,
    toggleSwitchSize: number
): number {
    return documentY + documentHeight / 2 - toggleSwitchSize / 2
}

// Create edge configuration for document-to-LLM connection
// Factory function to eliminate duplication
function createDocToLlmEdge(threadIndex: number, curvature: number) {
    return {
        id: `doc-${threadIndex}-to-llm`,
        source: { nodeId: `doc-${threadIndex}`, position: 'right' as const, offset: { x: 2 } },
        target: { nodeId: 'llm', position: 'left' as const, offset: { x: -6 } },
        pathType: 'horizontal-bezier' as const,
        marker: 'arrowhead' as const,
        markerSize: 12,
        markerOffset: { source: 5, target: 10 },
        lineStyle: 'solid' as const,
        strokeWidth: 2,
        curvature
    }
}

// Create node configuration for a document shape
// Encapsulates complex NodeConfig creation
function createDocumentNodeConfig(
    threadIndex: number,
    x: number,
    y: number,
    documentWidth: number,
    isActive: boolean
) {
    return createIconShape({
        id: `doc-${threadIndex}`,
        x,
        y,
        size: documentWidth,
        icon: createContextShapeSVG({
            withGradient: isActive,
            withBackgroundAnimatedGradient: false,
            instanceId: `doc-${threadIndex}`
        }),
        className: `document-block-shape ctx-document ${isActive ? 'ctx-document-active' : 'ctx-document-muted'}`,
        disabled: !isActive
    })
}

// Create node configuration for LLM (light bulb) icon
function createLlmNodeConfig(x: number, y: number, size: number, isActive: boolean = true) {
    return createIconShape({
        id: 'llm',
        x,
        y,
        size,
        icon: aiLightBulbIcon,
        className: `ctx-llm ${isActive ? '' : 'ctx-llm-muted'}`.trim(),
        disabled: !isActive
    })
}

// Check if there are any active connections (at least one document connected)
function hasActiveConnections(
    contextValue: string,
    totalThreads: number,
    currentThreadIndex: number,
    threadSelections: ThreadSelectionState[]
): boolean {
    for (let i = 0; i < totalThreads; i++) {
        const { shouldConnect } = calculateDocumentState(contextValue, i, currentThreadIndex, threadSelections)
        if (shouldConnect) return true
    }
    return false
}

export function createContextSelector(config: ContextSelectorConfig) {
    const {
        id,
        options,
        selectedValue,
        onChange,
        threadCount = 3,
        currentThreadIndex = 1,
        threadSelections = [],
        onThreadSelectionChange
    } = config

    let currentValue = selectedValue || options[0]?.value || ''
    let currentThreadCount = threadCount
    let currentThreadIdx = currentThreadIndex
    let currentThreadSelections = threadSelections
    let domRef: HTMLElement | null = null
    let connector: ReturnType<typeof createConnectorRenderer> | null = null
    let activeAnimations: Array<{ stop: () => void }> = []
    let descriptionText: HTMLElement | null = null
    let toggleSwitchInstances: Map<string, ReturnType<typeof createToggleSwitch>> = new Map()

    // Generate unique instance ID for this selector
    const instanceId = `ctx-${Math.random().toString(36).substr(2, 9)}`

    // Layout constants
    const VIEWBOX_WIDTH = 480
    const VIEWBOX_HEIGHT = 256
    const baselineY = 128
    const TOGGLE_SWITCH_SIZE = 12
    const TOGGLE_SWITCH_MARGIN = 16  // Gap between toggle switch and document shape
    const WORKSPACE_SHIFT = TOGGLE_SWITCH_SIZE + TOGGLE_SWITCH_MARGIN  // How much to shift docs right in workspace mode

    const documentLayout = {
        width: 105.6,
        height: 105.6,
        baseX: 0,  // Base position when no checkboxes
        get x() { return this.baseX },  // Will be dynamically updated
        y: baselineY - 52.8
    }

    const llmLayout = {
        size: 147.2,
        iconX: VIEWBOX_WIDTH - 147.2,  // Always aligned to right edge
        iconY: baselineY - 73.6
    }

    const docRightX = documentLayout.x + documentLayout.width
    const connectorGap = llmLayout.iconX - docRightX

    // Create visualization using D3 transitions - NO CSS!
    const createVisualization = (contextValue: string, previousValue?: string) => {
        if (!domRef) return
        const visualizationContainer = domRef.querySelector('.context-visualization') as HTMLElement
        if (!visualizationContainer) return

        const isWorkspaceMode = contextValue === 'Workspace'
        const wasWorkspaceMode = previousValue === 'Workspace'

        // Calculate target X position for document group
        // Workspace mode: shift right to make room for checkboxes
        // Other modes: align to left
        const targetDocX = isWorkspaceMode ? WORKSPACE_SHIFT : 0

        // Common document stacking parameters
        const docStackGap = 68.8
        const totalThreads = currentThreadCount
        const startOffset = -(totalThreads - 1) / 2

        // FIRST RENDER or MODE CHANGE - destroy and recreate
        const isFirstRender = !connector
        const isModeChange = previousValue && previousValue !== contextValue

        if (isFirstRender || isModeChange) {
            // Clean up existing
            if (connector) connector.destroy()
            toggleSwitchInstances.forEach(ts => ts.destroy())
            toggleSwitchInstances.clear()
            activeAnimations.forEach(anim => anim.stop())
            activeAnimations = []

            // Create new connector
            connector = createConnectorRenderer({
                container: visualizationContainer,
                width: VIEWBOX_WIDTH,
                height: VIEWBOX_HEIGHT,
                instanceId
            })

            // Add document nodes at target position
            for (let i = 0; i < totalThreads; i++) {
                const y = calculateDocumentY(i, totalThreads, docStackGap, documentLayout.height, baselineY)
                const { isActive, shouldConnect } = calculateDocumentState(
                    contextValue,
                    i,
                    currentThreadIdx,
                    currentThreadSelections
                )

                connector.addNode(createDocumentNodeConfig(i, targetDocX, y, documentLayout.width, isActive))

                if (shouldConnect) {
                    const curvature = contextValue === 'Workspace' ? 0.18 : 0.12
                    connector.addEdge(createDocToLlmEdge(i, curvature))
                }
            }

            // Add LLM node (always at same position)
            // Muted if no documents are connected
            const llmIsActive = hasActiveConnections(contextValue, totalThreads, currentThreadIdx, currentThreadSelections)
            connector.addNode(createLlmNodeConfig(llmLayout.iconX, llmLayout.iconY, llmLayout.size, llmIsActive))

            // Render
            connector.render()

            // Animate document shapes sliding to their target position
            if (isModeChange) {
                const svg = visualizationContainer.querySelector('svg')
                if (svg) {
                    const svgSelection = select(svg)
                    const previousDocX = wasWorkspaceMode ? WORKSPACE_SHIFT : 0

                    // Select all document node foreignObjects and animate them
                    for (let i = 0; i < totalThreads; i++) {
                        const y = calculateDocumentY(i, totalThreads, docStackGap, documentLayout.height, baselineY)
                        const docNode = svgSelection.select(`#node-doc-${i}`)

                        if (docNode.node()) {
                            // Set initial position to where they were in previous mode
                            docNode.attr('x', previousDocX)

                            // Animate to target position with easing
                            docNode
                                .transition()
                                .duration(ENTRANCE_ANIMATION_DURATION)
                                .ease(easeCubicIn)
                                .attr('x', targetDocX)
                        }
                    }
                }
            }

            // Add toggle switches if workspace mode (ONLY when workspace mode is active)
            if (isWorkspaceMode) {
                const svg = visualizationContainer.querySelector('svg')
                if (svg) {
                    const svgSelection = select(svg)

                    for (let i = 0; i < totalThreads; i++) {
                        const y = calculateDocumentY(i, totalThreads, docStackGap, documentLayout.height, baselineY)
                        const toggleSwitchY = calculateToggleSwitchY(y, documentLayout.height, TOGGLE_SWITCH_SIZE)
                        const threadSelection = currentThreadSelections[i]
                        const threadId = threadSelection?.threadId || `thread-${i}`
                        const checked = threadSelection?.selected ?? false

                        const toggleSwitch = createToggleSwitch(svgSelection, {
                            id: threadId,
                            x: 0,  // Toggle switches at left edge
                            y: toggleSwitchY,
                            size: TOGGLE_SWITCH_SIZE,
                            checked,
                            onChange: (newChecked, id) => {
                                // Update document state
                                onThreadSelectionChange?.(id, newChecked)

                                // Update connector edges and nodes immediately
                                if (connector) {
                                    const threadIndex = currentThreadSelections.findIndex(ts => ts.threadId === id)
                                    if (threadIndex !== -1) {
                                        const edgeId = `doc-${threadIndex}-to-llm`
                                        const nodeId = `doc-${threadIndex}`
                                        const docY = calculateDocumentY(threadIndex, totalThreads, docStackGap, documentLayout.height, baselineY)

                                        // Update node appearance (active/muted) using factory
                                        const updatedNodeConfig = createDocumentNodeConfig(
                                            threadIndex,
                                            targetDocX,
                                            docY,
                                            documentLayout.width,
                                            newChecked
                                        )
                                        connector.updateNode(nodeId, {
                                            content: updatedNodeConfig.content,
                                            className: updatedNodeConfig.className,
                                            disabled: updatedNodeConfig.disabled
                                        })

                                        if (newChecked) {
                                            // Add edge if checked using factory
                                            connector.addEdge(createDocToLlmEdge(threadIndex, 0.18))
                                        } else {
                                            // Remove edge if unchecked
                                            connector.removeEdge(edgeId)
                                        }

                                        // Update LLM node state based on whether there are any active connections
                                        // We need to check the updated state, so we manually count active connections
                                        let hasAnyActiveConnection = false
                                        for (let j = 0; j < totalThreads; j++) {
                                            if (j === threadIndex) {
                                                // For the current toggle, use the new state
                                                if (newChecked) {
                                                    hasAnyActiveConnection = true
                                                    break
                                                }
                                            } else {
                                                // For other toggles, check their current state
                                                const otherThreadSelection = currentThreadSelections[j]
                                                if (otherThreadSelection?.selected) {
                                                    hasAnyActiveConnection = true
                                                    break
                                                }
                                            }
                                        }

                                        const llmNodeConfig = createLlmNodeConfig(llmLayout.iconX, llmLayout.iconY, llmLayout.size, hasAnyActiveConnection)
                                        connector.updateNode('llm', {
                                            className: llmNodeConfig.className,
                                            disabled: llmNodeConfig.disabled
                                        })

                                        // Re-render connector (this will replace DOM elements and break animations)
                                        connector.render()

                                        // Stop all existing animations and restart them
                                        activeAnimations.forEach(anim => anim.stop())
                                        activeAnimations = []
                                        startGradientAnimations(visualizationContainer, contextValue, totalThreads)
                                    }
                                }
                            }
                        })
                        toggleSwitchInstances.set(threadId, toggleSwitch)
                    }
                }
            }

            // Start gradient animations
            startGradientAnimations(visualizationContainer, contextValue, totalThreads)
        }
    }

    // Helper to start gradient animations
    function startGradientAnimations(container: HTMLElement, contextValue: string, totalThreads: number) {
        if (contextValue === 'Thread') {
            const animationTargetId = `doc-${currentThreadIdx}`
            const animationGradientId = `ctx-grad-${animationTargetId}`
            const threadGradientId = `ctx-thread-grad-${animationTargetId}`
            activeAnimations.push(startContextSelectionAnimation(container, animationTargetId, 1000, animationGradientId))
            activeAnimations.push(startThreadGradientAnimation(container, animationTargetId, 50, threadGradientId))
        } else {
            for (let i = 0; i < totalThreads; i++) {
                const { isActive } = calculateDocumentState(contextValue, i, currentThreadIdx, currentThreadSelections)

                if (isActive) {
                    const animationTargetId = `doc-${i}`
                    const animationGradientId = `ctx-grad-${animationTargetId}`
                    const threadGradientId = `ctx-thread-grad-${animationTargetId}`
                    activeAnimations.push(startContextSelectionAnimation(container, animationTargetId, 1000, animationGradientId))
                    activeAnimations.push(startThreadGradientAnimation(container, animationTargetId, 50, threadGradientId))
                }
            }
        }
    }

    // Handle button click
    const handleOptionClick = (optionValue: string) => {
        if (currentValue === optionValue) return // Already selected

        const previousValue = currentValue
        currentValue = optionValue

        // Update button states and sliding background position
        const optionsContainer = domRef?.querySelector('.context-options') as HTMLElement
        buttons.forEach((btn, idx) => {
            if (options[idx].value === optionValue) {
                btn.classList.add('selected')
                btn.setAttribute('aria-pressed', 'true')
                // Update data-selected attribute to trigger sliding background animation
                if (optionsContainer) {
                    optionsContainer.setAttribute('data-selected', String(idx))
                }
                // Update description text
                if (descriptionText && options[idx].description) {
                    descriptionText.textContent = options[idx].description || ''
                }
            } else {
                btn.classList.remove('selected')
                btn.setAttribute('aria-pressed', 'false')
            }
        })

        // Update visualization with previous value for transitions
        createVisualization(optionValue, previousValue)

        // Call onChange callback
        onChange?.(optionValue)
    }

    // Create buttons for each option
    const buttons: HTMLElement[] = []
    const buttonElements = options.map((option, idx) => {
        const isSelected = option.value === currentValue

        const button = html`
            <button
                type="button"
                className="context-option-button ${isSelected ? 'selected' : ''}"
                onclick=${() => handleOptionClick(option.value)}
                role="radio"
                aria-checked="${isSelected}"
                aria-pressed="${isSelected}"
                data-value="${option.value}"
            >
                ${option.icon ? html`<span className="option-icon" innerHTML=${option.icon}></span>` : ''}
                <span className="option-label">${option.label}</span>
            </button>
        ` as HTMLElement

        buttons.push(button)
        return button
    })

    // Find the initial selected index
    const initialSelectedIndex = options.findIndex(opt => opt.value === currentValue)

    // Get initial description
    const initialDescription = options[initialSelectedIndex >= 0 ? initialSelectedIndex : 0]?.description || ''

    // Create description text element
    descriptionText = html`
        <div className="context-description">${initialDescription}</div>
    ` as HTMLElement

    // Create the container with visualization area
    const dom = html`
        <div className="context-selector" id="${id}" role="radiogroup" aria-label="Context Selector">
            <div className="context-options" data-selected="${initialSelectedIndex >= 0 ? initialSelectedIndex : 0}">
                ${buttonElements}
            </div>
            ${descriptionText}
            <div className="context-visualization"></div>
        </div>
    ` as HTMLElement

    // Store DOM reference
    domRef = dom

    // Initialize visualization
    setTimeout(() => createVisualization(currentValue), 0)

    // Public API
    const getValue = () => currentValue

    const setValue = (value: string) => {
        const option = options.find(opt => opt.value === value)
        if (option) {
            handleOptionClick(value)
        }
    }

    const update = (newConfig: Partial<ContextSelectorConfig>) => {
        if (newConfig.selectedValue !== undefined) {
            setValue(newConfig.selectedValue)
        }

        // Update thread count and index if provided
        if (newConfig.threadCount !== undefined) {
            currentThreadCount = newConfig.threadCount
        }
        if (newConfig.currentThreadIndex !== undefined) {
            currentThreadIdx = newConfig.currentThreadIndex
        }
        if (newConfig.threadSelections !== undefined) {
            currentThreadSelections = newConfig.threadSelections
        }

        // Re-render visualization if thread state changed
        if (newConfig.threadCount !== undefined ||
            newConfig.currentThreadIndex !== undefined ||
            newConfig.threadSelections !== undefined) {
            createVisualization(currentValue)
        }
    }

    const destroy = () => {
        // Clean up animations
        if (activeAnimations.length > 0) {
            activeAnimations.forEach(anim => anim.stop())
            activeAnimations = []
        }
        // Clean up toggle switches
        toggleSwitchInstances.forEach(toggleSwitch => toggleSwitch.destroy())
        toggleSwitchInstances.clear()
        // Clean up connector
        if (connector) {
            connector.destroy()
            connector = null
        }
        // Clean up event listeners (handled automatically by DOM removal)
        buttons.length = 0
        domRef = null
    }

    return {
        dom,
        getValue,
        setValue,
        update,
        destroy
    }
}
