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
        contextMode: 'followSelection',
        includeUpstreamContext: false,
        contextNodeIds: [],
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

function sanitizeContextNodeIds(nodeIds: string[] | undefined): string[] {
    return Array.from(new Set((nodeIds ?? []).filter(Boolean)))
}

export function getAiChatPanelState(canvasState: CanvasState | null | undefined): CanvasAiChatPanelState {
    const defaults = createDefaultAiChatPanelState()
    if (!canvasState) return defaults

    const persisted = canvasState.aiChatPanel
    const legacyThreadId = canvasState.lastActiveAiChatThreadId
    const legacyTabs = sanitizeTabs(canvasState.aiChatSidebarTabs)
    const migratedTabs = legacyTabs.length > 0
        ? legacyTabs
        : legacyThreadId
            ? [{ tabId: `thread:${legacyThreadId}`, type: 'thread', refId: legacyThreadId, title: 'AI Chat' }]
            : []
    const tabs = sanitizeTabs(persisted?.tabs ?? migratedTabs)
    const candidateActiveTabId = persisted?.activeTabId ?? canvasState.activeAiChatSidebarTabId
    const activeTabId = candidateActiveTabId && tabs.some((tab) => tab.tabId === candidateActiveTabId)
        ? candidateActiveTabId
        : tabs[0]?.tabId

    return {
        isOpen: persisted?.isOpen ?? Boolean(legacyThreadId),
        isSessionHistoryOpen: persisted?.isSessionHistoryOpen === true,
        tabs,
        ...(activeTabId ? { activeTabId } : {}),
        contextMode: persisted?.contextMode === 'pinnedContext' ? 'pinnedContext' : 'followSelection',
        includeUpstreamContext: persisted?.includeUpstreamContext === true,
        contextNodeIds: sanitizeContextNodeIds(persisted?.contextNodeIds),
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

export function getStandaloneContextNodeIds(
    panelState: CanvasAiChatPanelState,
    selectedNodeIds: Iterable<string>,
    nodes: CanvasNode[],
): string[] {
    const candidateNodeIds = panelState.contextMode === 'followSelection'
        ? Array.from(selectedNodeIds)
        : panelState.contextNodeIds
    const eligibleNodeIds = new Set(
        nodes.filter((node) => node.type !== 'contextRegion').map((node) => node.nodeId),
    )

    return Array.from(new Set(candidateNodeIds.filter((nodeId) => eligibleNodeIds.has(nodeId))))
}
