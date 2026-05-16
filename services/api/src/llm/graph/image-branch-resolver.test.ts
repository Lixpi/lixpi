'use strict'

import { describe, expect, it, vi } from 'vitest'

import { resolveImageBranch } from './image-branch-resolver.ts'
import type { ChatMessage, ProviderState } from './state.ts'
import type { VlmCallArgs, VlmCallResult } from '../extraction/vlm-client.ts'

const portraitUrl = 'nats-obj://workspace-workspace-1-files/portrait-file'
const landscapeUrl = 'nats-obj://workspace-workspace-1-files/landscape-file'
const personUrl = 'nats-obj://workspace-workspace-1-files/person-file'
const featureUrl = 'data:image/png;base64,feature-sample'

function getImageUrls(messages: ChatMessage[]): string[] {
    return messages.flatMap((message) => {
        if (!Array.isArray(message.content)) return []
        return message.content
            .filter((block) => block?.type === 'input_image')
            .map((block) => block.image_url)
    })
}

function createState(): ProviderState {
    return {
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'input_text', text: 'Feature visual references for @paint' },
                    { type: 'input_image', image_url: featureUrl, detail: 'high' },
                ],
            },
            {
                role: 'user',
                content: [
                    { type: 'input_text', text: JSON.stringify({ type: 'standalone_image', nodeId: 'portrait-source' }) },
                    { type: 'input_image', image_url: portraitUrl, detail: 'auto' },
                    { type: 'input_text', text: JSON.stringify({ type: 'standalone_image', nodeId: 'landscape-source' }) },
                    { type: 'input_image', image_url: landscapeUrl, detail: 'auto' },
                    { type: 'input_text', text: JSON.stringify({ type: 'generated_image_variant', nodeId: 'person-generated' }) },
                    { type: 'input_image', image_url: personUrl, detail: 'auto' },
                ],
            },
            { role: 'user', content: 'draw a goat in the style of that landscape painting' },
        ],
        aiModelMetaInfo: { provider: 'OpenAI', model: 'gpt-4.1', modelVersion: 'gpt-4.1', maxCompletionSize: 4096 },
        eventMeta: {},
        workspaceId: 'workspace-1',
        aiChatThreadId: 'thread-1',
        instanceKey: 'workspace-1:thread-1',
        provider: 'OpenAI',
        modelVersion: 'gpt-4.1',
        temperature: 0.7,
        streamActive: false,
        aiRequestReceivedAt: 1,
        enableImageGeneration: false,
        imageSize: 'auto',
        imageModelMetaInfo: { provider: 'OpenAI', model: 'gpt-image-1', modelVersion: 'gpt-image-1' },
        imageModelVersion: 'gpt-image-1',
        imageProviderName: 'OpenAI',
        imagePromptRetryCount: 0,
        imageBranchCandidateSnapshot: {
            resolverVersion: 'image-branch-vlm-v1',
            threadId: 'thread-1',
            regionNodeId: 'region-1',
            promptText: 'draw a goat in the style of that landscape painting',
            promptFingerprint: 'prompt-test',
            transcriptContext: 'candidate labels',
            candidates: [
                {
                    nodeId: 'portrait-source',
                    fileId: 'portrait-file',
                    workspaceId: 'workspace-1',
                    imageUrl: portraitUrl,
                    roleHints: ['base-context'],
                    ancestorNodeIds: ['portrait-source'],
                    sourceContextNodeIds: ['portrait-source'],
                },
                {
                    nodeId: 'landscape-source',
                    fileId: 'landscape-file',
                    workspaceId: 'workspace-1',
                    imageUrl: landscapeUrl,
                    roleHints: ['base-context'],
                    ancestorNodeIds: ['landscape-source'],
                    sourceContextNodeIds: ['landscape-source'],
                    visualStyleSummary: 'landscape painting',
                },
                {
                    nodeId: 'person-generated',
                    fileId: 'person-file',
                    workspaceId: 'workspace-1',
                    imageUrl: personUrl,
                    roleHints: ['generated-variant', 'branch-leaf'],
                    branchId: 'branch-person',
                    ancestorNodeIds: ['person-generated'],
                    sourceContextNodeIds: ['portrait-source'],
                    visualEntitySummary: 'male portrait',
                },
            ],
        },
    }
}

function createDeps(parsed: Record<string, unknown>) {
    const publisher = {
        imageBranchResolved: vi.fn(),
        imageBranchResolutionError: vi.fn(),
    }
    const callVlm = vi.fn(async (_args: VlmCallArgs): Promise<VlmCallResult<any>> => ({
        parsed,
        rawText: JSON.stringify(parsed),
        modelName: 'gpt-4.1',
        promptTokens: 10,
        completionTokens: 20,
    }))

    return {
        publisher,
        deps: {
            natsService: {} as any,
            publisher: publisher as any,
            callVlm,
        },
        callVlm,
    }
}

describe('resolveImageBranch', () => {
    it('preserves feature images and removes unselected candidate images from provider messages', async () => {
        const { deps, publisher, callVlm } = createDeps({
            mode: 'context-only',
            operationKind: 'new_image',
            targetImageNodeId: '',
            parentImageNodeId: '',
            branchId: '',
            includeGeneratedNodeIds: [],
            referenceImageNodeIds: ['portrait-source', 'landscape-source'],
            sourceContextNodeIds: ['portrait-source', 'landscape-source'],
            styleReferenceNodeIds: ['landscape-source'],
            excludedNodeIds: ['person-generated'],
            visualEntitySummary: 'new goat',
            visualStyleSummary: 'landscape painting style',
            entityTags: ['goat'],
            styleTags: ['painting'],
            confidence: 0.92,
            rationale: 'The prompt asks for a new goat and uses the landscape as style evidence.',
            decisions: [
                { nodeId: 'landscape-source', role: 'style-reference', reason: 'style source' },
                { nodeId: 'person-generated', role: 'excluded', reason: 'unrelated portrait branch' },
            ],
        })

        const update = await resolveImageBranch(createState(), deps)
        const messages = update.messages ?? []
        const imageUrls = getImageUrls(messages)

        expect(callVlm).toHaveBeenCalledOnce()
        expect(publisher.imageBranchResolved).toHaveBeenCalledOnce()
        expect(update.imageBranchResolution?.resolverKind).toBe('structured-vlm')
        expect(update.imageBranchResolution?.referenceImageNodeIds).toEqual(['portrait-source', 'landscape-source'])
        expect(imageUrls).toContain(featureUrl)
        expect(imageUrls).toContain(portraitUrl)
        expect(imageUrls).toContain(landscapeUrl)
        expect(imageUrls).not.toContain(personUrl)
    })

    it('fails visibly when the VLM returns an ambiguous resolution', async () => {
        const { deps, publisher } = createDeps({
            mode: 'ambiguous',
            operationKind: 'new_image',
            targetImageNodeId: '',
            parentImageNodeId: '',
            branchId: '',
            includeGeneratedNodeIds: [],
            referenceImageNodeIds: [],
            sourceContextNodeIds: [],
            styleReferenceNodeIds: [],
            excludedNodeIds: [],
            visualEntitySummary: '',
            visualStyleSummary: '',
            entityTags: [],
            styleTags: [],
            confidence: 0.1,
            rationale: 'The referent is unclear.',
            decisions: [],
        })

        await expect(resolveImageBranch(createState(), deps)).rejects.toThrow('could not disambiguate')
        expect(publisher.imageBranchResolutionError).toHaveBeenCalledOnce()
        expect(publisher.imageBranchResolved).not.toHaveBeenCalled()
    })
})