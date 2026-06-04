import type {
    CanvasAiChatPanelState,
    CanvasAiChatSidebarTab,
    CanvasNode,
    CanvasState,
} from '@lixpi/constants'

export const NEW_CHAT_DRAFT_KEY = 'new-chat'

export function createDefaultAiChatPanelState(): CanvasAiChatPanelState {
    return {
        isOpen: false,
        isSessionHistoryOpen: false,
        tabs: [],
        contextChips: [],
    }
}

function sanitizeTabs(tabs: CanvasAiChatSidebarTab[] | undefined): CanvasAiChatSidebarTab[] {
    const seen = new Set<string>()
    const sanitizedTabs: CanvasAiChatSidebarTab[] = []

    for (const tab of tabs ?? []) {
        if (!tab?.tabId || !tab.refId || seen.has(tab.tabId)) continue
        if (tab.type !== 'thread' && tab.type !== 'extraction') continue
        seen.add(tab.tabId)
        sanitizedTabs.push(tab)
    }

    return sanitizedTabs
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
    const tabs = sanitizeTabs(persisted?.tabs)
    const candidateActiveTabId = persisted?.activeTabId
    const activeTabId = candidateActiveTabId && tabs.some((tab) => tab.tabId === candidateActiveTabId)
        ? candidateActiveTabId
        : tabs[0]?.tabId

    return {
        isOpen: persisted?.isOpen === true,
        isSessionHistoryOpen: persisted?.isSessionHistoryOpen === true,
        tabs,
        ...(activeTabId ? { activeTabId } : {}),
        contextChips: sanitizeContextChips(persisted?.contextChips, canvasState.nodes),
        ...(persisted?.width !== undefined ? { width: persisted.width } : {}),
        ...(persisted?.drafts ? { drafts: persisted.drafts } : {}),
    }
}

export function setAiChatPanelState(canvasState: CanvasState, panelState: CanvasAiChatPanelState): CanvasState {
    const normalized = getAiChatPanelState({ ...canvasState, aiChatPanel: panelState })
    const { activeAiChatSidebarTabId: _existingActiveTabId, ...canvasStateWithoutLegacyActiveTab } = canvasState
    return {
        ...canvasStateWithoutLegacyActiveTab,
        aiChatPanel: normalized,
        aiChatSidebarTabs: normalized.tabs,
        ...(normalized.activeTabId ? { activeAiChatSidebarTabId: normalized.activeTabId } : {}),
    }
}
