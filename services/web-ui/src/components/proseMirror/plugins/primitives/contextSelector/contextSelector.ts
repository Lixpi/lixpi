
import { html } from '../../../components/domTemplates.ts'
import { createConnectorRenderer } from '../infographics/connectors/index.ts'
import {
    createIconShape,
    createContextShapeSVG,
    startContextSelectionAnimation,
    startThreadGradientAnimation
} from '../infographics/shapes/index.ts'
import { createCheckbox } from '../infographics/shapes/checkbox/index.ts'
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
    let checkboxInstances: Map<string, ReturnType<typeof createCheckbox>> = new Map()

    // Generate unique instance ID for this selector
    const instanceId = `ctx-${Math.random().toString(36).substr(2, 9)}`

    // Layout constants
    const VIEWBOX_WIDTH = 480
    const VIEWBOX_HEIGHT = 256
    const baselineY = 128
    const CHECKBOX_SIZE = 24
    const CHECKBOX_MARGIN = 16  // Gap between checkbox and document shape
    const WORKSPACE_SHIFT = CHECKBOX_SIZE + CHECKBOX_MARGIN  // How much to shift docs right in workspace mode

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
            checkboxInstances.forEach(cb => cb.destroy())
            checkboxInstances.clear()
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
                const y = baselineY + (startOffset + i) * docStackGap - documentLayout.height / 2
                const isCurrentThread = i === currentThreadIdx

                let isActive = false
                let shouldConnect = false

                if (contextValue === 'Thread') {
                    isActive = isCurrentThread
                    shouldConnect = isCurrentThread
                } else if (contextValue === 'Document') {
                    isActive = true
                    shouldConnect = true
                } else if (contextValue === 'Workspace') {
                    const threadSelection = currentThreadSelections.find((_, idx) => idx === i)
                    isActive = threadSelection?.selected ?? false
                    shouldConnect = threadSelection?.selected ?? false
                }

                connector.addNode(createIconShape({
                    id: `doc-${i}`,
                    x: targetDocX,  // Already at target position
                    y,
                    size: documentLayout.width,
                    icon: createContextShapeSVG({
                        withGradient: isActive,
                        withBackgroundAnimatedGradient: false,
                        instanceId: `doc-${i}`
                    }),
                    className: `document-block-shape ctx-document ${isActive ? 'ctx-document-active' : 'ctx-document-muted'}`,
                    disabled: !isActive
                }))

                if (shouldConnect) {
                    connector.addEdge({
                        id: `doc-${i}-to-llm`,
                        source: { nodeId: `doc-${i}`, position: 'right', offset: { x: 2 } },
                        target: { nodeId: 'llm', position: 'left', offset: { x: -6 } },
                        pathType: 'horizontal-bezier',
                        marker: 'arrowhead',
                        markerSize: 12,
                        markerOffset: { source: 5, target: 10 },
                        lineStyle: 'solid',
                        strokeWidth: 2,
                        curvature: contextValue === 'Workspace' ? 0.18 : 0.12
                    })
                }
            }

            // Add LLM node (always at same position)
            connector.addNode(createIconShape({
                id: 'llm',
                x: llmLayout.iconX,
                y: llmLayout.iconY,
                size: llmLayout.size,
                icon: aiLightBulbIcon,
                className: 'ctx-llm'
            }))

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
                        const y = baselineY + (startOffset + i) * docStackGap - documentLayout.height / 2
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

            // Add checkboxes if workspace mode (ONLY when workspace mode is active)
            if (isWorkspaceMode) {
                const svg = visualizationContainer.querySelector('svg')
                if (svg) {
                    const svgSelection = select(svg)

                    for (let i = 0; i < totalThreads; i++) {
                        const y = baselineY + (startOffset + i) * docStackGap - documentLayout.height / 2
                        const checkboxY = y + documentLayout.height / 2 - CHECKBOX_SIZE / 2
                        const threadSelection = currentThreadSelections[i]
                        const threadId = threadSelection?.threadId || `thread-${i}`
                        const checked = threadSelection?.selected ?? false

                        const checkbox = createCheckbox(svgSelection, {
                            id: threadId,
                            x: 0,  // Checkboxes at left edge
                            y: checkboxY,
                            size: CHECKBOX_SIZE,
                            checked,
                            onChange: (newChecked, id) => {
                                onThreadSelectionChange?.(id, newChecked)
                            }
                        })
                        checkboxInstances.set(threadId, checkbox)
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
                const shouldAnimate = contextValue === 'Workspace'
                    ? (currentThreadSelections.find((_, idx) => idx === i)?.selected ?? false)
                    : true

                if (shouldAnimate) {
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
        // Clean up checkboxes
        checkboxInstances.forEach(checkbox => checkbox.destroy())
        checkboxInstances.clear()
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
