'use strict'

import type { CharacterPanelSpec } from '../../shared/character-sheet-media-plan.ts'

import {
    emptyCharacterEvidenceProfile,
    type CharacterEditTargetPolicy,
    type CharacterEvidenceRegion,
    type CharacterEvidenceProfile,
    type CharacterRegenerationScope,
} from './character-evidence.ts'
import type { ResolvedCharacterReference } from './reference-resolver.ts'

export type CharacterEvidenceAnalysis = {
    medium: CharacterEvidenceProfile['medium']
    editTargetPolicy?: CharacterEditTargetPolicy
    editTargetApprovedRegions?: CharacterEvidenceRegion[]
    editTargetRejectedRegions?: CharacterEvidenceRegion[]
    regenerationScope?: CharacterRegenerationScope
    affectedPanelIds?: string[]
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
        editTargets?: readonly ResolvedCharacterReference[]
        referenceAliases?: ReadonlyArray<{ assetId: string; alias: string }>
        panels?: readonly CharacterPanelSpec[]
        userPrompt: string
        editTargetPresent?: boolean
        signal?: AbortSignal
    }) => Promise<CharacterEvidenceAnalysis>
}

export async function analyzeCharacterEvidence(args: {
    sources: readonly ResolvedCharacterReference[]
    editTargets?: readonly ResolvedCharacterReference[]
    referenceAliases?: ReadonlyArray<{ assetId: string; alias: string }>
    panels?: readonly CharacterPanelSpec[]
    userPrompt: string
    analyzer?: CharacterEvidenceAnalyzerPort
    editTargetPresent?: boolean
    signal?: AbortSignal
}): Promise<CharacterEvidenceProfile> {
    if (args.sources.length === 0 && (args.editTargets?.length ?? 0) === 0) {
        return {
            ...emptyCharacterEvidenceProfile(),
            editTargetPolicy: args.editTargetPresent ? 'preserve-panel' : 'not-present',
        }
    }
    if (!args.analyzer) throw new Error('CHARACTER_EVIDENCE_ANALYZER_REQUIRED')
    const analysis = await args.analyzer.analyze(args)
    const facts = resolveUnambiguousObservedSources(analysis.facts ?? [], args.sources).map(fact => ({
        ...fact,
        confidence: clampConfidence(fact.confidence),
    }))
    validateEvidenceCoordinates(facts, analysis.sourceCoverage ?? [], args.sources)
    const conflicts = findConflicts(facts)
    const panelIds = new Set((args.panels ?? []).map(panel => panel.panelId))
    const affectedPanelIds = unique(analysis.affectedPanelIds ?? [])
        .filter(panelId => panelIds.size === 0 || panelIds.has(panelId))
    const regenerationScope = resolveRegenerationScope(
        analysis.regenerationScope,
        affectedPanelIds,
        panelIds,
    )
    return {
        medium: analysis.medium,
        editTargetPolicy: resolveEditTargetPolicy({
            editTargetPresent: Boolean(args.editTargetPresent),
            reportedPolicy: analysis.editTargetPolicy,
            approvedRegions: analysis.editTargetApprovedRegions ?? [],
            rejectedRegions: analysis.editTargetRejectedRegions ?? [],
        }),
        regenerationScope,
        affectedPanelIds: regenerationScope === 'full-sheet' && panelIds.size > 0
            ? [...panelIds]
            : affectedPanelIds,
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
        const key = normalize(fact.feature)
        const candidates = byFeature.get(key) ?? []
        candidates.push(fact)
        byFeature.set(key, candidates)
    }
    return [...byFeature.values()].flatMap(candidates => {
        const observed = candidates.filter(fact => fact.visibility === 'observed')
        const pool = observed.length > 0 ? observed : candidates
        return [pool.sort((left, right) => requestAuthorityPriority(right.requestAuthority)
            - requestAuthorityPriority(left.requestAuthority)
            || targetSpecificity(right, args.targetAngle) - targetSpecificity(left, args.targetAngle)
            || right.confidence - left.confidence)[0]!]
    }).sort((left, right) => Number(changed.has(normalize(right.feature)))
        - Number(changed.has(normalize(left.feature))))
}

const buildDefaultCoverage = (sources: readonly ResolvedCharacterReference[]): CharacterEvidenceProfile['sourceCoverage'] =>
    sources.map(source => ({
        sourceAssetId: source.assetId,
        angles: ['unspecified'],
        regions: ['face', 'body', 'outfit'],
    }))

const resolveUnambiguousObservedSources = (
    facts: CharacterEvidenceProfile['facts'],
    sources: readonly ResolvedCharacterReference[],
): CharacterEvidenceProfile['facts'] => {
    const sourceAssetIds = [...new Set(sources.map(source => source.assetId))]
    const soleSourceAssetId = sourceAssetIds.length === 1 ? sourceAssetIds[0] : undefined
    if (!soleSourceAssetId) return facts
    return facts.map(fact => fact.visibility === 'observed' && !fact.sourceAssetId
        ? { ...fact, sourceAssetId: soleSourceAssetId }
        : fact)
}

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

const requestAuthorityPriority = (
    authority: CharacterEvidenceProfile['facts'][number]['requestAuthority'],
): number => authority === 'assigned' ? 2 : authority === 'supporting' ? 1 : 0

const EDIT_TARGET_REGIONS: readonly CharacterEvidenceRegion[] = [
    'face',
    'body',
    'outfit',
    'hands',
    'feet',
    'prop',
]

const resolveEditTargetPolicy = ({
    editTargetPresent,
    reportedPolicy,
    approvedRegions,
    rejectedRegions,
}: {
    editTargetPresent: boolean
    reportedPolicy: CharacterEditTargetPolicy | undefined
    approvedRegions: readonly CharacterEvidenceRegion[]
    rejectedRegions: readonly CharacterEvidenceRegion[]
}): CharacterEditTargetPolicy => {
    if (!editTargetPresent) return 'not-present'
    const approved = new Set(approvedRegions)
    const rejected = new Set(rejectedRegions)
    if (EDIT_TARGET_REGIONS.every(region => rejected.has(region))) return 'discard'
    if (approved.size > 0
        && [...approved].every(region => region === 'face')
        && [...rejected].some(region => region !== 'face')) {
        return 'identity-only'
    }
    if (reportedPolicy === 'identity-only' || reportedPolicy === 'discard') return reportedPolicy
    return 'preserve-panel'
}

const resolveRegenerationScope = (
    reportedScope: CharacterRegenerationScope | undefined,
    affectedPanelIds: readonly string[],
    panelIds: ReadonlySet<string>,
): CharacterRegenerationScope => {
    if (reportedScope === 'selected-panels'
        && affectedPanelIds.length > 0
        && (panelIds.size === 0 || affectedPanelIds.length < panelIds.size)) {
        return 'selected-panels'
    }
    return 'full-sheet'
}

const clampConfidence = (value: number): number => Math.max(0, Math.min(1, value))
const normalize = (value: string): string => value.trim().toLocaleLowerCase()
const unique = (values: readonly string[]): string[] => [...new Set(values.map(value => value.trim()).filter(Boolean))]
