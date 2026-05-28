'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import Workspace from './workspace.ts'

const transactWriteItems = vi.fn()

describe('Workspace context-region deletion', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).dynamoDBService = { transactWriteItems }
        transactWriteItems.mockResolvedValue(undefined)
    })

    it('atomically removes a region, its dedicated history tab, and its panel draft', async () => {
        const canvasState = {
            sourceContext: {},
            nodes: [
                {
                    nodeId: 'region-1',
                    type: 'contextRegion',
                    referenceId: 'thread-region',
                    position: { x: 0, y: 0 },
                    dimensions: { width: 200, height: 100 },
                },
                {
                    nodeId: 'image-1',
                    type: 'image',
                    fileId: 'image-1',
                    workspaceId: 'workspace-1',
                    src: '/image.png',
                    aspectRatio: 1,
                    position: { x: 10, y: 10 },
                    dimensions: { width: 20, height: 20 },
                },
            ],
            edges: [{ edgeId: 'edge-1', sourceNodeId: 'image-1', targetNodeId: 'region-1' }],
            aiChatPanel: {
                isOpen: true,
                tabs: [
                    { tabId: 'thread:thread-region', type: 'thread', refId: 'thread-region', title: 'Region' },
                    { tabId: 'thread:thread-keep', type: 'thread', refId: 'thread-keep', title: 'Keep' },
                ],
                activeTabId: 'thread:thread-region',
                contextMode: 'followSelection',
                includeUpstreamContext: false,
                contextNodeIds: [],
                drafts: {
                    'thread:thread-region': { content: { type: 'doc' } },
                    'thread:thread-keep': { content: { type: 'doc' } },
                },
            },
            aiChatSidebarTabs: [
                { tabId: 'thread:thread-region', type: 'thread', refId: 'thread-region', title: 'Region' },
                { tabId: 'thread:thread-keep', type: 'thread', refId: 'thread-keep', title: 'Keep' },
            ],
            activeAiChatSidebarTabId: 'thread:thread-region',
            lastActiveAiChatThreadId: 'thread-region',
        } as any

        const result = await Workspace.deleteContextRegion({
            workspaceId: 'workspace-1',
            canvasState,
            contextRegionNodeId: 'region-1',
        })

        expect(result).not.toHaveProperty('error')
        expect((result as any).nodes.map((node: any) => node.nodeId)).toEqual(['image-1'])
        expect((result as any).edges).toEqual([])
        expect((result as any).aiChatPanel.tabs.map((tab: any) => tab.refId)).toEqual(['thread-keep'])
        expect((result as any).aiChatPanel.activeTabId).toBe('thread:thread-keep')
        expect((result as any).aiChatPanel.drafts).toEqual({
            'thread:thread-keep': { content: { type: 'doc' } },
        })
        expect((result as any).lastActiveAiChatThreadId).toBeUndefined()
        expect(transactWriteItems).toHaveBeenCalledWith(expect.objectContaining({
            origin: 'deleteContextRegion',
            transactItems: expect.arrayContaining([
                expect.objectContaining({
                    Delete: expect.objectContaining({
                        Key: { workspaceId: 'workspace-1', threadId: 'thread-region' },
                    }),
                }),
            ]),
        }))
    })
})
