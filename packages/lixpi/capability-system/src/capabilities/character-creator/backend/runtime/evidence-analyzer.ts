'use strict'

import {
    emptyCharacterEvidenceProfile,
    type CharacterEvidenceProfile,
} from './character-evidence.ts'
import type { ResolvedCharacterReference } from './reference-resolver.ts'

export type CharacterEvidenceAnalysis = {
    medium: CharacterEvidenceProfile['medium']
    facts?: CharacterEvidenceProfile['facts']
    promptDirectives?: string[]
    promptChangedFeatures?: string[]
    palette?: string[]
    costumeNotes?: string[]
    materialNotes?: string[]
    distinguishingDetailNotes?: string[]
    sourceCoverage?: CharacterEvidenceProfile['sourceCoverage']
}

export type CharacterEvidenceAnalyzerPort = {
    analyze: (args: {
        sources: readonly ResolvedCharacterReference[]
        userPrompt: string
        signal?: AbortSignal
    }) => Promise<CharacterEvidenceAnalysis>
}

export async function analyzeCharacterEvidence(args: {
    sources: readonly ResolvedCharacterReference[]
    userPrompt: string
    analyzer?: CharacterEvidenceAnalyzerPort
    signal?: AbortSignal
}): Promise<CharacterEvidenceProfile> {
    if (args.sources.length === 0) return emptyCharacterEvidenceProfile()
    if (!args.analyzer) throw new Error('CHARACTER_EVIDENCE_ANALYZER_REQUIRED')
    const analysis = await args.analyzer.analyze(args)
    const facts = (analysis.facts ?? []).map(fact => ({
        ...fact,
        confidence: clampConfidence(fact.confidence),
    }))
    validateEvidenceCoordinates(facts, analysis.sourceCoverage ?? [], args.sources)
    const conflicts = findConflicts(facts)
    return {
        medium: analysis.medium,
        facts,
        promptDirectives: unique(analysis.promptDirectives ?? []),
        promptChangedFeatures: unique(analysis.promptChangedFeatures ?? []),
        palette: unique(analysis.palette ?? []).slice(0, 8),
        costumeNotes: unique(analysis.costumeNotes ?? []),
        materialNotes: unique(analysis.materialNotes ?? []),
        distinguishingDetailNotes: unique(analysis.distinguishingDetailNotes ?? []),
        sourceCoverage: analysis.sourceCoverage ?? buildDefaultCoverage(args.sources),
        conflicts,
    }
}

export function selectCharacterEvidenceFacts(args: {
    evidence: CharacterEvidenceProfile
    targetAngle: string
    promptChangedFeatures: readonly string[]
}): CharacterEvidenceProfile['facts'] {
    const changed = new Set(args.promptChangedFeatures.map(normalize))
    const byFeature = new Map<string, CharacterEvidenceProfile['facts']>()
    for (const fact of args.evidence.facts) {
        if (changed.has(normalize(fact.feature))) continue
        const key = normalize(fact.feature)
        const candidates = byFeature.get(key) ?? []
        candidates.push(fact)
        byFeature.set(key, candidates)
    }
    return [...byFeature.values()].flatMap(candidates => {
        const observed = candidates.filter(fact => fact.visibility === 'observed')
        const pool = observed.length > 0 ? observed : candidates
        return [pool.sort((left, right) => targetSpecificity(right, args.targetAngle)
            - targetSpecificity(left, args.targetAngle) || right.confidence - left.confidence)[0]!]
    })
}

const buildDefaultCoverage = (sources: readonly ResolvedCharacterReference[]): CharacterEvidenceProfile['sourceCoverage'] =>
    sources.map(source => ({
        sourceAssetId: source.assetId,
        angles: ['unspecified'],
        regions: ['face', 'body', 'outfit'],
    }))

const findConflicts = (facts: CharacterEvidenceProfile['facts']): CharacterEvidenceProfile['conflicts'] => {
    const groups = new Map<string, number[]>()
    facts.forEach((fact, index) => {
        if (!fact.conflictGroupId) return
        const indexes = groups.get(fact.conflictGroupId) ?? []
        indexes.push(index)
        groups.set(fact.conflictGroupId, indexes)
    })
    return [...groups.entries()].map(([conflictGroupId, factIndexes]) => ({
        conflictGroupId,
        feature: facts[factIndexes[0]!]?.feature ?? 'unknown',
        factIndexes,
    }))
}

const validateEvidenceCoordinates = (
    facts: CharacterEvidenceProfile['facts'],
    coverage: CharacterEvidenceProfile['sourceCoverage'],
    sources: readonly ResolvedCharacterReference[],
): void => {
    const sourcesById = new Map(sources.map(source => [source.assetId, source]))
    for (const fact of facts) {
        if (!fact.feature.trim() || !fact.value.trim() || fact.targetAngles.length === 0) {
            throw new Error('CHARACTER_EVIDENCE_FACT_INVALID')
        }
        if (fact.visibility === 'observed' && !fact.sourceAssetId) {
            throw new Error('CHARACTER_EVIDENCE_OBSERVED_SOURCE_REQUIRED')
        }
        if (!fact.sourceAssetId && fact.sourceRegion) throw new Error('CHARACTER_EVIDENCE_REGION_SOURCE_REQUIRED')
        if (!fact.sourceAssetId) continue
        const source = sourcesById.get(fact.sourceAssetId)
        if (!source) throw new Error('CHARACTER_EVIDENCE_SOURCE_UNKNOWN')
        if (!fact.sourceRegion) continue
        const region = fact.sourceRegion
        if (![region.x, region.y, region.width, region.height].every(Number.isFinite)
            || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
            || region.x + region.width > source.width || region.y + region.height > source.height) {
            throw new Error('CHARACTER_EVIDENCE_REGION_INVALID')
        }
    }
    if (coverage.some(item => !sourcesById.has(item.sourceAssetId))) {
        throw new Error('CHARACTER_EVIDENCE_COVERAGE_SOURCE_UNKNOWN')
    }
}

const targetSpecificity = (fact: CharacterEvidenceProfile['facts'][number], targetAngle: string): number =>
    fact.targetAngles.some(angle => targetAngle.includes(angle)) ? 1 : 0

const clampConfidence = (value: number): number => Math.max(0, Math.min(1, value))
const normalize = (value: string): string => value.trim().toLocaleLowerCase()
const unique = (values: readonly string[]): string[] => [...new Set(values.map(value => value.trim()).filter(Boolean))]
