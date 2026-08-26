'use strict'

import type {
    DailyPredictedProviderCost,
    ProviderRoute,
    ReconciliationActualCost,
    ReconciliationActualUsage,
} from '@lixpi/constants'

export type StoredPrediction = DailyPredictedProviderCost & {
    recordKey: string
    sortKey: string
    payloadHash: string
    receivedAt: string
}

export type ActualsAdapter = {
    readonly route: ProviderRoute
    readonly providerAccountRef: string
    fetchDay(day: string): Promise<ReconciliationActualCost[]>
}

export type UsageActualsAdapter = ActualsAdapter & {
    fetchUsageDay(day: string): Promise<ReconciliationActualUsage[]>
}

export const supportsUsageActuals = (adapter: ActualsAdapter): adapter is UsageActualsAdapter =>
    'fetchUsageDay' in adapter && typeof adapter.fetchUsageDay === 'function'
