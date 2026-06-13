'use strict'

import { describe, expect, it, vi } from 'vitest'
import { STREAM_STATUS, type MediaGenerationRunMeta, type ProviderName } from '@lixpi/constants'

import { BaseProvider, type BaseProviderDeps } from './base-provider.ts'
import { StreamPublisher } from '../graph/stream-publisher.ts'
import type { AiModelMetaInfo, ProviderState } from '../graph/state.ts'

type Published = { subject: string, payload: any }

const makeFakeNats = () => {
    const published: Published[] = []
    const fake = {
        publish: (subject: string, payload: any) => {
            published.push({ subject, payload })
        },
    } as any
    return { fake, published }
}

const makeImageModel = (model: string): AiModelMetaInfo => ({
    provider: 'Google',
    model,
    modelVersion: model,
})

class TestProvider extends BaseProvider {
    readonly providerName: ProviderName = 'Anthropic'

    protected async streamImpl(): Promise<Partial<ProviderState>> {
        return {}
    }

    async runImageGeneration(state: ProviderState): Promise<Partial<ProviderState>> {
        this.streamPublisher = new StreamPublisher(
            this.deps.natsService,
            state.workspaceId,
            state.aiChatThreadId,
            this.providerName,
            state.generationRun,
        )
        return this.executeImageGeneration(state)
    }
}

describe('BaseProvider image fanout errors', () => {
    it('publishes IMAGE_ERROR for the failed media child while returning successful siblings', async () => {
        const nats = makeFakeNats()
        const runImageRouter = vi.fn(async (state: ProviderState): Promise<Partial<ProviderState>> => {
            if (state.generationRun?.mediaIndex === 0) {
                return { error: 'Google image model returned no inline image data.' }
            }
            return { generatedImages: ['final-image-base64'] }
        })
        const deps = {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter,
            runVideoRouter: vi.fn(),
        } as unknown as BaseProviderDeps
        const provider = new TestProvider('ws1:thread1', deps)
        const generationRun: MediaGenerationRunMeta = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 0,
        }
        const state = {
            workspaceId: 'ws1',
            aiChatThreadId: 'thread1',
            instanceKey: 'ws1:thread1',
            provider: 'Anthropic',
            modelVersion: 'claude-sonnet-4-6',
            aiModelMetaInfo: makeImageModel('claude-sonnet-4-6'),
            messages: [{ role: 'user', content: 'Make an image.' }],
            generatedImagePrompt: 'Make an image.',
            imageSize: 'auto',
            generationRun,
            mediaFanoutPlan: {
                generationRequestId: 'request-1',
                imageModels: [
                    makeImageModel('gemini-2.5-flash-image'),
                    makeImageModel('gemini-2.5-flash-image-preview'),
                ],
                videoModels: [],
                imageSize: 'auto',
            },
            eventMeta: {},
        } as ProviderState

        const result = await provider.runImageGeneration(state)

        expect(result).toEqual({ generatedImages: ['final-image-base64'] })
        expect(runImageRouter).toHaveBeenCalledTimes(2)
        const imageErrorEvents = nats.published.filter((item) =>
            item.payload.content.status === STREAM_STATUS.IMAGE_ERROR
        )
        expect(imageErrorEvents).toHaveLength(1)
        expect(imageErrorEvents[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.IMAGE_ERROR,
            aiProvider: 'Anthropic',
            error: 'Google image model returned no inline image data.',
            generationRun: {
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                mediaRunId: 'reasoning-1:image:0',
                mediaModelId: 'Google:gemini-2.5-flash-image',
                mediaType: 'image',
                mediaIndex: 0,
                variantIndex: 0,
            },
        })
    })
})
