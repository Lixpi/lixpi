import {
    type CharacterPanelSpec,
} from '../../shared/character-sheet-media-plan.ts'

import {
    type CharacterRegenerationScope,
} from './character-evidence.ts'

export type CharacterPanelRegenerationDecision = {
    mode: 'full-sheet' | 'selected-panels'
    regeneratePanelIds: readonly string[]
    reusePanelIds: readonly string[]
    reason: string
}

export const selectCharacterPanelsForRegeneration = (args: {
    panels: readonly CharacterPanelSpec[]
    availableComponentIds: ReadonlySet<string>
    regenerationScope?: CharacterRegenerationScope
    affectedPanelIds?: readonly string[]
}): CharacterPanelRegenerationDecision => {
    const panelIds = args.panels.map(panel => panel.panelId)
    const availablePanelIds = new Set(
        panelIds.filter(panelId => args.availableComponentIds.has(panelId)),
    )

    if (availablePanelIds.size === 0)
        return fullSheet(panelIds, 'no-stored-components')

    if (args.regenerationScope !== 'selected-panels') {
        return fullSheet(
            panelIds,
            args.regenerationScope === 'full-sheet'
                ? 'evidence-full-sheet-scope'
                : 'unresolved-edit-scope',
        )
    }

    const affectedPanelIds = new Set(args.affectedPanelIds ?? [])
    const missingPanelIds = panelIds.filter(panelId => !availablePanelIds.has(panelId))

    return selectedPanels(
        panelIds,
        availablePanelIds,
        [...affectedPanelIds, ...missingPanelIds],
        'evidence-selected-panel-scope',
    )
}

function selectedPanels(
    panelIds: readonly string[],
    availablePanelIds: ReadonlySet<string>,
    requestedPanelIds: readonly string[],
    reason: string,
): CharacterPanelRegenerationDecision {
    const requested = new Set(requestedPanelIds)
    const regeneratePanelIds = panelIds.filter(panelId => requested.has(panelId))

    if (
        regeneratePanelIds.length === 0
        || regeneratePanelIds.length === panelIds.length
    )
        return fullSheet(panelIds, regeneratePanelIds.length === 0 ? 'unresolved-edit-scope' : reason)

    return {
        mode: 'selected-panels',
        regeneratePanelIds,
        reusePanelIds: panelIds.filter(panelId => availablePanelIds.has(panelId) && !requested.has(panelId)),
        reason,
    }
}

function fullSheet(
    panelIds: readonly string[],
    reason: string,
): CharacterPanelRegenerationDecision {
    return {
        mode: 'full-sheet',
        regeneratePanelIds: [...panelIds],
        reusePanelIds: [],
        reason,
    }
}
