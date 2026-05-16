'use strict'

import { describe, expect, it } from 'vitest'

import { resolveImageBranchForPrompt } from '$src/services/ai-image-branching.ts'

const regionNode = {
    nodeId: 'region-1',
    type: 'contextRegion',
    referenceId: 'thread-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
}

const portraitSourceNode = {
    nodeId: 'portrait-source',
    type: 'image',
    fileId: 'portrait-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/portrait-file',
    parentId: 'region-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
}

const landscapeSourceNode = {
    nodeId: 'landscape-source',
    type: 'image',
    fileId: 'landscape-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/landscape-file',
    parentId: 'region-1',
    position: { x: 120, y: 0 },
    dimensions: { width: 100, height: 100 },
}

const personGeneratedNode = {
    nodeId: 'person-generated',
    type: 'image',
    fileId: 'person-generated-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/person-generated-file',
    position: { x: 240, y: 0 },
    dimensions: { width: 100, height: 100 },
    generatedBy: {
        aiChatThreadId: 'thread-1',
        branchId: 'branch-person',
        promptText: 'make that guy more expressive',
        entityTags: ['person'],
        styleTags: [],
        createdAt: 1,
    },
}

const goatGeneratedNode = {
    nodeId: 'goat-generated',
    type: 'image',
    fileId: 'goat-generated-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/goat-generated-file',
    position: { x: 360, y: 0 },
    dimensions: { width: 100, height: 100 },
    generatedBy: {
        aiChatThreadId: 'thread-1',
        branchId: 'branch-goat',
        promptText: 'draw a goat',
        entityTags: ['goat'],
        styleTags: [],
        createdAt: 2,
    },
}

function resolve(prompt: string, generatedNodes: unknown[] = [personGeneratedNode]) {
    return resolveImageBranchForPrompt({
        regionNodeId: 'region-1',
        threadId: 'thread-1',
        nodes: [regionNode, portraitSourceNode, landscapeSourceNode, ...generatedNodes] as any,
        edges: generatedNodes.map((node) => ({
            edgeId: `edge-region-${(node as any).nodeId}`,
            sourceNodeId: 'region-1',
            targetNodeId: (node as any).nodeId,
        })) as any,
        prompt,
    })
}

describe('resolveImageBranchForPrompt', () => {
    it('does not treat a style-source landscape as the target branch for a new goat request', () => {
        const selection = resolve('draw a goat in the style of that landscape painting')

        expect(selection.mode).toBe('context-only')
        expect(selection.operationKind).toBe('new_image')
        expect(selection.entityTags).toEqual(['goat'])
        expect(selection.includeGeneratedNodeIds).toEqual([])
        expect(selection.referenceImageNodeIds).toEqual(['portrait-source', 'landscape-source'])
    })

    it('does not select the existing person branch for a new goat made in a referenced style', () => {
        const selection = resolve('make a goat in the style of that landscape painting')

        expect(selection.mode).toBe('context-only')
        expect(selection.operationKind).toBe('new_image')
        expect(selection.entityTags).toEqual(['goat'])
        expect(selection.includeGeneratedNodeIds).toEqual([])
    })

    it('continues the person branch when the target phrase names that guy', () => {
        const selection = resolve(
            'make a painting of that guy look like cubist oil painting',
            [personGeneratedNode, goatGeneratedNode]
        )

        expect(selection.mode).toBe('edit-active-branch')
        expect(selection.sourceNodeId).toBe('person-generated')
        expect(selection.includeGeneratedNodeIds).toEqual(['person-generated'])
        expect(selection.referenceImageNodeIds).toEqual(['portrait-source', 'landscape-source', 'person-generated'])
    })

    it('continues the goat branch when the target phrase names the goat', () => {
        const selection = resolve(
            'make the goat wearing sunglasses',
            [personGeneratedNode, goatGeneratedNode]
        )

        expect(selection.mode).toBe('edit-active-branch')
        expect(selection.sourceNodeId).toBe('goat-generated')
        expect(selection.includeGeneratedNodeIds).toEqual(['goat-generated'])
    })
})