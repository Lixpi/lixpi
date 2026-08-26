'use strict'

import { warn } from '@lixpi/debug-tools'
import { OpenAiActualsAdapter } from './openai-actuals-adapter.ts'
import type { ActualsAdapter } from './types.ts'

export const createActualsAdapters = (): ActualsAdapter[] => {
    const accountRef = process.env.OPENAI_RECONCILIATION_ACCOUNT_REF?.trim()
    const adminKey = process.env.OPENAI_ADMIN_API_KEY?.trim()
    if (!accountRef || !adminKey) return []
    const projectIds = (process.env.OPENAI_RECONCILIATION_PROJECT_IDS ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    const apiKeyIds = (process.env.OPENAI_RECONCILIATION_API_KEY_IDS ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    if (projectIds.length === 0) {
        warn('OPENAI_RECONCILIATION_PROJECT_IDS is unset; reconciliation will include every project in the OpenAI organization, not only Lixpi-attributable spend, which can trigger false material-divergence incidents on a shared org.')
    }
    return [new OpenAiActualsAdapter(accountRef, adminKey, projectIds, apiKeyIds)]
}
