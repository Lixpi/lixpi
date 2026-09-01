import { NATS_SUBJECTS } from '@lixpi/constants'
import {
    log,
    info,
    infoStr,
    warn,
    err,
} from '@lixpi/debug-tools'

import AiModel from '../../models/ai-model.ts'

const { AI_MODELS_SUBJECTS } = NATS_SUBJECTS

export const aiModelSubjects = [
    // AI Models ------------------------------------------------------------------------------------------------
    {
        subject: AI_MODELS_SUBJECTS.GET_AVAILABLE_MODELS,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_MODELS_SUBJECTS.GET_AVAILABLE_MODELS] },
            sub: { allow: [] },
        },
        handler: async (data, msg) => {
            return await AiModel.getAvailableAiModels()
        },
    },

    {
        // Published by the ai-models-sync workload on the NEX node after each run
        // (exported from the NEX account, imported into AUTH). The API reads the
        // catalog live from DynamoDB, so this is a refresh/liveness signal the API
        // (and any UI granted the subject) can react to.
        subject: AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED,
        type: 'subscribe',
        payloadType: 'json',
        permissions: {
            sub: { allow: [AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED] },
        },
        handler: async (data, msg) => {
            info(`AI models sync completed -> new=${data?.totalNew ?? 0} updated=${data?.totalUpdated ?? 0} deleted=${data?.totalDeleted ?? 0} ranAt=${data?.ranAt ?? 'n/a'}`)
        },
    },
    // END AI Models ---------------------------------------------------------------------------------------------------
]
