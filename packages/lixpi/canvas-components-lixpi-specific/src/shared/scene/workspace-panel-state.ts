import {
    type CanvasAiChatPanelState,
    type CanvasGeneratedOutputDetailsTarget,
    type CanvasNode,
    type CanvasRightSidePanelMode,
    type CanvasState,
} from '@lixpi/constants'

const RIGHT_SIDE_PANEL_MODES: CanvasRightSidePanelMode[] = ['capabilities', 'artifacts', 'media', 'aiThreads']

function sanitizeTopLevelMode(mode: CanvasRightSidePanelMode | undefined): CanvasRightSidePanelMode {
    return mode && RIGHT_SIDE_PANEL_MODES.includes(mode) ? mode : 'aiThreads'
}

export function createDefaultAiChatPanelState(): CanvasAiChatPanelState {
    return {
        isOpen: false,
        topLevelMode: 'aiThreads',
        contextChips: [],
    }
}

function sanitizeGeneratedOutputDetailsTarget(
    target: CanvasGeneratedOutputDetailsTarget | undefined,
    nodes: CanvasNode[],
): CanvasGeneratedOutputDetailsTarget | undefined {
    if (!target?.nodeId) return undefined

    const node = nodes.find((candidate) => candidate.nodeId === target.nodeId)
    if (!node) return undefined

    const isOutputNode = node.type === 'image'
        || node.type === 'video'
        || node.type === 'capabilityArtifact'
    const isBranchMarkerNode = node.type === 'branchOrigin'
        || node.type === 'branchFork'
        || node.type === 'branchLine'

    if (target.kind === 'output' && isOutputNode) return target
    if (target.kind === 'branch-marker' && isBranchMarkerNode) return target
    return undefined
}

// Context chips reference canvas nodes; drop blanks, duplicates, and ids whose
// node no longer exists so a deleted node can't linger as a force-include.
export function sanitizeContextChips(nodeIds: string[] | undefined, nodes: CanvasNode[]): string[] {
    const eligibleNodeIds = new Set(nodes.map((node) => node.nodeId))
    return Array.from(new Set((nodeIds ?? []).filter((nodeId) => Boolean(nodeId) && eligibleNodeIds.has(nodeId))))
}

export function getAiChatPanelState(canvasState: CanvasState | null | undefined): CanvasAiChatPanelState {
    const defaults = createDefaultAiChatPanelState()
    if (!canvasState) return defaults

    const persisted = canvasState.aiChatPanel
    const generatedOutputDetailsTarget = sanitizeGeneratedOutputDetailsTarget(
        persisted?.generatedOutputDetailsTarget,
        canvasState.nodes,
    )

    return {
        isOpen: persisted?.isOpen === true,
        topLevelMode: sanitizeTopLevelMode(persisted?.topLevelMode),
        ...(generatedOutputDetailsTarget ? { generatedOutputDetailsTarget } : {}),
        contextChips: sanitizeContextChips(persisted?.contextChips, canvasState.nodes),
        ...(persisted?.width !== undefined ? { width: persisted.width } : {}),
    }
}

export function setAiChatPanelState(canvasState: CanvasState, panelState: CanvasAiChatPanelState): CanvasState {
    const normalized = getAiChatPanelState({ ...canvasState, aiChatPanel: panelState })
    const normalizedCanvasState = { ...canvasState } as CanvasState & {
        aiChatSidebarTabs?: unknown
        activeAiChatSidebarTabId?: unknown
    }
    delete normalizedCanvasState.aiChatSidebarTabs
    delete normalizedCanvasState.activeAiChatSidebarTabId
    return {
        ...normalizedCanvasState,
        aiChatPanel: normalized,
    }
}

export function getPersistedPanelConversationIds(panel: unknown): string[] {
    if (!panel || typeof panel !== 'object' || !('tabs' in panel) || !Array.isArray(panel.tabs)) return []
    // Older saved panels can retain conversation tabs even though the live panel does not render them.
    return panel.tabs.flatMap((tab: unknown) => {
        if (!tab || typeof tab !== 'object' || !('type' in tab) || tab.type !== 'thread' || !('refId' in tab)) return []
        return typeof tab.refId === 'string' && tab.refId ? [tab.refId] : []
    })
}
