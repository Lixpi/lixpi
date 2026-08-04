'use strict'

import type { CapabilityMediaReviewTrace } from '@lixpi/constants'

export const CHARACTER_SHEET_TRACE_SCHEMA_VERSION = 'character-sheet-trace-v2' as const

export type CharacterPanelTrace = {
    panelId: string
    title: string
    attempts: 0 | 1
    selectedAttempt: 0 | 1
    score: number
    status: 'completed' | 'needs-review' | 'unavailable'
    failedDimensions: string[]
    warning?: string
    vlmAssessor: string
    providerOperationIds: string[]
    includedReferenceRoles: string[]
    omittedReferenceRoles: string[]
}

export type CharacterSheetTrace = CapabilityMediaReviewTrace & {
    schemaVersion: typeof CHARACTER_SHEET_TRACE_SCHEMA_VERSION
    capabilityRunId: string
    provider: string
    modelVersion: string
    compositor: 'sharp-character-sheet-3840x2560-v2'
    panels: CharacterPanelTrace[]
    inferredFeatures: string[]
    totalProviderOperations: number
    compositionSha256: string
}
