'use strict'

import { NATS_SUBJECTS } from '@lixpi/constants'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import AiModel from '../../models/ai-model.ts'

const { AI_MODELS_SUBJECTS } = NATS_SUBJECTS

export const aiModelSubjects = [
    // AI Models ------------------------------------------------------------------------------------------------
    {
        subject: AI_MODELS_SUBJECTS.GET_AVAILABLE_MODELS,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ AI_MODELS_SUBJECTS.GET_AVAILABLE_MODELS ] },
            sub: { allow: [ AI_MODELS_SUBJECTS.GET_AVAILABLE_MODELS ] }
        },
        handler: async (data, msg) => {
            return await AiModel.getAvailableAiModels();
        }
    },

    // END AI Models ---------------------------------------------------------------------------------------------------
]
