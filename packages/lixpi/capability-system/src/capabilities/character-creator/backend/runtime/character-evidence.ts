'use strict'

export type CharacterSourceMedium = 'photograph' | 'illustration' | 'render' | 'mixed' | 'unknown'
export type CharacterEvidenceVisibility = 'observed' | 'inferred'
export type CharacterTargetAngle = 'front' | 'three-quarter-front' | 'profile' | 'three-quarter-back' | 'back' | 'unspecified'

export type CharacterSourceRegion = {
    x: number
    y: number
    width: number
    height: number
}

export type CharacterEvidenceFact = {
    feature: string
    value: string
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
    regions: Array<'face' | 'body' | 'outfit' | 'hands' | 'feet' | 'prop'>
}

export type CharacterEvidenceProfile = {
    medium: CharacterSourceMedium
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

export function emptyCharacterEvidenceProfile(): CharacterEvidenceProfile {
    return {
        medium: 'unknown',
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
