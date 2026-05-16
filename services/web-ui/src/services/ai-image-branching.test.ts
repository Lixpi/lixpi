'use strict'

import { describe, expect, it } from 'vitest'

import { buildImageBranchCandidateSnapshot } from '$src/services/ai-image-branching.ts'
import type { CanvasNode, WorkspaceEdge } from '@lixpi/constants'

const regionNode = {
    nodeId: 'region-1',
    type: 'contextRegion',
    referenceId: 'thread-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
} satisfies CanvasNode

const portraitSourceNode = {
    nodeId: 'portrait-source',
    type: 'image',
    fileId: 'portrait-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/portrait-file',
    aspectRatio: 1,
    parentId: 'region-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
} satisfies CanvasNode

const landscapeSourceNode = {
    nodeId: 'landscape-source',
    type: 'image',
    fileId: 'landscape-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/landscape-file',
    aspectRatio: 1,
    parentId: 'region-1',
    position: { x: 120, y: 0 },
    dimensions: { width: 100, height: 100 },
} satisfies CanvasNode

const personGeneratedNode = {
    nodeId: 'person-generated',
    type: 'image',
    fileId: 'person-generated-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/person-generated-file',
    aspectRatio: 1,
    position: { x: 240, y: 0 },
    dimensions: { width: 100, height: 100 },
    generatedBy: {
        aiChatThreadId: 'thread-1',
        responseId: 'response-person',
        aiModel: 'OpenAI:gpt-4.1' as any,
        revisedPrompt: 'make that guy more expressive',
        branchId: 'branch-person',
        promptText: 'make that guy more expressive',
        visualEntitySummary: 'front-facing male portrait with glasses',
        entityTags: ['person'],
        styleTags: [],
        createdAt: 1,
    },
} satisfies CanvasNode

const goatGeneratedNode = {
    nodeId: 'goat-generated',
    type: 'image',
    fileId: 'goat-generated-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/goat-generated-file',
    aspectRatio: 1,
    position: { x: 360, y: 0 },
    dimensions: { width: 100, height: 100 },
    generatedBy: {
        aiChatThreadId: 'thread-1',
        responseId: 'response-goat',
        aiModel: 'OpenAI:gpt-4.1' as any,
        revisedPrompt: 'draw a goat',
        branchId: 'branch-goat',
        promptText: 'draw a goat',
        visualEntitySummary: 'brown goat in colorful painterly landscape',
        entityTags: ['goat'],
        styleTags: [],
        createdAt: 2,
    },
} satisfies CanvasNode

function buildSnapshot(prompt: string, generatedNodes: CanvasNode[] = [personGeneratedNode]) {
    return buildImageBranchCandidateSnapshot({
        regionNodeId: 'region-1',
        threadId: 'thread-1',
        nodes: [regionNode, portraitSourceNode, landscapeSourceNode, ...generatedNodes],
        edges: generatedNodes.map((node) => ({
            edgeId: `edge-region-${node.nodeId}`,
            sourceNodeId: 'region-1',
            targetNodeId: node.nodeId,
        })) as WorkspaceEdge[],
        prompt,
    })
}

describe('buildImageBranchCandidateSnapshot', () => {
    it('collects base context and generated branches without selecting a target', () => {
        const snapshot = buildSnapshot('draw a goat in the style of that landscape painting')

        expect(snapshot.promptText).toBe('draw a goat in the style of that landscape painting')
        expect(snapshot.candidates.map((candidate) => candidate.nodeId).sort()).toEqual([
            'landscape-source',
            'person-generated',
            'portrait-source',
        ])
        expect(snapshot.candidates.find((candidate) => candidate.nodeId === 'landscape-source')?.roleHints).toEqual(['base-context'])
        expect(snapshot.candidates.find((candidate) => candidate.nodeId === 'person-generated')?.roleHints).toContain('generated-variant')
        expect(snapshot.candidates.find((candidate) => candidate.nodeId === 'person-generated')?.roleHints).toContain('branch-leaf')
    })

    it('preserves separate visual labels for goat and person candidates', () => {
        const snapshot = buildSnapshot('make the goat wearing sunglasses', [personGeneratedNode, goatGeneratedNode])

        const personCandidate = snapshot.candidates.find((candidate) => candidate.nodeId === 'person-generated')
        const goatCandidate = snapshot.candidates.find((candidate) => candidate.nodeId === 'goat-generated')

        expect(personCandidate?.branchId).toBe('branch-person')
        expect(personCandidate?.visualEntitySummary).toBe('front-facing male portrait with glasses')
        expect(personCandidate?.entityTags).toEqual(['person'])
        expect(goatCandidate?.branchId).toBe('branch-goat')
        expect(goatCandidate?.visualEntitySummary).toBe('brown goat in colorful painterly landscape')
        expect(goatCandidate?.entityTags).toEqual(['goat'])
    })

    it('uses nats object references so the API VLM can fetch candidate pixels', () => {
        const snapshot = buildSnapshot('make a painting of that guy look like cubist oil painting')

        expect(snapshot.candidates.map((candidate) => candidate.imageUrl)).toContain('nats-obj://workspace-workspace-1-files/person-generated-file')
        expect(snapshot.candidates.map((candidate) => candidate.imageUrl)).toContain('nats-obj://workspace-workspace-1-files/portrait-file')
    })
})