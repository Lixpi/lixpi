import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    type BranchForkCanvasNode,
    type BranchOriginCanvasNode,
    type CanvasNode,
    type OperationStatusCanvasNode,
} from '@lixpi/constants'

import {
    getMediaGenerationReferenceResolutionForMarker,
    getMediaGenerationReferenceResolutionOwner,
    isMediaGenerationReferenceResolutionOperation,
} from './reference-resolution-presentation.ts'

const operation = (overrides: Partial<OperationStatusCanvasNode> = {}): OperationStatusCanvasNode => ({
    nodeId: 'operation-1',
    type: 'operationStatus',
    operation: 'media-generation',
    status: 'action-required',
    title: 'Generating media',
    message: 'Choose which Asset the prompt refers to.',
    generationRequestId: 'request-1',
    candidateAssetIds: ['asset-1', 'asset-2'],
    unresolvedBindingId: 'binding-1',
    requestRevision: 2,
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 120 },
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
})

const branchOrigin = (overrides: Partial<BranchOriginCanvasNode> = {}): BranchOriginCanvasNode => ({
    nodeId: 'branch-origin-1',
    type: 'branchOrigin',
    branchId: 'branch-1',
    generationRequestId: 'request-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 80 },
    temporary: true,
    ...overrides,
})

const branchFork = (overrides: Partial<BranchForkCanvasNode> = {}): BranchForkCanvasNode => ({
    nodeId: 'branch-fork-1',
    type: 'branchFork',
    branchId: 'branch-1',
    generationRequestId: 'request-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 80 },
    temporary: true,
    ...overrides,
})

describe('media generation reference-resolution presentation', () => {
    it('recognizes provider-neutral reference-resolution state', () => {
        expect(isMediaGenerationReferenceResolutionOperation(operation())).toBe(true)
        expect(isMediaGenerationReferenceResolutionOperation(operation({ unresolvedBindingId: undefined }))).toBe(false)
        expect(isMediaGenerationReferenceResolutionOperation(operation({ verificationAssetId: 'asset-1', candidateAssetIds: undefined }))).toBe(false)
    })

    it('attaches request-level ambiguity to the preflight submitted prompt marker', () => {
        const planned = branchOrigin()
        const preflight = branchFork({
            nodeId: 'preflight-1',
            pendingState: {
                phase: 'preflight',
                promptText: 'Edit this character sheet.',
                reasoningModelIds: [],
                imageModelIds: [],
                videoModelIds: [],
            },
        })
        const nodes: CanvasNode[] = [operation(), planned, preflight]

        expect(getMediaGenerationReferenceResolutionOwner(nodes, 'request-1')).toBe(preflight)
        expect(getMediaGenerationReferenceResolutionForMarker(nodes, preflight)).toEqual(operation())
        expect(getMediaGenerationReferenceResolutionForMarker(nodes, planned)).toBeUndefined()
    })

    it('never attaches ambiguity across generation-request identities', () => {
        const marker = branchOrigin({ generationRequestId: 'request-2' })
        const nodes: CanvasNode[] = [operation(), marker]

        expect(getMediaGenerationReferenceResolutionForMarker(nodes, marker)).toBeUndefined()
    })

    it('uses the durable request marker after a reload has no transient preflight marker', () => {
        const marker = branchOrigin()
        const nodes: CanvasNode[] = [operation(), marker]

        expect(getMediaGenerationReferenceResolutionOwner(nodes, 'request-1')).toBe(marker)
        expect(getMediaGenerationReferenceResolutionForMarker(nodes, marker)).toEqual(operation())
    })
})
