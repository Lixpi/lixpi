'use strict'

import { describe, expect, it } from 'vitest'

import {
    buildImageBranchCandidateSnapshot,
    getGeneratedImageTextByNodeIdFromThreadContent,
} from '$src/services/ai-image-branching.ts'
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

const refinedPersonGeneratedNode = {
    nodeId: 'person-refined',
    type: 'image',
    fileId: 'person-refined-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/person-refined-file',
    aspectRatio: 1,
    position: { x: 480, y: 0 },
    dimensions: { width: 100, height: 100 },
    generatedBy: {
        aiChatThreadId: 'thread-1',
        responseId: 'response-refined',
        responseMessageId: 'response-refined-message',
        aiModel: 'OpenAI:gpt-4.1' as any,
        revisedPrompt: 'orange monochrome portrait with glasses',
        parentImageNodeId: 'person-generated',
        branchId: 'branch-person',
        promptText: 'make the same man orange monochrome',
        sourceContextNodeIds: ['portrait-source'],
        visualEntitySummary: 'orange monochrome portrait of the same man with glasses',
        visualStyleSummary: 'restrained orange monochrome palette',
        entityTags: ['person'],
        styleTags: ['orange', 'monochrome'],
        createdAt: 3,
    },
} satisfies CanvasNode

const videoGeneratedNode = {
    nodeId: 'video-generated',
    type: 'video',
    fileId: 'video-mp4-file',
    posterFileId: 'video-poster-file',
    frameFileId: 'video-frame-file',
    workspaceId: 'workspace-1',
    src: '/api/videos/workspace-1/video-mp4-file',
    posterSrc: '/api/images/workspace-1/video-poster-file',
    aspectRatio: 1.7777,
    durationSeconds: 6,
    hasAudio: true,
    position: { x: 600, y: 0 },
    dimensions: { width: 160, height: 90 },
    generatedBy: {
        aiChatThreadId: 'thread-1',
        responseId: 'response-video',
        videoModel: 'Google:veo-3.0-generate-001' as any,
        revisedPrompt: 'a calm seaside village at dawn',
        branchId: 'branch-video',
        promptText: 'a calm seaside village at dawn',
        visualEntitySummary: 'seaside village with boats at dawn',
        entityTags: ['village', 'boats'],
        styleTags: ['warm', 'cinematic'],
        createdAt: 4,
    },
} satisfies CanvasNode

// Uploaded video: no generation metadata, only a VLM-produced descriptor and a
// frame-0 poster (no representative mid-frame extracted yet).
const uploadedVideoNode = {
    nodeId: 'video-uploaded',
    type: 'video',
    fileId: 'uploaded-mp4-file',
    posterFileId: 'uploaded-poster-file',
    workspaceId: 'workspace-1',
    src: '/api/videos/workspace-1/uploaded-mp4-file',
    posterSrc: '/api/images/workspace-1/uploaded-poster-file',
    aspectRatio: 1,
    durationSeconds: 8,
    hasAudio: false,
    parentId: 'region-1',
    position: { x: 760, y: 0 },
    dimensions: { width: 120, height: 120 },
    descriptor: {
        status: 'ready',
        summary: 'a red sports car drifting on a wet city street at night',
        entityTags: ['car', 'city'],
        styleTags: ['neon', 'night'],
        source: 'analysis',
        version: 'media-descriptor-v1',
        updatedAt: 10,
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

    it('adds an active-target hint without moving that candidate ahead of other candidates', () => {
        const snapshot = buildImageBranchCandidateSnapshot({
            regionNodeId: 'region-1',
            threadId: 'thread-1',
            activeTargetNodeId: 'goat-generated',
            nodes: [regionNode, portraitSourceNode, landscapeSourceNode, personGeneratedNode, goatGeneratedNode],
            edges: [
                { edgeId: 'edge-region-person', sourceNodeId: 'region-1', targetNodeId: 'person-generated' },
                { edgeId: 'edge-region-goat', sourceNodeId: 'region-1', targetNodeId: 'goat-generated' },
            ],
            prompt: 'make that guy orange monochrome',
        })

        const candidateIds = snapshot.candidates.map((candidate) => candidate.nodeId)
        const goatCandidate = snapshot.candidates.find((candidate) => candidate.nodeId === 'goat-generated')

        expect(snapshot.activeTargetNodeId).toBe('goat-generated')
        expect(goatCandidate?.roleHints).toContain('active-target')
        expect(candidateIds.indexOf('person-generated')).toBeLessThan(candidateIds.indexOf('goat-generated'))
        expect(snapshot.transcriptContext).toContain('Active target nodeId: goat-generated')
        expect(snapshot.transcriptContext).toContain('nodeId=goat-generated | kind=image | roles=generated-variant,branch-leaf,active-target')
    })

    it('marks generated ancestors and leaves so the API can preserve branch lineage', () => {
        const snapshot = buildImageBranchCandidateSnapshot({
            regionNodeId: 'region-1',
            threadId: 'thread-1',
            nodes: [regionNode, portraitSourceNode, landscapeSourceNode, personGeneratedNode, refinedPersonGeneratedNode],
            edges: [
                { edgeId: 'edge-person-refined', sourceNodeId: 'person-generated', targetNodeId: 'person-refined' },
            ],
            prompt: 'make that guy more monochromatic',
        })

        const firstBranchImage = snapshot.candidates.find((candidate) => candidate.nodeId === 'person-generated')
        const branchLeaf = snapshot.candidates.find((candidate) => candidate.nodeId === 'person-refined')

        expect(firstBranchImage?.roleHints).toContain('branch-ancestor')
        expect(branchLeaf?.roleHints).toContain('branch-leaf')
        expect(branchLeaf).toMatchObject({
            branchId: 'branch-person',
            parentImageNodeId: 'person-generated',
            ancestorNodeIds: ['person-generated', 'person-refined'],
            sourceContextNodeIds: ['portrait-source', 'landscape-source'],
        })
    })

    it('folds thread response text into generated branch prompt text', () => {
        const threadContent = {
            type: 'doc',
            content: [
                {
                    type: 'aiUserMessage',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'make him painterly' }] }],
                },
                {
                    type: 'aiResponseMessage',
                    attrs: { id: 'response-refined-message' },
                    content: [
                        { type: 'paragraph', content: [{ type: 'text', text: 'Created a refined painted portrait.' }] },
                        { type: 'aiGeneratedImage', attrs: { revisedPrompt: 'thread image prompt text' } },
                    ],
                },
            ],
        }
        const generatedImageTextByNodeId = getGeneratedImageTextByNodeIdFromThreadContent(
            threadContent,
            [personGeneratedNode, refinedPersonGeneratedNode],
            'thread-1'
        )
        const snapshot = buildImageBranchCandidateSnapshot({
            regionNodeId: 'region-1',
            threadId: 'thread-1',
            nodes: [regionNode, portraitSourceNode, landscapeSourceNode, personGeneratedNode, refinedPersonGeneratedNode],
            edges: [
                { edgeId: 'edge-person-refined', sourceNodeId: 'person-generated', targetNodeId: 'person-refined' },
            ],
            prompt: 'make that guy more painterly',
            generatedImageTextByNodeId,
        })
        const branchLeaf = snapshot.candidates.find((candidate) => candidate.nodeId === 'person-refined')

        expect(generatedImageTextByNodeId['person-refined']).toContain('make him painterly')
        expect(generatedImageTextByNodeId['person-refined']).toContain('Created a refined painted portrait.')
        expect(generatedImageTextByNodeId['person-refined']).toContain('thread image prompt text')
        expect(branchLeaf?.promptText).toContain('make the same man orange monochrome')
        expect(branchLeaf?.promptText).toContain('thread image prompt text')
        expect(branchLeaf?.visualEntitySummary).toBe('orange monochrome portrait of the same man with glasses')
    })
})

// =============================================================================
// VIDEO MEDIA CANDIDATES
// =============================================================================

describe('buildImageBranchCandidateSnapshot — video media', () => {
    it('grounds a generated video by its representative frame, never the MP4', () => {
        const snapshot = buildSnapshot('extend that seaside clip', [videoGeneratedNode])
        const videoCandidate = snapshot.candidates.find((candidate) => candidate.nodeId === 'video-generated')

        expect(videoCandidate?.mediaKind).toBe('video')
        expect(videoCandidate?.imageUrl).toBe('nats-obj://workspace-workspace-1-files/video-frame-file')
        expect(videoCandidate?.fileId).toBe('video-frame-file')
        expect(snapshot.candidates.map((candidate) => candidate.imageUrl)).not.toContain('nats-obj://workspace-workspace-1-files/video-mp4-file')
    })

    it('keeps a generated video on its branch so an edit continues lineage', () => {
        const snapshot = buildSnapshot('make the dawn light warmer', [videoGeneratedNode])
        const videoCandidate = snapshot.candidates.find((candidate) => candidate.nodeId === 'video-generated')

        expect(videoCandidate?.branchId).toBe('branch-video')
        expect(videoCandidate?.roleHints).toContain('generated-variant')
        expect(snapshot.transcriptContext).toContain('kind=video')
    })

    it('falls back to the poster frame and uses the descriptor for uploaded video', () => {
        const snapshot = buildImageBranchCandidateSnapshot({
            regionNodeId: 'region-1',
            threadId: 'thread-1',
            nodes: [regionNode, uploadedVideoNode],
            edges: [],
            prompt: 'make the car blue',
        })
        const uploaded = snapshot.candidates.find((candidate) => candidate.nodeId === 'video-uploaded')

        expect(uploaded?.mediaKind).toBe('video')
        expect(uploaded?.imageUrl).toBe('nats-obj://workspace-workspace-1-files/uploaded-poster-file')
        expect(uploaded?.entityTags).toEqual(['car', 'city'])
        expect(uploaded?.styleTags).toEqual(['neon', 'night'])
        expect(uploaded?.promptText).toContain('a red sports car drifting on a wet city street at night')
    })
})