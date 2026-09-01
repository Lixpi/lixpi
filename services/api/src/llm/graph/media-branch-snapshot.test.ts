import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    type MediaBranchCandidateSnapshot,
} from '@lixpi/constants'

import { restrictSnapshotToExplicitRefs } from './media-branch-snapshot.ts'

describe('restrictSnapshotToExplicitRefs', () => {
    it('deduplicates one referenced asset that entered under browser and workspace candidate IDs', () => {
        const snapshot: MediaBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            conversationAssetId: 'conversation-1',
            regionNodeId: 'branch-1',
            activeTargetCandidateId: 'node:reference-node',
            resolvedTargetCandidateId: 'reference-node',
            explicitReferenceCandidateIds: ['node:reference-node', 'reference-node'],
            promptText: 'Create a character from this reference.',
            promptFingerprint: 'prompt-1',
            candidates: [
                {
                    candidateId: 'node:reference-node',
                    nodeId: 'reference-node',
                    assetId: 'asset-reference',
                    imageUrl: 'nats-obj://workspace/reference',
                    roleHints: ['active-target'],
                    ancestorNodeIds: ['reference-node'],
                    sourceContextNodeIds: ['reference-node'],
                    entityTags: ['person'],
                    styleTags: [],
                },
                {
                    candidateId: 'reference-node',
                    nodeId: 'reference-node',
                    assetId: 'asset-reference',
                    imageUrl: 'nats-obj://workspace/reference',
                    roleHints: ['base-context'],
                    ancestorNodeIds: ['reference-node', 'ancestor-node'],
                    sourceContextNodeIds: ['reference-node'],
                    entityTags: [],
                    styleTags: ['portrait'],
                },
            ],
            transcriptContext: 'stale duplicate transcript',
        }

        const restricted = restrictSnapshotToExplicitRefs(snapshot)

        expect(restricted?.candidates).toHaveLength(1)
        expect(restricted?.candidates[0]).toMatchObject({
            candidateId: 'node:reference-node',
            assetId: 'asset-reference',
            roleHints: ['active-target', 'base-context'],
            ancestorNodeIds: ['reference-node', 'ancestor-node'],
            entityTags: ['person'],
            styleTags: ['portrait'],
        })
        expect(restricted?.activeTargetCandidateId).toBe('node:reference-node')
        expect(restricted?.resolvedTargetCandidateId).toBe('node:reference-node')
        expect(restricted?.explicitReferenceCandidateIds).toEqual(['node:reference-node'])
        expect(restricted?.transcriptContext.match(/assetId=asset-reference/g)).toHaveLength(1)
    })
})
