'use strict'

export const CHARACTER_SHEET_TRACE_SCHEMA_VERSION = 'character-sheet-trace-v1' as const

export type CharacterPanelTrace = {
    panelId: string
    attempts: number
    selectedAttempt: number
    score: number
    warning?: string
    vlmAssessor: string
    providerOperationIds: string[]
    includedReferenceRoles: string[]
    omittedReferenceRoles: string[]
}

export type CharacterSheetTrace = {
    schemaVersion: typeof CHARACTER_SHEET_TRACE_SCHEMA_VERSION
    capabilityRunId: string
    provider: string
    modelVersion: string
    compositor: 'sharp-character-sheet-3840x2560-v1'
    panels: CharacterPanelTrace[]
    inferredFeatures: string[]
    totalProviderOperations: number
    compositionSha256: string
}
