'use strict'

import type { CharacterPanelSpec } from '../../shared/character-sheet-media-plan.ts'

export type CharacterPanelRegenerationDecision = {
    mode: 'full-sheet' | 'selected-panels'
    regeneratePanelIds: readonly string[]
    reusePanelIds: readonly string[]
    reason: string
}

export function selectCharacterPanelsForRegeneration(args: {
    prompt: string
    panels: readonly CharacterPanelSpec[]
    availableComponentIds: ReadonlySet<string>
}): CharacterPanelRegenerationDecision {
    const panelIds = args.panels.map(panel => panel.panelId)
    const availablePanelIds = new Set(panelIds.filter(panelId => args.availableComponentIds.has(panelId)))
    if (availablePanelIds.size === 0) return fullSheet(panelIds, 'no-stored-components')

    const missingPanelIds = panelIds.filter(panelId => !availablePanelIds.has(panelId))
    const normalized = args.prompt.toLocaleLowerCase('en-US').replace(/[‐‑‒–—]/gu, '-')
    if (/\b(?:whole|entire|complete)\s+(?:character\s+)?sheet\b|\b(?:all|every)\s+(?:shot|panel|view|angle)s?\b|\bregenerate\s+(?:it\s+)?all\b/u.test(normalized)) {
        return fullSheet(panelIds, 'explicit-full-sheet-scope')
    }

    const ordinalTarget = getOrdinalTarget(normalized, panelIds)
    const explicitTargets = getExplicitViewTargets(normalized, args.panels)
    const scopedTargets = [...new Set([
        ...(ordinalTarget ? [ordinalTarget] : []),
        ...explicitTargets,
    ])]
    const explicitlyLimited = /\b(?:only|just)\b(?:\s+\S+){0,5}\s+\b(?:shot|panel|view|image|portrait|headshot)\b|\b(?:shot|panel|view|image|portrait|headshot)\b(?:\s+\S+){0,5}\s+\b(?:only|just)\b/u.test(normalized)
    if (scopedTargets.length > 0 && explicitlyLimited) {
        return selectedPanels(panelIds, availablePanelIds, [...scopedTargets, ...missingPanelIds], 'explicitly-limited-view-scope')
    }

    if (/\b(?:hair|hairstyle|headwear|face|facial identity|identity|skin|antennae?|horns?|ears?|eyes?|character design|body type|depiction medium|art style|visual style|color palette)\b/u.test(normalized)) {
        return fullSheet(panelIds, 'cross-view-identity-or-style-change')
    }

    if (scopedTargets.length > 0) {
        return selectedPanels(panelIds, availablePanelIds, [...scopedTargets, ...missingPanelIds], ordinalTarget
            ? 'explicit-shot-ordinal'
            : 'explicit-view-scope')
    }

    if (/\b(?:bag|backpack|satchel|purse|prop|belongings?|equipment|gear|weapon|accessor(?:y|ies))\b/u.test(normalized)
        && /\b(?:position|placement|proportion|scale|size|strap|wear|worn|carry|carried|attach|attached|location)\b/u.test(normalized)) {
        const affectedBodyPanels = args.panels
            .filter(panel => panel.kind === 'body' || panel.kind === 'action')
            .map(panel => panel.panelId)
        const affectedPropPanels = args.panels
            .filter(panel => panel.kind === 'prop')
            .map(panel => panel.panelId)
        return selectedPanels(
            panelIds,
            availablePanelIds,
            [...affectedBodyPanels, ...affectedPropPanels, ...missingPanelIds],
            'cross-view-prop-placement-change',
        )
    }

    return fullSheet(panelIds, 'ambiguous-edit-scope')
}

function getOrdinalTarget(prompt: string, panelIds: readonly string[]): string | undefined {
    if (/\b(?:last|final)\s+(?:shot|panel|view|image)\b/u.test(prompt)) return panelIds.at(-1)
    const match = /\b(?:shot|panel|view|image)\s*(?:number\s*)?(1|2|3|4|5|6|7|8|9|10)\b/u.exec(prompt)
        ?? /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:shot|panel|view|image)\b/u.exec(prompt)
    if (!match?.[1]) return
    const ordinalByName: Readonly<Record<string, number>> = {
        first: 1,
        second: 2,
        third: 3,
        fourth: 4,
        fifth: 5,
        sixth: 6,
        seventh: 7,
        eighth: 8,
        ninth: 9,
        tenth: 10,
    }
    const ordinal = Number(match[1]) || ordinalByName[match[1]]
    return ordinal ? panelIds[ordinal - 1] : undefined
}

function getExplicitViewTargets(prompt: string, panels: readonly CharacterPanelSpec[]): string[] {
    const targets = new Set<string>()
    const add = (...panelIds: string[]): void => {
        for (const panelId of panelIds) {
            if (panels.some(panel => panel.panelId === panelId)) targets.add(panelId)
        }
    }

    if (/\b(?:back|rear)(?:\s+full[- ]body|\s+body)?\s+(?:shot|panel|view|image)\b|\bback[- ]view\b/u.test(prompt)) {
        add(prompt.includes('detail') ? 'outfit-back-detail' : 'body-back')
    }
    if (/\bfront(?:\s+full[- ]body|\s+body)?\s+(?:shot|panel|view|image)\b|\bfront[- ]view\b/u.test(prompt)) {
        add(prompt.includes('detail') ? 'outfit-front-detail' : 'body-front')
    }
    if (/\b(?:neutral[- ]front|front)\s+(?:portrait|headshot|face)\b|\b(?:portrait|headshot)\s+(?:shot|panel|view|image)\b/u.test(prompt)) {
        add('head-front-neutral')
    }
    if (/\bthree[- ]quarter\s+(?:face|head|portrait|shot|panel|view|image)\b/u.test(prompt)) {
        add('head-three-quarter')
    }
    if (/\b(?:profile|side)(?:[- ]on)?\s+(?:shot|panel|view|image)\b|\bbody[- ]profile\b/u.test(prompt)) {
        add('body-profile')
    }
    if (/\b(?:signature|action)\s+(?:pose|shot|panel|view|image)\b/u.test(prompt)) add('action-signature')
    if (/\b(?:belongings?|props?)\s+(?:shot|panel|view|image)\b|\bisolated\s+(?:belongings?|props?)\b/u.test(prompt)) {
        add('prop-primary', 'prop-secondary')
    }
    return [...targets]
}

function selectedPanels(
    panelIds: readonly string[],
    availablePanelIds: ReadonlySet<string>,
    requestedPanelIds: readonly string[],
    reason: string,
): CharacterPanelRegenerationDecision {
    const requested = new Set(requestedPanelIds)
    const regeneratePanelIds = panelIds.filter(panelId => requested.has(panelId))
    if (regeneratePanelIds.length === 0 || regeneratePanelIds.length === panelIds.length) {
        return fullSheet(panelIds, regeneratePanelIds.length === 0 ? 'unresolved-edit-scope' : reason)
    }
    return {
        mode: 'selected-panels',
        regeneratePanelIds,
        reusePanelIds: panelIds.filter(panelId => availablePanelIds.has(panelId) && !requested.has(panelId)),
        reason,
    }
}

function fullSheet(panelIds: readonly string[], reason: string): CharacterPanelRegenerationDecision {
    return {
        mode: 'full-sheet',
        regeneratePanelIds: [...panelIds],
        reusePanelIds: [],
        reason,
    }
}
