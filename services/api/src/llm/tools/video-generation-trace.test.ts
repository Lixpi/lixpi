'use strict'

import { describe, expect, it } from 'vitest'

import {
    VEO_NEGATIVE_PROMPT,
    buildVideoGenerationTrace,
    buildVideoModelPrompt,
} from './video-generation-trace.ts'
import type { ProviderState } from '../graph/state.ts'

function createState(overrides: Partial<ProviderState> = {}): ProviderState {
    return {
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'input_image', image_url: 'data:image/png;base64,branch-inline', detail: 'high' },
                    { type: 'input_image', image_url: 'data:image/png;base64,feature-inline', detail: 'high' },
                ],
            },
        ],
        aiModelMetaInfo: { provider: 'Anthropic', model: 'Claude', modelVersion: 'claude-sonnet-4-6', maxCompletionSize: 4096 },
        eventMeta: {},
        workspaceId: 'workspace-1',
        aiChatThreadId: 'thread-1',
        instanceKey: 'workspace-1:thread-1',
        provider: 'Anthropic',
        modelVersion: 'claude-sonnet-4-6',
        temperature: 0.7,
        streamActive: false,
        aiRequestReceivedAt: 1,
        enableVideoGeneration: true,
        videoModelMetaInfo: { provider: 'Google', model: 'VEO', modelVersion: 'veo-3.1-generate-preview' },
        videoModelVersion: 'veo-3.1-generate-preview',
        videoProviderName: 'Google',
        videoAspectRatio: '16:9',
        videoResolution: '1080p',
        videoDurationSeconds: 8,
        generatedVideoPrompt: 'Animate the portrait with a slow push-in as watercolor paper texture shimmers softly.',
        videoFirstFrameImage: 'data:image/png;base64,branch-inline',
        capabilityReferenceImages: ['data:image/png;base64,capability-inline'],
        capabilityReferenceImageTraceUrls: ['/api/capabilities/visual-style.1/resources/sample-0'],
        capabilityUsagePrompt: 'Use rough watercolor paper and visible brush texture.',
        mediaBranchCandidateSnapshot: {
            resolverVersion: 'image-branch-vlm-v1',
            conversationAssetId: 'thread-1',
            regionNodeId: 'region-1',
            promptText: 'animate that portrait',
            promptFingerprint: 'prompt-test',
            transcriptContext: 'candidate labels',
            candidates: [
                {
                    candidateId: 'person-generated',
                    nodeId: 'person-generated',
                    assetId: 'person-file',
                    imageUrl: 'data:image/png;base64,branch-inline',
                    roleHints: ['generated-variant', 'branch-leaf'],
                    branchId: 'branch-person',
                    ancestorNodeIds: ['person-generated'],
                    sourceContextNodeIds: ['portrait-source'],
                    visualEntitySummary: 'painted portrait of the man',
                },
                {
                    candidateId: 'goat-generated',
                    nodeId: 'goat-generated',
                    assetId: 'goat-file',
                    imageUrl: 'data:image/png;base64,goat-inline',
                    roleHints: ['generated-variant', 'branch-leaf'],
                    branchId: 'branch-goat',
                    ancestorNodeIds: ['goat-generated'],
                    sourceContextNodeIds: ['landscape-source'],
                    visualEntitySummary: 'painted goat',
                },
            ],
        },
        mediaBranchResolution: {
            resolverKind: 'structured-vlm',
            resolverVersion: 'image-branch-vlm-v1',
            resolverModelProvider: 'Anthropic',
            resolverModelId: 'claude-sonnet-4-6',
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: 'person-generated',
            parentCandidateId: 'person-generated',
            branchId: 'branch-person',
            includeGeneratedCandidateIds: ['person-generated'],
            referenceCandidateIds: ['person-generated'],
            sourceContextNodeIds: ['portrait-source'],
            styleReferenceCandidateIds: [],
            excludedCandidateIds: ['goat-generated'],
            visualEntitySummary: 'same portrait animated',
            visualStyleSummary: 'watercolor portrait',
            entityTags: ['person'],
            styleTags: ['watercolor'],
            confidence: 0.94,
            rationale: 'Animate the portrait branch and exclude the goat branch.',
            decisions: [
                { candidateId: 'person-generated', role: 'target', reason: 'selected generated portrait branch' },
                { candidateId: 'goat-generated', role: 'excluded', reason: 'different subject and branch' },
            ],
        },
        ...overrides,
    }
}

describe('buildVideoModelPrompt', () => {
    it('adds VEO quality, image-to-video, visual-capability transfer, and negative-prompt guidance', () => {
        const prompt = buildVideoModelPrompt(createState())

        expect(prompt).toContain('VEO QUALITY DIRECTION')
        expect(prompt).toContain('IMAGE-TO-VIDEO DIRECTION')
        expect(prompt).toContain('MANDATORY VISUAL CAPABILITY TRANSFER FOR VIDEO')
        expect(prompt).toContain('VISUAL CAPABILITY BRIEF:')
        expect(prompt).toContain('Use rough watercolor paper and visible brush texture.')
        expect(prompt).toContain('USER VIDEO REQUEST:')
        expect(prompt).toContain('Animate the portrait with a slow push-in')
        expect(prompt).toContain(`Negative prompt: ${VEO_NEGATIVE_PROMPT}`)
    })

    it('adds text-to-video guardrails even without visual-capability references', () => {
        const prompt = buildVideoModelPrompt(createState({
            videoFirstFrameImage: undefined,
            capabilityReferenceImages: [],
            capabilityUsagePrompt: undefined,
        }))

        expect(prompt).toContain('TEXT-TO-VIDEO DIRECTION')
        expect(prompt).toContain('Negative prompt:')
        expect(prompt).not.toContain('MANDATORY VISUAL CAPABILITY TRANSFER FOR VIDEO')
    })

    // Locks in VEO's reference-mode wording after it moved into the profile, so
    // the generalization stays byte-identical for VEO in every input mode.
    it('keeps the literal "VEO reference images" wording in VEO reference mode (byte-identical)', () => {
        const prompt = buildVideoModelPrompt(createState({
            videoFirstFrameImage: undefined,
            videoReferenceImages: ['data:image/png;base64,ref-a', 'data:image/png;base64,ref-b'],
            capabilityReferenceImages: [],
            capabilityUsagePrompt: undefined,
        }))

        expect(prompt).toContain('VEO QUALITY DIRECTION')
        expect(prompt).toContain('REFERENCE-IMAGE DIRECTION: use the attached VEO reference images')
        expect(prompt).toContain(`Negative prompt: ${VEO_NEGATIVE_PROMPT}`)
    })
})

describe('buildVideoModelPrompt — Seedance profile', () => {
    // The /seedance/i model version selects the Seedance profile; provider name
    // is irrelevant to prompt shaping (the providers gate on the same signal).
    const seedanceOverrides = {
        videoModelMetaInfo: { provider: 'Google', model: 'Seedance', modelVersion: 'dreamina-seedance-2-0-260128' },
        videoModelVersion: 'dreamina-seedance-2-0-260128',
    } as const

    it('uses the Seedance quality direction and omits the negative-prompt line (positive phrasing only)', () => {
        const prompt = buildVideoModelPrompt(createState(seedanceOverrides))

        expect(prompt).toContain('SEEDANCE QUALITY DIRECTION')
        expect(prompt).not.toContain('VEO QUALITY DIRECTION')
        // Seedance backfires on negative phrasing — the wrapper must not append it.
        expect(prompt).not.toContain('Negative prompt:')
        expect(prompt).not.toContain(VEO_NEGATIVE_PROMPT)
        // Shared core is preserved across providers.
        expect(prompt).toContain('IMAGE-TO-VIDEO DIRECTION')
        expect(prompt).toContain('MANDATORY VISUAL CAPABILITY TRANSFER FOR VIDEO')
        expect(prompt).toContain('USER VIDEO REQUEST:')
        expect(prompt).toContain('Animate the portrait with a slow push-in')
    })

    it('drops the literal "VEO" from the reference-image direction for Seedance', () => {
        const prompt = buildVideoModelPrompt(createState({
            ...seedanceOverrides,
            videoFirstFrameImage: undefined,
            videoReferenceImages: ['data:image/png;base64,ref-a', 'data:image/png;base64,ref-b'],
            capabilityReferenceImages: [],
            capabilityUsagePrompt: undefined,
        }))

        expect(prompt).toContain('REFERENCE-IMAGE DIRECTION')
        expect(prompt).not.toContain('VEO reference images')
        expect(prompt).not.toContain('Negative prompt:')
    })
})

describe('buildVideoGenerationTrace', () => {
    it('records the routed prompt, branch references, capability references, resolver audit, and exclusions without inline image bytes', () => {
        const trace = buildVideoGenerationTrace(createState())

        expect(trace).toBeDefined()
        expect(trace).toMatchObject({
            traceVersion: 'video-generation-trace-v1',
            chatModelProvider: 'Anthropic',
            videoModelProvider: 'Google',
            videoModelId: 'veo-3.1-generate-preview',
            aspectRatio: '16:9',
            resolution: '1080p',
            durationSeconds: 8,
            promptWasChanged: true,
        })
        expect(trace?.finalPrompt).toContain('VEO QUALITY DIRECTION')
        expect(trace?.finalPrompt).toContain('Negative prompt:')
        expect(trace?.referenceImages).toHaveLength(2)
        expect(trace?.referenceImages[0]).toMatchObject({
            id: 'branch:person-generated',
            source: 'branch-candidate',
            imageUrl: '/api/assets/person-file/renditions/preview',
            label: 'painted portrait of the man',
            role: 'target',
            nodeId: 'person-generated',
            branchId: 'branch-person',
            reason: 'selected generated portrait branch',
        })
        expect(trace?.referenceImages[1]).toMatchObject({
            id: 'capability:1',
            source: 'capability-reference',
            imageUrl: '/api/capabilities/visual-style.1/resources/sample-0',
            role: 'capability-reference',
        })
        expect(trace?.referenceImages.every((reference: { imageUrl: string }) => !reference.imageUrl.startsWith('data:'))).toBe(true)
        expect(trace?.excludedReferences).toEqual([
            expect.objectContaining({
                nodeId: 'goat-generated',
                label: 'painted goat',
                reason: 'different subject and branch',
                branchId: 'branch-goat',
            }),
        ])
        expect(trace?.resolver).toMatchObject({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: 'person-generated',
            parentCandidateId: 'person-generated',
            branchId: 'branch-person',
        })
    })

    it('does not create a trace before video provider, video model, and tool prompt are known', () => {
        expect(buildVideoGenerationTrace(createState({ generatedVideoPrompt: undefined }))).toBeUndefined()
        expect(buildVideoGenerationTrace(createState({ videoProviderName: undefined }))).toBeUndefined()
        expect(buildVideoGenerationTrace(createState({ videoModelVersion: undefined }))).toBeUndefined()
    })
})
