import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import Workspace from './workspace.ts'


const dynamo = {
    getItem: vi.fn(),
    updateItem: vi.fn(),
    transactRead: vi.fn(),
    transactWrite: vi.fn(),
}

// Transactions surface a failed per-item condition as a cancelled transaction,
// not as ConditionalCheckFailedException.
class TransactionCanceledError extends Error {
    readonly CancellationReasons = [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }]

    constructor(message: string) {
        super(message)
        this.name = 'TransactionCanceledException'
    }
}

const transactionalConditionalFailure = (message: string) => new TransactionCanceledError(message)

beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    dynamo.getItem.mockReset()
    ;(globalThis as any).dynamoDBService = dynamo
})

const childMeta = (overrides: Record<string, unknown> = {}) => ({
    workspaceId: 'workspace-1',
    organizationId: 'org-1',
    name: 'Child',
    tagIds: [],
    ancestorIds: ['parent-1'],
    parentWorkspaceId: 'parent-1',
    position: 'V',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
})

const parentMeta = (overrides: Record<string, unknown> = {}) => ({
    ...childMeta(),
    workspaceId: 'parent-1',
    ancestorIds: [],
    parentWorkspaceId: undefined,
    ...overrides,
})

// The resolver reads the workspace meta, then the organization lock with the
// access chain in one consistent read. The full workspace row is read
// alongside and returned only when access is granted.
const mockChain = ({
    parent = parentMeta(),
    child = childMeta(),
    parentGrant,
    childGrant,
    workspace,
}: {
    parent?: Record<string, unknown>
    child?: Record<string, unknown>
    parentGrant?: Record<string, unknown>
    childGrant?: Record<string, unknown>
    workspace?: Record<string, unknown>
}) => {
    dynamo.getItem.mockImplementation(async ({ origin }: { origin: string }) => {
        if (origin === 'WorkspaceTree.getWorkspaceMeta')
            return child

        if (origin === 'WorkspaceTree.getLock')
            return undefined

        if (origin === 'WorkspaceTree.getNavigationRecord')
            return {
                revision: 1,
                revisionId: 'navigation-1',
                schemaVersion: 1,
            }

        if (origin === 'model::Workspace->get(workspace-1)')
            return workspace

        throw new Error(`Unexpected workspace read: ${origin}`)
    })
    dynamo.transactRead.mockResolvedValueOnce([undefined, parent, parentGrant, child, childGrant])
}

describe('Workspace.getWorkspace', () => {
    it('normalizes missing workspaces into NOT_FOUND', async () => {
        dynamo.getItem.mockResolvedValueOnce(undefined)

        await expect(Workspace.getWorkspace({
            workspaceId: 'workspace-1',
            userId: 'user-1',
        })).resolves.toEqual(
            { error: 'NOT_FOUND' },
        )
        expect(dynamo.getItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'workspace-1' },
        }))
    })

    it('returns PERMISSION_DENIED when no grant covers the workspace or its ancestors', async () => {
        mockChain({})

        await expect(Workspace.getWorkspace({
            workspaceId: 'workspace-1',
            userId: 'user-1',
        })).resolves.toEqual(
            { error: 'PERMISSION_DENIED' },
        )
    })

    it('grants through a parent grant and returns the effective level with the grant it used', async () => {
        mockChain({
            parentGrant: {
                userId: 'user-1',
                workspaceId: 'parent-1',
                accessLevel: 'editor',
            },
            workspace: {
                workspaceId: 'workspace-1',
                organizationId: 'org-1',
                updatedAt: 10,
                canvasState: {
                    viewport: {
                        x: 1,
                        y: 2,
                        zoom: 1,
                    },
                    nodes: [{
                        nodeId: 'n-1',
                        type: 'image',
                    }],
                },
            },
        })

        const result = await Workspace.getWorkspace({
            workspaceId: 'workspace-1',
            userId: 'user-1',
        })

        expect(result).toMatchObject({
            workspaceId: 'workspace-1',
            accessLevel: 'editor',
            accessGrant: {
                grantWorkspaceId: 'parent-1',
                accessLevel: 'editor',
                ancestorIds: ['parent-1'],
            },
            canvasStateUpdatedAt: 10,
            canvasState: {
                nodes: [{
                    nodeId: 'n-1',
                    type: 'image',
                }],
                edges: [],
            },
        })
    })

    it('reports a workspace under a deleting ancestor as deleting', async () => {
        mockChain({
            parent: parentMeta({ deletingAt: 77 }),
            childGrant: {
                userId: 'user-1',
                workspaceId: 'workspace-1',
                accessLevel: 'owner',
            },
            workspace: {
                workspaceId: 'workspace-1',
                organizationId: 'org-1',
                updatedAt: 10,
                canvasState: { nodes: [] },
            },
        })

        await expect(Workspace.getWorkspace({
            workspaceId: 'workspace-1',
            userId: 'user-1',
        })).resolves.toMatchObject({
            deletingAt: 77,
            accessLevel: 'owner',
        })
    })
})

// =============================================================================
// WORKSPACE CANVAS MUTATION
// =============================================================================

describe('Workspace.mutateCanvasState', () => {
    it('increments the persisted revision when multiple writes happen in the same millisecond', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(1000)
        dynamo.getItem.mockResolvedValue({
            updatedAt: 1000,
            canvasStateUpdatedAt: 1000,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        const result = await Workspace.mutateCanvasState({
            workspaceId: 'workspace-1',
            mutate: (canvasState) => ({
                changed: true,
                canvasState: {
                    ...canvasState,
                    nodes: [{
                        nodeId: 'node-1',
                        type: 'branchOrigin',
                    } as any],
                },
            }),
        })

        expect(result.canvasStateUpdatedAt).toBe(1001)
        expect(dynamo.transactWrite.mock.calls[0][0].operations[0].expressionAttributeValues).toMatchObject({
            ':expectedCanvasStateUpdatedAt': 1000,
            ':canvasStateUpdatedAt': 1001,
        })
    })

    it('writes the mutator result with a canvasStateUpdatedAt condition and updates workspace meta', async () => {
        dynamo.getItem.mockResolvedValue({
            updatedAt: 10,
            canvasStateUpdatedAt: 7,
            canvasState: {
                viewport: {
                    x: 1,
                    y: 2,
                    zoom: 3,
                },
                nodes: [],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        const changed = await Workspace.mutateCanvasState({
            workspaceId: 'workspace-1',
            origin: 'testCanvasMutation',
            mutate: (canvasState) => ({
                changed: true,
                canvasState: {
                    ...canvasState,
                    nodes: [{
                        nodeId: 'node-1',
                        type: 'branchOrigin',
                    } as any],
                },
            }),
        })

        expect(changed.changed).toBe(true)
        expect(changed.canvasStateUpdatedAt).toBeGreaterThan(0)
        expect(dynamo.transactWrite).toHaveBeenCalledTimes(1)
        const {
            operations,
            origin,
        } = dynamo.transactWrite.mock.calls[0][0]
        expect(origin).toBe('testCanvasMutation')
        expect(operations[0]).toEqual(expect.objectContaining({
            type: 'update',
            tableName: expect.stringContaining('Workspaces'),
            key: { workspaceId: 'workspace-1' },
            updateExpression: 'SET #canvasState = :canvasState, #updatedAt = :updatedAt, #canvasStateUpdatedAt = :canvasStateUpdatedAt',
            conditionExpression: '(#canvasStateUpdatedAt = :expectedCanvasStateUpdatedAt OR (attribute_not_exists(#canvasStateUpdatedAt) AND #updatedAt = :expectedCanvasStateUpdatedAt)) AND attribute_not_exists(#deletingAt)',
            expressionAttributeNames: {
                '#canvasState': 'canvasState',
                '#updatedAt': 'updatedAt',
                '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
                '#deletingAt': 'deletingAt',
            },
            expressionAttributeValues: expect.objectContaining({
                ':canvasState': expect.objectContaining({
                    viewport: {
                        x: 1,
                        y: 2,
                        zoom: 3,
                    },
                    nodes: [expect.objectContaining({ nodeId: 'node-1' })],
                    edges: [],
                }),
                ':expectedCanvasStateUpdatedAt': 7,
                ':updatedAt': expect.any(Number),
                ':canvasStateUpdatedAt': expect.any(Number),
            }),
        }))
        expect(operations[1]).toEqual(expect.objectContaining({
            type: 'update',
            tableName: expect.stringContaining('Workspaces-Meta'),
            key: { workspaceId: 'workspace-1' },
            updates: { updatedAt: expect.any(Number) },
        }))
    })

    it('does not write when the mutator reports no canvas change', async () => {
        dynamo.getItem.mockResolvedValue({
            updatedAt: 10,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [],
                edges: [],
            },
        })

        const changed = await Workspace.mutateCanvasState({
            workspaceId: 'workspace-1',
            mutate: (canvasState) => ({
                changed: false,
                canvasState,
            }),
        })

        expect(changed.changed).toBe(false)
        expect(dynamo.transactWrite).not.toHaveBeenCalled()
    })

    it('uses legacy updatedAt as the canvas save token when canvasStateUpdatedAt is missing', async () => {
        dynamo.getItem.mockResolvedValue({
            updatedAt: 10,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.mutateCanvasState({
            workspaceId: 'workspace-1',
            mutate: (canvasState) => ({
                changed: true,
                canvasState: {
                    ...canvasState,
                    edges: [{
                        edgeId: 'edge-1',
                        sourceNodeId: 'a',
                        targetNodeId: 'b',
                    }],
                },
            }),
        })

        expect(dynamo.transactWrite.mock.calls[0][0].operations[0]).toEqual(expect.objectContaining({
            conditionExpression: '(#canvasStateUpdatedAt = :expectedCanvasStateUpdatedAt OR (attribute_not_exists(#canvasStateUpdatedAt) AND #updatedAt = :expectedCanvasStateUpdatedAt)) AND attribute_not_exists(#deletingAt)',
            expressionAttributeValues: expect.objectContaining({
                ':expectedCanvasStateUpdatedAt': 10,
            }),
        }))
    })

    it('guards rows without any canvas token using attribute_not_exists', async () => {
        dynamo.getItem.mockResolvedValue({
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.mutateCanvasState({
            workspaceId: 'workspace-1',
            mutate: (canvasState) => ({
                changed: true,
                canvasState: {
                    ...canvasState,
                    edges: [{
                        edgeId: 'edge-1',
                        sourceNodeId: 'a',
                        targetNodeId: 'b',
                    }],
                },
            }),
        })

        expect(dynamo.transactWrite.mock.calls[0][0].operations[0]).toEqual(expect.objectContaining({
            conditionExpression: '(attribute_not_exists(#canvasStateUpdatedAt) AND attribute_not_exists(#updatedAt)) AND attribute_not_exists(#deletingAt)',
            expressionAttributeValues: expect.not.objectContaining({
                ':expectedCanvasStateUpdatedAt': expect.anything(),
            }),
        }))
    })

    it('re-reads and retries when a concurrent canvas write wins the canvasStateUpdatedAt condition', async () => {
        const conditionalFailure = transactionalConditionalFailure('stale canvas write')
        dynamo.getItem
            .mockResolvedValueOnce({
                updatedAt: 10,
                canvasStateUpdatedAt: 5,
                canvasState: {
                    viewport: {
                        x: 0,
                        y: 0,
                        zoom: 1,
                    },
                    nodes: [],
                    edges: [],
                },
            })
            .mockResolvedValueOnce({
                updatedAt: 11,
                canvasStateUpdatedAt: 6,
                canvasState: {
                    viewport: {
                        x: 0,
                        y: 0,
                        zoom: 1,
                    },
                    nodes: [{
                        nodeId: 'concurrent-node',
                        type: 'branchOrigin',
                    }],
                    edges: [],
                },
            })
        dynamo.transactWrite
            .mockRejectedValueOnce(conditionalFailure)
            .mockResolvedValueOnce(undefined)

        const changed = await Workspace.mutateCanvasState({
            workspaceId: 'workspace-1',
            origin: 'testCanvasMutation',
            mutate: (canvasState) => ({
                changed: true,
                canvasState: {
                    ...canvasState,
                    nodes: [
                        ...canvasState.nodes,
                        {
                            nodeId: 'projection-node',
                            type: 'branchFork',
                        } as any,
                    ],
                },
            }),
        })

        expect(changed.changed).toBe(true)
        expect(changed.canvasStateUpdatedAt).toBeGreaterThan(0)
        expect(dynamo.getItem).toHaveBeenCalledTimes(2)
        expect(dynamo.transactWrite).toHaveBeenCalledTimes(2)
        expect(dynamo.transactWrite.mock.calls[0][0].operations[0].expressionAttributeValues[':expectedCanvasStateUpdatedAt']).toBe(5)
        expect(dynamo.transactWrite.mock.calls[1][0].operations[0].expressionAttributeValues[':expectedCanvasStateUpdatedAt']).toBe(6)
        expect(dynamo.transactWrite.mock.calls[1][0].operations[0].expressionAttributeValues[':canvasState'].nodes).toEqual([
            expect.objectContaining({ nodeId: 'concurrent-node' }),
            expect.objectContaining({ nodeId: 'projection-node' }),
        ])
    })

    it('exhausts retries after repeated conditional-check failures and throws a deterministic error', async () => {
        const conditionalFailure = transactionalConditionalFailure('continuous stale canvas write')

        dynamo.getItem.mockResolvedValue({
            updatedAt: 12,
            canvasStateUpdatedAt: 12,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [],
                edges: [],
            },
        })
        dynamo.transactWrite.mockRejectedValue(conditionalFailure)

        await expect(Workspace.mutateCanvasState({
            workspaceId: 'workspace-1',
            mutate: () => ({
                changed: true,
                canvasState: {
                    viewport: {
                        x: 0,
                        y: 0,
                        zoom: 1,
                    },
                    nodes: [{
                        nodeId: 'retry-node',
                        type: 'branchOrigin',
                    } as any],
                    edges: [],
                },
            }),
        })).rejects.toThrow('Failed to mutate workspace canvas state after concurrent updates: workspace-1')

        expect(dynamo.getItem).toHaveBeenCalledTimes(5)
        expect(dynamo.transactWrite).toHaveBeenCalledTimes(5)
    })
})

// =============================================================================
// FULL WORKSPACE CANVAS SAVES
// =============================================================================

describe('Workspace.updateCanvasState', () => {
    it('returns a strictly newer revision when the wall clock has not advanced', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(1000)
        dynamo.getItem.mockResolvedValueOnce({
            updatedAt: 1000,
            canvasStateUpdatedAt: 1000,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        const result = await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 1000,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [],
                edges: [],
            },
        })

        expect(result).toMatchObject({
            updatedAt: 1001,
            canvasStateUpdatedAt: 1001,
        })
        expect(dynamo.transactWrite.mock.calls[0][0].operations[0].expressionAttributeValues)
            .toMatchObject({ ':canvasStateUpdatedAt': 1001 })
    })

    it('writes full canvas state with a canvasStateUpdatedAt condition when the client supplies a save token', async () => {
        dynamo.getItem.mockResolvedValueOnce({
            updatedAt: 10,
            canvasStateUpdatedAt: 10,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [{
                    nodeId: 'node-1',
                    type: 'image',
                    assetId: 'asset-1',
                }],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        const result = await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: {
                    x: 1,
                    y: 2,
                    zoom: 1,
                },
                nodes: [{
                    nodeId: 'node-1',
                    type: 'image',
                    assetId: 'asset-1',
                } as any],
                edges: [],
            },
        })

        expect(result).toEqual({
            success: true,
            workspaceId: 'workspace-1',
            updatedAt: expect.any(Number),
            canvasStateUpdatedAt: expect.any(Number),
        })
        expect(dynamo.transactWrite).toHaveBeenCalledTimes(1)
        const {
            operations,
            origin,
        } = dynamo.transactWrite.mock.calls[0][0]
        expect(origin).toBe('updateWorkspaceCanvasState')
        expect(operations[0]).toEqual(expect.objectContaining({
            type: 'update',
            key: { workspaceId: 'workspace-1' },
            updateExpression: 'SET #canvasState = :canvasState, #updatedAt = :updatedAt, #canvasStateUpdatedAt = :canvasStateUpdatedAt',
            conditionExpression: '(#canvasStateUpdatedAt = :expectedCanvasStateUpdatedAt OR (attribute_not_exists(#canvasStateUpdatedAt) AND #updatedAt = :expectedCanvasStateUpdatedAt)) AND attribute_not_exists(#deletingAt)',
            expressionAttributeNames: {
                '#canvasState': 'canvasState',
                '#updatedAt': 'updatedAt',
                '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
                '#deletingAt': 'deletingAt',
            },
            expressionAttributeValues: expect.objectContaining({
                ':expectedCanvasStateUpdatedAt': 10,
                ':canvasState': expect.objectContaining({
                    nodes: [expect.objectContaining({ nodeId: 'node-1' })],
                }),
                ':canvasStateUpdatedAt': expect.any(Number),
            }),
        }))
        expect(operations[1]).toEqual(expect.objectContaining({
            type: 'update',
            tableName: expect.stringContaining('Workspaces-Meta'),
            updates: { updatedAt: expect.any(Number) },
        }))
    })

    it('rejects stale full canvas saves instead of overwriting newer canonical state', async () => {
        const conditionalFailure = transactionalConditionalFailure('stale canvas write')
        dynamo.transactWrite.mockRejectedValueOnce(conditionalFailure)
        dynamo.getItem
            .mockResolvedValueOnce({
                updatedAt: 12,
                canvasStateUpdatedAt: 12,
                canvasState: {
                    viewport: {
                        x: 0,
                        y: 0,
                        zoom: 1,
                    },
                    nodes: [],
                    edges: [],
                },
            })
            .mockResolvedValueOnce({
                updatedAt: 22,
                canvasStateUpdatedAt: 18,
            })

        const result = await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [],
                edges: [],
            },
        })

        expect(result).toEqual({
            success: false,
            workspaceId: 'workspace-1',
            error: 'STALE_CANVAS_STATE',
            currentUpdatedAt: 22,
            currentCanvasStateUpdatedAt: 18,
        })
        expect(dynamo.transactWrite).toHaveBeenCalledTimes(1)
        expect(dynamo.getItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'workspace-1' },
            origin: 'updateWorkspaceCanvasState:stale(workspace-1)',
        }))
    })

    it('allows tokenless full canvas saves only for rows without any canvas token', async () => {
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [],
                edges: [],
            },
        })

        expect(dynamo.transactWrite.mock.calls[0][0].operations[0]).toEqual(expect.objectContaining({
            conditionExpression: '(attribute_not_exists(#canvasStateUpdatedAt) AND attribute_not_exists(#updatedAt)) AND attribute_not_exists(#deletingAt)',
            expressionAttributeValues: expect.not.objectContaining({
                ':expectedCanvasStateUpdatedAt': expect.anything(),
            }),
        }))
    })

    it('rejects legacy canvas storage fields carried over from the pre-Asset data model', async () => {
        dynamo.transactWrite.mockResolvedValue(undefined)

        await expect(Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [{
                    nodeId: 'node-1',
                    type: 'image',
                    fileId: 'legacy-file',
                } as any],
                edges: [],
            },
        })).rejects.toThrow('LEGACY_CANVAS_STORAGE_FIELD_REJECTED:fileId')

        expect(dynamo.transactWrite).not.toHaveBeenCalled()
    })

    it('rejects media nodes that are missing an assetId', async () => {
        dynamo.transactWrite.mockResolvedValue(undefined)

        await expect(Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [{
                    nodeId: 'node-1',
                    type: 'image',
                } as any],
                edges: [],
            },
        })).rejects.toThrow('CANVAS_ASSET_ID_REQUIRED')

        expect(dynamo.transactWrite).not.toHaveBeenCalled()
    })

    it('rejects a canvas save that changes asset node membership', async () => {
        dynamo.getItem.mockResolvedValueOnce({
            updatedAt: 10,
            canvasStateUpdatedAt: 10,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [{
                    nodeId: 'node-1',
                    type: 'image',
                    assetId: 'asset-1',
                }],
                edges: [],
            },
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        await expect(Workspace.updateCanvasState({
            userId: 'user-1',
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [{
                    nodeId: 'node-2',
                    type: 'image',
                    assetId: 'asset-2',
                } as any],
                edges: [],
            },
        })).rejects.toThrow('CANVAS_ASSET_MEMBERSHIP_MUTATION_REJECTED')

        expect(dynamo.transactWrite).not.toHaveBeenCalled()
    })
})

// =============================================================================
// WORKSPACE LIFECYCLE
// =============================================================================

describe('Workspace.getWorkspaceInternal', () => {
    it('returns null for a workspace that does not exist', async () => {
        dynamo.getItem.mockResolvedValueOnce(undefined)

        await expect(Workspace.getWorkspaceInternal({ workspaceId: 'workspace-1' })).resolves.toBeNull()
    })

    it('returns the raw workspace record without an access check', async () => {
        dynamo.getItem.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            accessList: [],
        })

        await expect(Workspace.getWorkspaceInternal({ workspaceId: 'workspace-1' })).resolves.toEqual({
            workspaceId: 'workspace-1',
            accessList: [],
        })
    })
})

describe('Workspace.replaceWorkspaceContent', () => {
    it('rejects legacy canvas storage fields before writing', async () => {
        await expect(Workspace.replaceWorkspaceContent({
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [{
                    nodeId: 'node-1',
                    type: 'image',
                    fileId: 'legacy-file',
                } as any],
                edges: [],
            },
        })).rejects.toThrow('LEGACY_CANVAS_STORAGE_FIELD_REJECTED:fileId')

        expect(dynamo.transactWrite).not.toHaveBeenCalled()
    })

    it('replaces the workspace canvas state under the expected canvasStateUpdatedAt condition', async () => {
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Workspace.replaceWorkspaceContent({
            workspaceId: 'workspace-1',
            expectedCanvasStateUpdatedAt: 10,
            canvasState: {
                viewport: {
                    x: 0,
                    y: 0,
                    zoom: 1,
                },
                nodes: [{
                    nodeId: 'node-1',
                    type: 'image',
                    assetId: 'asset-1',
                } as any],
                edges: [],
            },
        })

        const { operations } = dynamo.transactWrite.mock.calls[0][0]
        expect(operations[0]).toEqual(expect.objectContaining({
            type: 'update',
            key: { workspaceId: 'workspace-1' },
            conditionExpression: '(#canvasStateUpdatedAt = :expectedCanvasStateUpdatedAt OR (attribute_not_exists(#canvasStateUpdatedAt) AND #updatedAt = :expectedCanvasStateUpdatedAt)) AND attribute_not_exists(#deletingAt)',
            expressionAttributeValues: { ':expectedCanvasStateUpdatedAt': 10 },
        }))
        expect(operations[1]).toEqual(expect.objectContaining({
            type: 'update',
            tableName: expect.stringContaining('Workspaces-Meta'),
            updates: { updatedAt: expect.any(Number) },
        }))
    })
})
