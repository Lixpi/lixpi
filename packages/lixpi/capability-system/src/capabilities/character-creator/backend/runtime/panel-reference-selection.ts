import {
    type CharacterPanelSpec,
} from '../../shared/character-sheet-media-plan.ts'
import {
    type CharacterEvidenceProfile,
} from './character-evidence.ts'
import {
    type CharacterReferencePack,
    type CharacterReferencePackEntry,
} from './reference-pack.ts'

export function selectCharacterPanelReferenceEntries(
    entries: CharacterReferencePack['entries'],
    panel: CharacterPanelSpec,
    evidence: CharacterEvidenceProfile,
): CharacterReferencePack['entries'] {
    const matchingComponents = deduplicateCompositionComponents(
        entries.filter(entry => entry.componentId === panel.panelId),
    )
    const sharedEntries = entries.filter(entry => !entry.componentId)
    const candidates = [...matchingComponents, ...sharedEntries]
    if (panel.kind !== 'head') return candidates

    const hasApprovedEditTargetIdentity = candidates.some(entry => (
        entry.role === 'edit-target-identity'
    ))
    const assignedFaceSourceIds = new Set(evidence.facts.flatMap(fact => (
        fact.visibility === 'observed'
            && fact.region === 'face'
            && fact.requestAuthority === 'assigned'
            && fact.sourceAssetId
            ? [fact.sourceAssetId]
            : []
    )))
    const croppedFaceSourceIds = new Set(candidates.flatMap(entry => (
        entry.role === 'face-crop' && entry.sourceAssetId
            ? [entry.sourceAssetId]
            : []
    )))

    return candidates.filter(entry => {
        if (entry.role === 'body-outfit-crop' || entry.role === 'prop-crop') return false
        if (entry.role === 'edit-target' || entry.role === 'edit-target-identity') return true
        if (entry.role !== 'original-source' && entry.role !== 'face-crop') return true
        if (!entry.sourceAssetId) return !hasApprovedEditTargetIdentity
        if (hasApprovedEditTargetIdentity && !assignedFaceSourceIds.has(entry.sourceAssetId)) return false
        return entry.role !== 'original-source' || !croppedFaceSourceIds.has(entry.sourceAssetId)
    })
}

const deduplicateCompositionComponents = (
    entries: readonly CharacterReferencePackEntry[],
): CharacterReferencePackEntry[] => {
    const selected = new Map<string, CharacterReferencePackEntry>()
    for (const entry of entries) {
        const compositionKey = entry.compositionAssetId
            ?? entry.sourceAssetId
            ?? entry.fileName
            ?? entry.url
        const existing = selected.get(compositionKey)
        if (!existing || getReferencePriority(entry) > getReferencePriority(existing)) {
            selected.set(compositionKey, entry)
        }
    }
    return [...selected.values()]
}

const getReferencePriority = (entry: CharacterReferencePackEntry): number => {
    if (entry.role === 'edit-target-identity') return 3
    if (entry.role === 'edit-target') return 2
    return 1
}
