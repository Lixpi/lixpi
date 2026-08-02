'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Asset, CanvasState } from '@lixpi/constants'

import {
    migrateAssetMediaIdentity,
    migrateOperationStatusCanvasNodes,
    UnifiedMediaReferenceMigration,
} from './unified-media-reference-migration.ts'

const dynamo = {
    scanItems: vi.fn(),
    transactWrite: vi.fn(),
}

beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as Record<string, unknown>).dynamoDBService = dynamo
})

describe('unified media reference migration', () => {
    it('adds required conservative identity fields to legacy Assets', () => {
        const legacyAsset = {
            assetId: 'asset-1',
            organizationId: 'organization-1',
            title: 'Legacy image',
            scope: 'workspace',
            scopeOwnerId: 'workspace-1',
            originWorkspaceId: 'workspace-1',
            ownerUserId: 'user-1',
            media: {
                kind: 'image',
                originalName: 'legacy.png',
                sourceMimeType: 'image/png',
                modelSafe: true,
                renditions: {
                    original: {
                        name: 'original',
                        status: 'ready',
                        blobHash: 'a'.repeat(64),
                        mimeType: 'image/png',
                        byteSize: 100,
                        updatedAt: 1,
                    },
                },
            },
            documents: {},
            states: {
                lifecycle: 'active',
                media: 'ready',
                conversation: 'none',
                provenance: 'none',
            },
            referenceCount: 1,
            revision: 1,
            createdAt: 1,
            updatedAt: 1,
        }

        expect(migrateAssetMediaIdentity(legacyAsset)).toMatchObject({
            depictionMedium: 'unknown',
            subjectIdentity: {
                classification: 'unknown',
                source: 'automatic-lineage',
                providerVerifications: [],
            },
        })
    })

    it('preserves already-migrated identity records', () => {
        const asset = migrateAssetMediaIdentity({
            assetId: 'asset-1',
            organizationId: 'organization-1',
            title: 'Painting',
            scope: 'workspace',
            scopeOwnerId: 'workspace-1',
            originWorkspaceId: 'workspace-1',
            ownerUserId: 'user-1',
            media: {
                kind: 'image',
                originalName: 'painting.png',
                sourceMimeType: 'image/png',
                modelSafe: true,
                renditions: {
                    original: {
                        name: 'original',
                        status: 'ready',
                        blobHash: 'a'.repeat(64),
                        mimeType: 'image/png',
                        byteSize: 100,
                        updatedAt: 1,
                    },
                },
            },
            depictionMedium: 'painting',
            subjectIdentity: {
                classification: 'fictional',
                source: 'user-attestation',
                currentAttestationId: 'attestation-1',
                providerVerifications: [],
            },
            documents: {},
            states: {
                lifecycle: 'active',
                media: 'ready',
                conversation: 'none',
                provenance: 'none',
            },
            referenceCount: 1,
            revision: 1,
            createdAt: 1,
            updatedAt: 1,
        } as Asset)

        expect(asset.depictionMedium).toBe('painting')
        expect(asset.subjectIdentity.classification).toBe('fictional')
    })

    it('rewrites legacy upload placeholders to the only runtime operation-node shape', () => {
        const legacy = {
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [{
                nodeId: 'upload-1',
                type: 'uploadPlaceholder',
                fileName: 'portrait.png',
                status: 'converting',
                parentNodeId: 'region-1',
                position: { x: 10, y: 20 },
                dimensions: { width: 320, height: 96 },
                createdAt: 1,
                updatedAt: 2,
            }],
            edges: [],
        } as unknown as CanvasState

        const migrated = migrateOperationStatusCanvasNodes(legacy)

        expect(migrated.nodes).toEqual([expect.objectContaining({
            nodeId: 'upload-1',
            type: 'operationStatus',
            operation: 'upload',
            status: 'in-progress',
            title: 'portrait.png',
            parentId: 'region-1',
        })])
        expect(migrateOperationStatusCanvasNodes(migrated)).toBe(migrated)
    })

    it('reports legacy and quarantined records before applying writes', async () => {
        dynamo.scanItems.mockImplementation(async ({ origin }: { origin: string }) => {
            if (origin.endsWith('auditAssets')) {
                return {
                    items: [{
                        assetId: 'corrupt-asset',
                        title: 'Corrupt',
                        media: { kind: 'image', renditions: {} },
                        documents: {},
                        states: { lifecycle: 'active', media: 'ready', conversation: 'none', provenance: 'none' },
                    }],
                }
            }
            return {
                items: [{
                    workspaceId: 'workspace-1',
                    canvasState: {
                        viewport: { x: 0, y: 0, zoom: 1 },
                        nodes: [{
                            nodeId: 'upload-1',
                            type: 'uploadPlaceholder',
                            fileName: 'portrait.png',
                            status: 'converting',
                            position: { x: 0, y: 0 },
                            dimensions: { width: 320, height: 96 },
                            createdAt: 1,
                            updatedAt: 1,
                        }],
                        edges: [],
                    },
                }],
            }
        })

        const audit = await new UnifiedMediaReferenceMigration().audit()

        expect(audit.legacyWorkspaceIds).toEqual(['workspace-1'])
        expect(audit.quarantined).toEqual([expect.objectContaining({
            entityType: 'asset',
            entityId: 'corrupt-asset',
        })])
        expect(dynamo.transactWrite).not.toHaveBeenCalled()
    })
})
