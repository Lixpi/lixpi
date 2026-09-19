import { createNatsSubscriptions } from '../create-nats-subscriptions.ts'
import { getNatsSubjectPath } from '@lixpi/constants'
import { info } from '@lixpi/debug-tools'

import AiModel from '../../models/ai-model.ts'

export const aiModelSubjects = createNatsSubscriptions(
    'ai-model',
    {
        [getNatsSubjectPath(subjects => subjects.AI_MODELS_SUBJECTS.GET_AVAILABLE_MODELS)]: async (data, msg) => await AiModel.getAvailableAiModels(),
        [getNatsSubjectPath(subjects => subjects.AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED)]: async (data, msg) => void info(
            `AI models sync completed -> new=${data?.totalNew ?? 0} updated=${data?.totalUpdated ?? 0} deleted=${data?.totalDeleted ?? 0} ranAt=${data?.ranAt ?? 'n/a'}`,
        ),
    },
)
