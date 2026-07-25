'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CapabilityCatalogRecord, CapabilityResourceRef } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    saveCapability: vi.fn(),
    storeCapabilityResource: vi.fn(),
}))

vi.mock('uuid', () => ({ v4: () => 'generated-id' }))
vi.mock('../../../../models/capability.ts', () => ({
    saveCapability: mocks.saveCapability,
    storeCapabilityResource: mocks.storeCapabilityResource,
}))

import { persistStyle } from './stage6-persist.ts'
import type { StyleExtractionState, StageLogger } from './types.ts'

const logger: StageLogger = {
    styleExtractionRunId: 'run-1',
    emit: vi.fn(),
    chunk: vi.fn(),
    span: async (_stage, _model, body) => await body(),
}

function makeState(): StyleExtractionState {
    return {
        input: {
            styleExtractionRunId: 'run-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            organizationId: 'organization-1',
            messages: [],
            analysisProvider: 'OpenAI',
            analysisModel: { provider: 'OpenAI', model: 'gpt-5', modelVersion: 'gpt-5' },
        },
        references: [{ imageRef: 'input-0', url: 'nats-obj://source', assetId: 'asset-1' }],
        axisExtractions: {},
        failedAxes: [],
        sourceCrops: [{
            idx: 0,
            subject: 'source crop',
            ext: 'png',
            blobHash: 'a'.repeat(64),
            kind: 'source-crop',
        }],
        samples: [{
            idx: 0,
            subject: 'texture probe',
            ext: 'jpg',
            blobHash: 'b'.repeat(64),
            kind: 'texture-specimen',
        }],
        draft: {
            category: 'illustration-style',
            name: 'Fibrous Ink',
            summary: 'Visible fibers and dry ink edges.',
            tags: ['ink'],
            instructions: 'Use visible fibers and dry ink edges.',
            parameters: { grain: 'rough' },
            recommendedSampleSubjects: [],
        },
    }
}

describe('visual-style Capability persistence', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.storeCapabilityResource.mockImplementation(async ({
            resourceId,
            mediaType,
            role,
            name,
        }): Promise<CapabilityResourceRef> => ({
            resourceId,
            blobHash: resourceId.padEnd(64, '0').slice(0, 64),
            mediaType,
            role,
            name,
        }))
        mocks.saveCapability.mockImplementation(async ({ manifest }): Promise<CapabilityCatalogRecord> => ({
            capabilityId: manifest.capabilityId,
            kind: 'tool',
            scope: 'organization',
            scopeOwnerId: 'organization-1',
            storageOwnerId: 'organization-1',
            manifestBlobHash: 'c'.repeat(64),
            catalogExposure: 'standalone',
            status: 'active',
            ownerUserId: 'user-1',
            createdAt: 1,
            updatedAt: 1,
        }))
    })

    it('saves extraction output as an organization visual-style Tool with sample resources', async () => {
        const result = await persistStyle(makeState(), logger, {
            runImageRouter: vi.fn(),
            getAllowedActions: () => new Set(['visual-style.apply']),
        })

        expect(result).toEqual({
            capabilityId: 'visual-style.generated-id',
            capability: {
                capabilityId: 'visual-style.generated-id',
                name: 'Fibrous Ink',
                category: 'illustration-style',
                summary: 'Visible fibers and dry ink edges.',
                tags: ['ink'],
                sampleCount: 2,
            },
        })
        expect(mocks.saveCapability).toHaveBeenCalledOnce()
        const saveInput = mocks.saveCapability.mock.calls[0]![0]
        expect(saveInput).toMatchObject({
            scope: 'organization',
            scopeOwnerId: 'organization-1',
            storageOwnerId: 'organization-1',
            requester: { userId: 'user-1', organizationIds: ['organization-1'] },
        })
        expect(saveInput.manifest).toMatchObject({
            capabilityId: 'visual-style.generated-id',
            kind: 'tool',
            tool: {
                toolType: 'visual-style',
                executionPolicy: 'required',
                workflow: {
                    steps: [expect.objectContaining({ action: 'visual-style.apply' })],
                },
            },
        })
        expect(saveInput.manifest.resources).toEqual(expect.arrayContaining([
            expect.objectContaining({ resourceId: 'visual-style-sample-0', blobHash: 'a'.repeat(64), role: 'example' }),
            expect.objectContaining({ resourceId: 'visual-style-sample-1', blobHash: 'b'.repeat(64), role: 'example' }),
        ]))
        expect(saveInput.manifest.tool.workflow.steps[0].input).toMatchObject({
            sample0: { source: 'resource', resourceId: 'visual-style-sample-0' },
            sample1: { source: 'resource', resourceId: 'visual-style-sample-1' },
        })
    })
})
