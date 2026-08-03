'use strict'

import { describe, expect, it, beforeEach } from 'vitest'

import {
    getPromptTextFromMessages,
    buildMediaBranchCandidateSnapshot,
    buildCanvasWideCandidateSnapshot,
    buildWorkspaceContextSnapshot,
    getGeneratedImageTextByNodeIdFromThreadContent,
} from '$src/services/ai-image-branching.ts'
import { assetsStore } from '$src/stores/assetsStore.ts'
import type { Asset, CanvasNode, WorkspaceEdge } from '@lixpi/constants'

const rootNode = {
    nodeId: 'thread-node-1',
    type: 'document',
    assetId: 'thread-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
} satisfies CanvasNode

const portraitSourceNode = {
    nodeId: 'portrait-source',
    type: 'image',
    assetId: 'portrait-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/portrait-file',
    aspectRatio: 1,
    parentId: 'thread-node-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
} satisfies CanvasNode

const landscapeSourceNode = {
    nodeId: 'landscape-source',
    type: 'image',
    assetId: 'landscape-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/landscape-file',
    aspectRatio: 1,
    parentId: 'thread-node-1',
    position: { x: 120, y: 0 },
    dimensions: { width: 100, height: 100 },
} satisfies CanvasNode

const personGeneratedNode = {
    nodeId: 'person-generated',
    type: 'image',
    assetId: 'person-generated-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/person-generated-file',
    aspectRatio: 1,
    position: { x: 240, y: 0 },
    dimensions: { width: 100, height: 100 },
    generatedBy: {
        conversationAssetId: 'thread-1',
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
    assetId: 'goat-generated-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/goat-generated-file',
    aspectRatio: 1,
    position: { x: 360, y: 0 },
    dimensions: { width: 100, height: 100 },
    generatedBy: {
        conversationAssetId: 'thread-1',
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
    assetId: 'person-refined-file',
    workspaceId: 'workspace-1',
    src: '/api/images/workspace-1/person-refined-file',
    aspectRatio: 1,
    position: { x: 480, y: 0 },
    dimensions: { width: 100, height: 100 },
    generatedBy: {
        conversationAssetId: 'thread-1',
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
    assetId: 'video-mp4-file',
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
        conversationAssetId: 'thread-1',
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
    assetId: 'uploaded-mp4-file',
    posterFileId: 'uploaded-poster-file',
    workspaceId: 'workspace-1',
    src: '/api/videos/workspace-1/uploaded-mp4-file',
    posterSrc: '/api/images/workspace-1/uploaded-poster-file',
    aspectRatio: 1,
    durationSeconds: 8,
    hasAudio: false,
    parentId: 'thread-node-1',
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

const cubistDocNode = {
    nodeId: 'cubist-doc',
    type: 'document',
    assetId: 'doc-cubist',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
    descriptor: {
        status: 'ready',
        summary: 'a cubist study of a dog',
        entityTags: ['dog'],
        styleTags: ['cubist'],
        source: 'analysis',
        version: 'media-descriptor-v1',
        updatedAt: 5,
    },
} satisfies CanvasNode

const threadContextNode = {
    nodeId: 'thread-context',
    type: 'document',
    assetId: 'thread-context-ref',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
    descriptor: {
        status: 'ready',
        summary: 'chat about seaside villages',
        entityTags: ['village'],
        styleTags: [],
        source: 'analysis',
        version: 'media-descriptor-v1',
        updatedAt: 6,
    },
} satisfies CanvasNode

// Descriptor summaries/tags come from the assetsStore (populated from the
// Asset record), not from the canvas node itself — the node only carries the
// assetId. Seed the store with the uploaded video's descriptor before tests
// that assert on it.
beforeEach(() => {
    assetsStore.reset()
    for (const node of [uploadedVideoNode, cubistDocNode, threadContextNode]) {
        assetsStore.upsert({
            assetId: node.assetId,
            descriptor: node.descriptor,
            revision: 1,
        } as Asset)
    }
})

describe('buildMediaBranchCandidateSnapshot', () => {
    it('includes only media explicitly attached to the submitted request', () => {
        const snapshot = buildMediaBranchCandidateSnapshot({
            regionNodeId: 'thread-node-1',
            conversationAssetId: 'thread-1',
            nodes: [rootNode, portraitSourceNode, landscapeSourceNode, personGeneratedNode, goatGeneratedNode],
            edges: [
                { edgeId: 'edge-root-person', sourceNodeId: 'thread-node-1', targetNodeId: 'person-generated' },
                { edgeId: 'edge-root-goat', sourceNodeId: 'thread-node-1', targetNodeId: 'goat-generated' },
            ],
            contextMediaNodeIds: ['landscape-source', 'goat-generated'],
            prompt: 'make the goat wear sunglasses',
        })

        expect(snapshot.candidates.map((candidate) => candidate.nodeId)).toEqual([
            'landscape-source',
            'goat-generated',
        ])
        expect(snapshot.explicitReferenceCandidateIds).toEqual([
            'node:landscape-source',
            'node:goat-generated',
        ])
        expect(snapshot.candidates.some((candidate) => candidate.nodeId === 'person-generated')).toBe(false)
        expect(snapshot.candidates.some((candidate) => candidate.nodeId === 'portrait-source')).toBe(false)
    })

    it('preserves authorized generated-media lineage and visual descriptor fields', () => {
        const snapshot = buildMediaBranchCandidateSnapshot({
            regionNodeId: 'thread-node-1',
            conversationAssetId: 'thread-1',
            nodes: [personGeneratedNode, goatGeneratedNode],
            edges: [],
            contextMediaNodeIds: ['person-generated', 'goat-generated'],
            prompt: 'make the goat wear sunglasses',
        })

        const personCandidate = snapshot.candidates.find((candidate) => candidate.nodeId === 'person-generated')
        const goatCandidate = snapshot.candidates.find((candidate) => candidate.nodeId === 'goat-generated')

        expect(personCandidate).toMatchObject({
            branchId: 'branch-person',
            visualEntitySummary: 'front-facing male portrait with glasses',
            entityTags: ['person'],
            roleHints: ['base-context', 'generated-variant'],
        })
        expect(goatCandidate).toMatchObject({
            branchId: 'branch-goat',
            visualEntitySummary: 'brown goat in colorful painterly landscape',
            entityTags: ['goat'],
            roleHints: ['base-context', 'generated-variant'],
        })
    })

    it('grounds attached images by canonical Asset rendition path', () => {
        const snapshot = buildMediaBranchCandidateSnapshot({
            regionNodeId: 'thread-node-1',
            conversationAssetId: 'thread-1',
            nodes: [portraitSourceNode, personGeneratedNode],
            edges: [],
            contextMediaNodeIds: ['portrait-source', 'person-generated'],
            prompt: 'make the portrait cubist',
        })

        expect(snapshot.candidates.map((candidate) => candidate.imageUrl)).toEqual([
            '/api/assets/portrait-file/renditions/preview',
            '/api/assets/person-generated-file/renditions/preview',
        ])
    })

    it('adds an active-target hint without changing attachment order', () => {
        const snapshot = buildMediaBranchCandidateSnapshot({
            regionNodeId: 'thread-node-1',
            conversationAssetId: 'thread-1',
            activeTargetNodeId: 'goat-generated',
            nodes: [personGeneratedNode, goatGeneratedNode],
            edges: [],
            contextMediaNodeIds: ['person-generated', 'goat-generated'],
            prompt: 'make the goat orange monochrome',
        })

        const candidateIds = snapshot.candidates.map((candidate) => candidate.nodeId)
        const goatCandidate = snapshot.candidates.find((candidate) => candidate.nodeId === 'goat-generated')

        expect(snapshot.activeTargetCandidateId).toBe('node:goat-generated')
        expect(goatCandidate?.roleHints).toContain('active-target')
        expect(candidateIds.indexOf('person-generated')).toBeLessThan(candidateIds.indexOf('goat-generated'))
        expect(snapshot.transcriptContext).toContain('Active target candidateId: node:goat-generated')
        expect(snapshot.transcriptContext).toContain('candidateId=node:goat-generated | nodeId=goat-generated | assetId=')
    })

    it('carries a selected generated Asset parent identity without attaching its parent implicitly', () => {
        const snapshot = buildMediaBranchCandidateSnapshot({
            regionNodeId: 'thread-node-1',
            conversationAssetId: 'thread-1',
            nodes: [portraitSourceNode, personGeneratedNode, refinedPersonGeneratedNode],
            edges: [],
            contextMediaNodeIds: ['person-refined'],
            prompt: 'make that guy more monochromatic',
        })

        const branchLeaf = snapshot.candidates.find((candidate) => candidate.nodeId === 'person-refined')

        expect(branchLeaf).toMatchObject({
            branchId: 'branch-person',
            parentImageNodeId: 'person-generated',
            ancestorNodeIds: ['person-generated', 'person-refined'],
            sourceContextNodeIds: ['person-refined'],
        })
        expect(snapshot.candidates.map((candidate) => candidate.nodeId)).toEqual(['person-refined'])
    })

    it('deduplicates attachment IDs and ignores document IDs', () => {
        const snapshot = buildMediaBranchCandidateSnapshot({
            regionNodeId: 'thread-node-1',
            conversationAssetId: 'thread-1',
            nodes: [rootNode, portraitSourceNode],
            edges: [],
            contextMediaNodeIds: ['portrait-source', 'portrait-source', 'thread-node-1'],
            prompt: 'use this portrait',
        })

        expect(snapshot.candidates.map((candidate) => candidate.nodeId)).toEqual(['portrait-source'])
        expect(snapshot.explicitReferenceCandidateIds).toEqual([
            'node:portrait-source',
        ])
    })
})

describe('getPromptTextFromMessages', () => {
    it('returns latest plain-string user content', () => {
        expect(
            getPromptTextFromMessages([
                { role: 'assistant', content: 'ignore this' },
                { role: 'user', content: 'first message' },
                { role: 'user', content: 'latest plain prompt' },
            ]),
        ).toBe('latest plain prompt')
    })

    it('ignores malformed content blocks and still collects latest user prompt', () => {
        expect(
            getPromptTextFromMessages([
                { role: 'user', content: [{ type: 'image', text: 'ignore' }, null, { type: 'input_text', text: 'valid prompt' }] },
                { role: 'user', content: [{ type: 'text', text: 'later prompt' }, 'literal'],
                },
            ]),
        ).toBe('later prompt\nliteral')
    })

    it('returns the latest user prompt from mixed message content formats', () => {
        expect(
            getPromptTextFromMessages([
                { role: 'assistant', content: [{ type: 'text', text: 'ignore this' }] },
                { role: 'user', content: [{ type: 'text', text: 'older prompt' }] },
                { role: 'user', content: [{ type: 'input_text', text: 'newest prompt' }, { type: 'text', text: 'with details' }] },
            ]),
        ).toBe('newest prompt\nwith details')
    })

    it('returns an empty string when no user message content is available', () => {
        expect(getPromptTextFromMessages([{ role: 'assistant', content: 'hello' }])).toBe('')
    })
})

describe('getGeneratedImageTextByNodeIdFromThreadContent', () => {
    it('returns response text only for nodes generated in the target thread', () => {
        const otherThreadGeneratedNode = {
            ...goatGeneratedNode,
            nodeId: 'other-thread-goat',
            generatedBy: {
                ...goatGeneratedNode.generatedBy,
                conversationAssetId: 'thread-other',
                responseMessageId: 'other-response-id',
            },
        } satisfies CanvasNode
        const personGeneratedNodeWithResponseMessage = {
            ...personGeneratedNode,
            nodeId: 'person-generated-with-response-message',
            generatedBy: {
                ...personGeneratedNode.generatedBy,
                responseMessageId: 'response-person',
            },
        } satisfies CanvasNode
        const goatGeneratedNodeWithResponseMessage = {
            ...goatGeneratedNode,
            nodeId: 'goat-generated-with-response-message',
            generatedBy: {
                ...goatGeneratedNode.generatedBy,
                responseMessageId: 'response-goat',
            },
        } satisfies CanvasNode

        const threadContent = {
            type: 'doc',
            content: [
                {
                    type: 'aiUserMessage',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a painterly village' }] },
                    ],
                },
                {
                    type: 'aiResponseMessage',
                    attrs: { id: 'response-person' },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'person response text' }] }],
                },
                {
                    type: 'aiUserMessage',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'goat setup prompt' }] }],
                },
                {
                    type: 'aiResponseMessage',
                    attrs: { id: 'response-goat' },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'goat response text' }] }],
                },
            ],
        }

        const generatedImageTextByNodeId = getGeneratedImageTextByNodeIdFromThreadContent(
            threadContent,
            [personGeneratedNodeWithResponseMessage, goatGeneratedNodeWithResponseMessage, otherThreadGeneratedNode, portraitSourceNode],
            'thread-1',
        )

        expect(generatedImageTextByNodeId['person-generated-with-response-message']).toBe('a painterly village\nperson response text')
        expect(generatedImageTextByNodeId['goat-generated-with-response-message']).toBe('goat setup prompt\ngoat response text')
        expect(generatedImageTextByNodeId['other-thread-goat']).toBeUndefined()
    })
})

describe('buildCanvasWideCandidateSnapshot', () => {
    it('returns no candidates when the request has no explicit media references', () => {
        const snapshot = buildCanvasWideCandidateSnapshot({
            generationRunId: 'run-wide-1',
            nodes: [
                rootNode,
                threadContextNode,
                cubistDocNode,
                portraitSourceNode,
                personGeneratedNode,
                videoGeneratedNode,
            ],
            prompt: 'compose globally',
        })

        expect(snapshot.resolverVersion).toBe('image-branch-vlm-v1')
        expect(snapshot.conversationAssetId).toBe('run-wide-1')
        expect(snapshot.regionNodeId).toBe('standalone:run-wide-1')
        expect(snapshot.candidates).toEqual([])
        expect(snapshot.explicitReferenceCandidateIds).toBeUndefined()
    })

    it('marks the only referenced node as active target', () => {
        const snapshot = buildCanvasWideCandidateSnapshot({
            generationRunId: 'run-wide-2',
            nodes: [portraitSourceNode, personGeneratedNode],
            prompt: 'compose globally',
            referenceNodeIds: ['person-generated'],
        })

        expect(snapshot.activeTargetCandidateId).toBe('node:person-generated')
        expect(snapshot.candidates.find((candidate) => candidate.nodeId === 'person-generated')?.roleHints).toContain(
            'active-target',
        )
    })

    it('does not force active target when multiple references are supplied', () => {
        const snapshot = buildCanvasWideCandidateSnapshot({
            generationRunId: 'run-wide-3',
            nodes: [portraitSourceNode, landscapeSourceNode],
            prompt: 'compose globally',
            referenceNodeIds: ['portrait-source', 'landscape-source'],
        })

        expect(snapshot.activeTargetCandidateId).toBeUndefined()
        expect(snapshot.candidates.some((candidate) => candidate.roleHints.includes('active-target'))).toBe(false)
    })

    it('keeps the candidate list request-bounded and carries explicit refs for API authorization', () => {
        const snapshot = buildCanvasWideCandidateSnapshot({
            generationRunId: 'run-wide-4',
            nodes: [portraitSourceNode, landscapeSourceNode, personGeneratedNode],
            prompt: 'compose globally',
            referenceNodeIds: ['portrait-source'],
        })

        expect(snapshot.candidates.map((candidate) => candidate.nodeId)).toEqual(['portrait-source'])
        expect(snapshot.explicitReferenceCandidateIds).toEqual(['node:portrait-source'])
    })

    it('omits explicitReferenceCandidateIds when no references are supplied', () => {
        const snapshot = buildCanvasWideCandidateSnapshot({
            generationRunId: 'run-wide-5',
            nodes: [portraitSourceNode],
            prompt: 'compose globally',
        })

        expect(snapshot.explicitReferenceCandidateIds).toBeUndefined()
    })
})

// =============================================================================
// VIDEO MEDIA CANDIDATES
// =============================================================================

describe('buildMediaBranchCandidateSnapshot — video media', () => {
    it('grounds a generated video by its representative-frame rendition, never the MP4', () => {
        const snapshot = buildMediaBranchCandidateSnapshot({
            regionNodeId: 'thread-node-1',
            conversationAssetId: 'thread-1',
            nodes: [videoGeneratedNode],
            edges: [],
            contextMediaNodeIds: ['video-generated'],
            prompt: 'extend that seaside clip',
        })
        const videoCandidate = snapshot.candidates.find((candidate) => candidate.nodeId === 'video-generated')

        expect(videoCandidate?.mediaKind).toBe('video')
        expect(videoCandidate?.assetId).toBe('video-mp4-file')
        expect(videoCandidate?.imageUrl).toBe('/api/assets/video-mp4-file/renditions/representativeFrame')
        expect(snapshot.candidates.map((candidate) => candidate.imageUrl)).not.toContain('/api/assets/video-mp4-file/renditions/original')
    })

    it('keeps a generated video on its branch so an edit continues lineage', () => {
        const snapshot = buildMediaBranchCandidateSnapshot({
            regionNodeId: 'thread-node-1',
            conversationAssetId: 'thread-1',
            nodes: [videoGeneratedNode],
            edges: [],
            contextMediaNodeIds: ['video-generated'],
            prompt: 'make the dawn light warmer',
        })
        const videoCandidate = snapshot.candidates.find((candidate) => candidate.nodeId === 'video-generated')

        expect(videoCandidate?.branchId).toBe('branch-video')
        expect(videoCandidate?.roleHints).toContain('generated-variant')
        expect(snapshot.transcriptContext).toContain('kind=video')
    })

    it('falls back to the poster frame and uses the descriptor for uploaded video', () => {
        const snapshot = buildMediaBranchCandidateSnapshot({
            regionNodeId: 'thread-node-1',
            conversationAssetId: 'thread-1',
            nodes: [rootNode, uploadedVideoNode],
            edges: [],
            contextMediaNodeIds: ['video-uploaded'],
            prompt: 'make the car blue',
        })
        const uploaded = snapshot.candidates.find((candidate) => candidate.nodeId === 'video-uploaded')

        expect(uploaded?.mediaKind).toBe('video')
        expect(uploaded?.assetId).toBe('uploaded-mp4-file')
        expect(uploaded?.imageUrl).toBe('/api/assets/uploaded-mp4-file/renditions/representativeFrame')
        expect(uploaded?.entityTags).toEqual(['car', 'city'])
        expect(uploaded?.styleTags).toEqual(['neon', 'night'])
        expect(uploaded?.promptText).toContain('a red sports car drifting on a wet city street at night')
    })
})

// =============================================================================
// WORKSPACE CONTEXT SNAPSHOT (Phase 4)
// =============================================================================

describe('buildWorkspaceContextSnapshot', () => {
    const actionTimelineNode = {
        nodeId: 'timeline-node',
        type: 'capabilityArtifact',
        artifactTypeId: 'action-timeline',
        assetId: 'timeline-asset',
        position: { x: 0, y: 0 },
        dimensions: { width: 520, height: 360 },
    } satisfies CanvasNode
    const workspaceNodes = [
        rootNode,
        personGeneratedNode,
        goatGeneratedNode,
        uploadedVideoNode,
        cubistDocNode,
        threadContextNode,
        actionTimelineNode,
    ]

    it('indexes every explicitly attached context-bearing node without pixel data', () => {
        const snapshot = buildWorkspaceContextSnapshot({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-1',
            prompt: 'summarize my canvas',
            nodes: workspaceNodes,
            edges: [],
            contextChipNodeIds: workspaceNodes.map((node) => node.nodeId),
        })

        expect(snapshot.resolverVersion).toBe('workspace-context-v1')
        expect(snapshot.workspaceId).toBe('workspace-1')
        expect(snapshot.conversationAssetId).toBe('thread-1')
        expect(snapshot.promptText).toBe('summarize my canvas')
        expect(snapshot.nodes.map((node) => node.nodeId).sort()).toEqual(
            ['cubist-doc', 'goat-generated', 'person-generated', 'thread-context', 'thread-node-1', 'timeline-node', 'video-uploaded'],
        )

        // The payload must carry references, never embedded pixels.
        const serialized = JSON.stringify(snapshot)
        expect(serialized).not.toContain('data:image')
        expect(serialized).not.toContain('base64')
    })

    it('carries descriptor summary + tags and a still reference for media, none for docs', () => {
        const snapshot = buildWorkspaceContextSnapshot({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-1',
            prompt: 'x',
            nodes: workspaceNodes,
            edges: [],
            contextChipNodeIds: workspaceNodes.map((node) => node.nodeId),
        })
        const byId = new Map(snapshot.nodes.map((node) => [node.nodeId, node]))

        const video = byId.get('video-uploaded')
        expect(video?.descriptorStatus).toBe('ready')
        expect(video?.descriptorSummary).toBe('a red sports car drifting on a wet city street at night')
        expect(video?.entityTags).toEqual(['car', 'city'])
        expect(video?.styleTags).toEqual(['neon', 'night'])
        // The workspace context snapshot carries Asset identity only — the API
        // resolves the canonical/representative-frame Blob from assetId.
        expect(video?.assetId).toBe('uploaded-mp4-file')

        const generated = byId.get('person-generated')
        expect(generated?.branchId).toBe('branch-person')
        expect(generated?.sourceConversationAssetId).toBe('thread-1')
        expect(generated?.isCurrentConversationGenerated).toBe(true)
        expect(generated?.assetId).toBe('person-generated-file')
        expect(generated?.descriptorSummary).toBeUndefined()

        const doc = byId.get('cubist-doc')
        expect(doc?.nodeId).toBe('cubist-doc')
        expect(doc?.descriptorStatus).toBe('ready')
        expect(doc?.descriptorSummary).toBe('a cubist study of a dog')
        expect(doc?.entityTags).toEqual(['dog'])
        expect(doc?.assetId).toBe('doc-cubist')
        expect(doc?.branchId).toBeUndefined()

        const thread = byId.get('thread-context')
        expect(thread?.nodeId).toBe('thread-context')
    })

    it('marks generated media from other chats without treating it as current-thread output', () => {
        const otherThreadImage = {
            ...personGeneratedNode,
            nodeId: 'other-thread-generated',
            generatedBy: {
                ...personGeneratedNode.generatedBy,
                conversationAssetId: 'thread-other',
            },
        } satisfies CanvasNode
        const snapshot = buildWorkspaceContextSnapshot({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-1',
            prompt: 'now make it warmer',
            nodes: [rootNode, otherThreadImage],
            edges: [],
            contextChipNodeIds: ['other-thread-generated'],
        })
        const generated = snapshot.nodes.find((node) => node.nodeId === 'other-thread-generated')

        expect(generated?.sourceConversationAssetId).toBe('thread-other')
        expect(generated?.isCurrentConversationGenerated).toBeUndefined()
    })

    it('omits ambient edge-connected nodes and marks only explicit chips', () => {
        const snapshot = buildWorkspaceContextSnapshot({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-1',
            prompt: 'put the portrait behind the dog doc',
            nodes: workspaceNodes,
            edges: [
                { edgeId: 'edge-person-root', sourceNodeId: 'person-generated', targetNodeId: 'thread-node-1' },
            ] as WorkspaceEdge[],
            rootNodeId: 'thread-node-1',
            contextChipNodeIds: ['cubist-doc'],
        })
        const byId = new Map(snapshot.nodes.map((node) => [node.nodeId, node]))

        expect(snapshot.nodes.map((node) => node.nodeId)).toEqual(['cubist-doc'])
        expect(byId.get('cubist-doc')?.isExplicitChip).toBe(true)
        expect(byId.get('cubist-doc')?.isEdgeForced).toBe(false)
        expect(byId.has('person-generated')).toBe(false)
        expect(byId.has('video-uploaded')).toBe(false)
    })

    it('carries explicit Capability Artifacts with their registered type identity', () => {
        const snapshot = buildWorkspaceContextSnapshot({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-1',
            prompt: 'continue this timeline',
            nodes: workspaceNodes,
            edges: [],
            contextChipNodeIds: ['timeline-node'],
            titlesByNodeId: { 'timeline-node': 'Train Timeline' },
        })

        expect(snapshot.nodes.find((node) => node.nodeId === 'timeline-node')).toMatchObject({
            type: 'capabilityArtifact',
            artifactTypeId: 'action-timeline',
            assetId: 'timeline-asset',
            title: 'Train Timeline',
            isExplicitChip: true,
        })
    })

    it('forces no edge nodes for a standalone chat with no root node', () => {
        const snapshot = buildWorkspaceContextSnapshot({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-standalone',
            prompt: 'x',
            nodes: workspaceNodes,
            edges: [
                { edgeId: 'edge-person-root', sourceNodeId: 'person-generated', targetNodeId: 'thread-node-1' },
            ] as WorkspaceEdge[],
            contextChipNodeIds: ['person-generated'],
        })

        expect(snapshot.nodes.every((node) => node.isEdgeForced === false)).toBe(true)
        expect(snapshot.nodes.find((node) => node.nodeId === 'person-generated')?.isExplicitChip).toBe(true)
    })

    it('includes caller-supplied doc/thread titles only', () => {
        const snapshot = buildWorkspaceContextSnapshot({
            workspaceId: 'workspace-1',
            conversationAssetId: 'thread-1',
            prompt: 'x',
            nodes: workspaceNodes,
            edges: [],
            contextChipNodeIds: ['cubist-doc', 'thread-context', 'person-generated'],
            titlesByNodeId: { 'cubist-doc': 'Cubist Dog', 'thread-context': 'Seaside chat' },
        })
        const byId = new Map(snapshot.nodes.map((node) => [node.nodeId, node]))

        expect(byId.get('cubist-doc')?.title).toBe('Cubist Dog')
        expect(byId.get('thread-context')?.title).toBe('Seaside chat')
        expect(byId.get('person-generated')?.title).toBeUndefined()
    })
})
