'use strict'

import { describe, expect, it } from 'vitest'

import {
    buildImageGenerationTrace,
    buildImageModelPrompt,
    normalizeImageSize,
} from './image-generation-trace.ts'
import type { ProviderState } from '../graph/state.ts'

function createState(overrides: Partial<ProviderState> = {}): ProviderState {
    return {
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'input_image', image_url: 'data:image/png;base64,branch-inline', detail: 'high' },
                    { type: 'input_image', image_url: 'data:image/png;base64,feature-inline', detail: 'high' },
                    { type: 'input_image', image_url: '/api/images/workspace-1/message-file', detail: 'high' },
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
        enableImageGeneration: true,
        imageSize: '1024x1024',
        imageModelMetaInfo: { provider: 'Google', model: 'Gemini Image', modelVersion: 'gemini-2.5-flash-image' },
        imageModelVersion: 'gemini-2.5-flash-image',
        imageProviderName: 'Google',
        imagePromptRetryCount: 0,
        generatedImagePrompt: 'Paint the same man in a restrained orange monochrome palette.',
        referenceImages: [
            'data:image/png;base64,branch-inline',
            'data:image/png;base64,capability-inline',
            'data:image/png;base64,message-inline',
        ],
        capabilityReferenceImages: ['data:image/png;base64,capability-inline'],
        capabilityReferenceImageTraceUrls: ['/api/capabilities/visual-style.1/resources/sample-0'],
        capabilityUsagePrompt: 'Use rough watercolor paper and visible brush texture.',
        mediaBranchCandidateSnapshot: {
            resolverVersion: 'image-branch-vlm-v1',
            conversationAssetId: 'thread-1',
            regionNodeId: 'region-1',
            promptText: 'make that guy orange monochromatic',
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
                    visualEntitySummary: 'expressive painted portrait of the man',
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
            operationKind: 'style_transfer',
            targetCandidateId: 'person-generated',
            parentCandidateId: 'person-generated',
            branchId: 'branch-person',
            includeGeneratedCandidateIds: ['person-generated'],
            referenceCandidateIds: ['person-generated'],
            sourceContextNodeIds: ['portrait-source'],
            styleReferenceCandidateIds: [],
            excludedCandidateIds: ['goat-generated'],
            visualEntitySummary: 'same man in orange monochrome',
            visualStyleSummary: 'restrained orange watercolor',
            entityTags: ['person'],
            styleTags: ['orange', 'watercolor'],
            confidence: 0.95,
            rationale: 'Continue the generated portrait branch and exclude the goat branch.',
            decisions: [
                { candidateId: 'person-generated', role: 'target', reason: 'selected generated portrait branch' },
                { candidateId: 'goat-generated', role: 'excluded', reason: 'different subject and branch' },
            ],
        },
        ...overrides,
    }
}

describe('normalizeImageSize', () => {
    it('maps square pixel sizes to ratios for Google-compatible image providers', () => {
        expect(normalizeImageSize('Google', '1024x1024')).toBe('1:1')
        expect(normalizeImageSize('Stability', '1536x1024')).toBe('3:2')
    })

    it('maps ratios back to pixel sizes for OpenAI image providers', () => {
        expect(normalizeImageSize('OpenAI', '1:1')).toBe('1024x1024')
        expect(normalizeImageSize('OpenAI', '2:3')).toBe('1024x1536')
    })
})

describe('buildImageModelPrompt', () => {
    it('wraps the tool prompt when visual-capability references are present', () => {
        const prompt = buildImageModelPrompt(createState())

        expect(prompt).toContain('MANDATORY VISUAL CAPABILITY TRANSFER')
        expect(prompt).toContain('Use rough watercolor paper and visible brush texture.')
        expect(prompt).toContain('Paint the same man in a restrained orange monochrome palette.')
    })

    it('leaves Character Creator panel prompts unchanged for the capability strategy', () => {
        const prompt = buildImageModelPrompt(createState({
            capabilityUsageMode: 'character-creator',
            capabilityReferenceImages: [],
            referenceImages: [],
            generatedImagePrompt: 'Invent a blonde character in green clothing.',
        }))

        expect(prompt).toBe('Invent a blonde character in green clothing.')
    })
})

describe('buildImageGenerationTrace', () => {
    it('records prompt, branch references, capability references, message references, resolver audit, and exclusions without inline image bytes', () => {
        const trace = buildImageGenerationTrace(createState())

        expect(trace).toBeDefined()
        expect(trace).toMatchObject({
            traceVersion: 'image-generation-trace-v1',
            chatModelProvider: 'Anthropic',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash-image',
            imageSize: '1:1',
            promptWasChanged: true,
        })
        expect(trace?.finalPrompt).toContain('MANDATORY VISUAL CAPABILITY TRANSFER')
        expect(trace?.referenceImages).toHaveLength(3)
        expect(trace?.referenceImages[0]).toMatchObject({
            id: 'branch:person-generated',
            source: 'branch-candidate',
            imageUrl: '/api/assets/person-file/renditions/preview',
            label: 'expressive painted portrait of the man',
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
        expect(trace?.referenceImages[2]).toMatchObject({
            id: 'message:3',
            source: 'message-reference',
            imageUrl: '/api/images/workspace-1/message-file',
            role: 'message-reference',
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
            operationKind: 'style_transfer',
            targetCandidateId: 'person-generated',
            parentCandidateId: 'person-generated',
            branchId: 'branch-person',
        })
    })

    it('does not create a trace before image provider, image model, and tool prompt are known', () => {
        expect(buildImageGenerationTrace(createState({ generatedImagePrompt: undefined }))).toBeUndefined()
        expect(buildImageGenerationTrace(createState({ imageProviderName: undefined }))).toBeUndefined()
        expect(buildImageGenerationTrace(createState({ imageModelVersion: undefined }))).toBeUndefined()
    })
})
