export type CharacterSourceMedium = 'photograph' | 'illustration' | 'render' | 'mixed' | 'unknown'
export type CharacterEvidenceVisibility = 'observed' | 'inferred'
export type CharacterTargetAngle = 'front' | 'three-quarter-front' | 'profile' | 'three-quarter-back' | 'back' | 'unspecified'
export type CharacterEditTargetPolicy = 'not-present' | 'preserve-panel' | 'identity-only' | 'discard'
export type CharacterEvidenceRegion = 'face' | 'body' | 'outfit' | 'hands' | 'feet' | 'prop'
export type CharacterEvidenceRequestAuthority = 'assigned' | 'supporting' | 'unassigned'
export type CharacterRegenerationScope = 'full-sheet' | 'selected-panels'

export type CharacterSourceRegion = {
    x: number
    y: number
    width: number
    height: number
}

export type CharacterEvidenceFact = {
    feature: string
    value: string
    region?: CharacterEvidenceRegion
    requestAuthority?: CharacterEvidenceRequestAuthority
    visibility: CharacterEvidenceVisibility
    sourceAssetId?: string
    sourceRegion?: CharacterSourceRegion
    targetAngles: CharacterTargetAngle[]
    confidence: number
    conflictGroupId?: string
}

export type CharacterSourceCoverage = {
    sourceAssetId: string
    angles: CharacterTargetAngle[]
    regions: CharacterEvidenceRegion[]
}

export type CharacterEvidenceProfile = {
    medium: CharacterSourceMedium
    editTargetPolicy: CharacterEditTargetPolicy
    regenerationScope?: CharacterRegenerationScope
    affectedPanelIds?: string[]
    facts: CharacterEvidenceFact[]
    promptDirectives: string[]
    promptChangedFeatures: string[]
    palette: string[]
    costumeNotes: string[]
    materialNotes: string[]
    distinguishingDetailNotes: string[]
    sourceCoverage: CharacterSourceCoverage[]
    conflicts: Array<{
        conflictGroupId: string
        feature: string
        factIndexes: number[]
    }>
}

export const emptyCharacterEvidenceProfile = (): CharacterEvidenceProfile => {
    return {
        medium: 'unknown',
        editTargetPolicy: 'not-present',
        facts: [],
        promptDirectives: [],
        promptChangedFeatures: [],
        palette: [],
        costumeNotes: [],
        materialNotes: [],
        distinguishingDetailNotes: [],
        sourceCoverage: [],
        conflicts: [],
    }
}
