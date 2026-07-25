'use strict'

import { describe, expect, it, vi } from 'vitest'
import type { ProviderName } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    ensurePendingGeneratedAssets: vi.fn(),
    getAssetRecord: vi.fn(),
}))

vi.mock('../../services/generated-asset-storage.ts', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../services/generated-asset-storage.ts')>(),
    ensurePendingGeneratedAssets: mocks.ensurePendingGeneratedAssets,
}))
vi.mock('../../models/asset.ts', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../models/asset.ts')>(),
    getAssetRecord: mocks.getAssetRecord,
}))

import { BaseProvider } from './base-provider.ts'
import type { ProviderState } from '../graph/state.ts'

class CapabilityLineageProvider extends BaseProvider {
    readonly providerName: ProviderName = 'Anthropic'

    protected async streamImpl(): Promise<Partial<ProviderState>> {
        return {}
    }

    async plan(state: ProviderState): Promise<Partial<ProviderState>> {
        return await this.planMediaBranchLineage(state)
    }

    setPublisher(publisher: unknown): void {
        this.streamPublisher = publisher as never
    }
}

describe('BaseProvider Capability output lineage', () => {
    it('projects the Tool Asset as the only preassigned child of the resolved source branch', async () => {
        mocks.getAssetRecord.mockResolvedValue({
            assetId: 'asset-character-sheet',
            media: { kind: 'image' },
            lineage: {
                generationRequestId: 'request-1',
                reasoningRunId: 'capability-run-1',
                reasoningModelId: 'capability:character-creator',
                mediaRunId: 'capability-run-1:image:0',
                mediaModelId: 'Google:imagen',
            },
        })
        const mediaLineagePlanned = vi.fn()
        const provider = new CapabilityLineageProvider('workspace-1:thread-1', {
            natsService: { publish: vi.fn() } as any,
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        })
        provider.setPublisher({ mediaLineagePlanned })

        const update = await provider.plan({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            provider: 'Anthropic',
            modelVersion: 'claude',
            aiModelMetaInfo: { provider: 'Anthropic', model: 'claude', modelVersion: 'claude' },
            eventMeta: { organizationId: 'organization-1', userId: 'user-1' },
            generationRun: {
                requestKind: 'single-media',
                generationRequestId: 'request-1',
                reasoningRunId: 'request-1:reasoning:0',
                reasoningModelId: 'Anthropic:claude',
                reasoningIndex: 0,
            },
            capabilityOutputAssetIds: ['asset-character-sheet'],
            mediaBranchCandidateSnapshot: {
                resolverVersion: 'image-branch-vlm-v1',
                conversationAssetId: 'thread-1',
                regionNodeId: 'region-1',
                promptText: 'create a character',
                promptFingerprint: 'prompt-test',
                transcriptContext: '',
                candidates: [{
                    candidateId: 'source-node',
                    nodeId: 'source-node',
                    assetId: 'source-asset',
                    imageUrl: 'nats://source',
                    roleHints: ['generated-variant', 'branch-leaf'],
                    branchId: 'branch-source',
                    ancestorNodeIds: ['source-node'],
                    sourceContextNodeIds: ['source-node'],
                }],
            },
            mediaBranchResolution: {
                resolverKind: 'structured-vlm',
                resolverVersion: 'image-branch-vlm-v1',
                resolverModelProvider: 'OpenAI',
                resolverModelId: 'gpt-4.1',
                mode: 'edit-active-branch',
                operationKind: 'edit_existing',
                targetCandidateId: 'source-node',
                branchId: 'branch-source',
                includeGeneratedCandidateIds: [],
                referenceCandidateIds: ['source-node'],
                sourceContextNodeIds: ['source-node'],
                styleReferenceCandidateIds: [],
                excludedCandidateIds: [],
                visualEntitySummary: '',
                visualStyleSummary: '',
                entityTags: [],
                styleTags: [],
                confidence: 1,
                rationale: 'explicit source',
                decisions: [],
            },
        } as ProviderState)

        expect(update.mediaBranchLineagePlan?.runAssignments).toEqual([
            expect.objectContaining({
                assetId: 'asset-character-sheet',
                parentMediaNodeId: 'source-node',
                lineageParentNodeId: 'branch-line-request-1-r0-image-0',
            }),
        ])
        expect(mocks.ensurePendingGeneratedAssets).toHaveBeenCalledOnce()
        expect(mediaLineagePlanned).toHaveBeenCalledOnce()
    })
})
