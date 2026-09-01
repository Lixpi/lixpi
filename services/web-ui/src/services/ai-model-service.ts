'use strict'

import {
    NATS_SUBJECTS,
    LoadingStatus,
} from '@lixpi/constants'
import type NatsService from '@lixpi/nats-service'

const { AI_MODELS_SUBJECTS } = NATS_SUBJECTS

import AuthService from '$src/services/auth-service.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'

export default class AiModelService {
    private readonly catalogSyncSubscription: { unsubscribe(): void } | null

    constructor(private readonly natsClient?: NatsService) {
        this.catalogSyncSubscription = natsClient
            ? natsClient.subscribe(
                AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED,
                () => {
                    void this.getAvailableAiModels()
                },
            )
            : null
    }

    public async getAvailableAiModels(): Promise<void> {
        aiModelsStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

        try {
            const natsClient = this.natsClient ?? (servicesStore.getData('nats') as NatsService | undefined)
            if (!natsClient) throw new Error('AI model catalog requires an active NATS connection')

            const availableModels: any = await natsClient.request(AI_MODELS_SUBJECTS.GET_AVAILABLE_MODELS, {
                token: await AuthService.getTokenSilently(),
            })

            if (Array.isArray(availableModels)) {
                aiModelsStore.setAiModels(availableModels)
            } else if (Array.isArray(availableModels?.models)) {
                aiModelsStore.setAiModelsCatalog(availableModels)
            } else {
                aiModelsStore.setAiModels([])
            }
            aiModelsStore.setMetaValues({ loadingStatus: LoadingStatus.success })
        } catch (error) {
            console.error('Failed to load AI models data:', error)
            aiModelsStore.setMetaValues({ loadingStatus: LoadingStatus.error })
        }
    }

    public destroy(): void {
        this.catalogSyncSubscription?.unsubscribe()
    }
}
