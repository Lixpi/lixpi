'use strict'

import type { CapabilityJsonValue } from '@lixpi/constants'
import type {
    CapabilityMediaDagNodePlan,
    CapabilityMediaDagOutputBinding,
    CapabilityMediaExecutionPlan,
} from '../../../shared/capability-media-execution-plan.ts'

export type CharacterPanelKind = 'body' | 'head' | 'prop' | 'action'
export type CharacterPanelCrop = 'full-body' | 'upper-body' | 'prop' | 'action'
export type CharacterPanelCondition = 'always' | 'generate-when-no-observed-prop'
export type CharacterGeneratedReferenceRole = 'canonical-anchor' | 'adjacent-angle' | 'opposite-angle'
export type CharacterPanelOutputBinding = CapabilityMediaDagOutputBinding<{
    referenceRole: CharacterGeneratedReferenceRole
    fileName: string
}>

export type CharacterPanelSpec = CapabilityMediaDagNodePlan<CharacterPanelOutputBinding> & {
    panelId: string
    kind: CharacterPanelKind
    title: string
    target: string
    crop: CharacterPanelCrop
    required: boolean
    condition: CharacterPanelCondition
    acceptanceDimensions: string[]
}

export type CharacterSheetRenderPlan = CapabilityMediaExecutionPlan & {
    kind: 'character-sheet'
    capabilityRunId: string
    sourceAssetIds: string[]
    userPrompt: string
    panels: CharacterPanelSpec[]
    layoutId: 'character-sheet-3840x2560'
    semanticRetryLimit: 0
}

export const CHARACTER_SHEET_DEFAULT_OPERATION_COUNT = 3
export const CHARACTER_SHEET_BASE_OPERATION_COUNT = CHARACTER_SHEET_DEFAULT_OPERATION_COUNT
export const CHARACTER_SHEET_MAX_OPERATION_COUNT = 10
export const CHARACTER_SHEET_MAX_PROVIDER_OPERATIONS = CHARACTER_SHEET_MAX_OPERATION_COUNT
export const CHARACTER_IDENTITY_ANCHOR_PANEL_ID = 'head-front-neutral'
export const CHARACTER_OUTFIT_ANCHOR_PANEL_ID = 'body-front'
export const CHARACTER_BACK_ANCHOR_PANEL_ID = 'body-back'
export const CHARACTER_IDENTITY_ANCHOR_BINDING_KEY = 'generated-identity-anchor'
export const CHARACTER_OUTFIT_ANCHOR_BINDING_KEY = 'generated-outfit-anchor'
export const CHARACTER_BACK_ANCHOR_BINDING_KEY = 'generated-back-outfit-anchor'

const identityAnchorBinding: CharacterPanelOutputBinding = {
    bindingKey: CHARACTER_IDENTITY_ANCHOR_BINDING_KEY,
    sourceNodeId: CHARACTER_IDENTITY_ANCHOR_PANEL_ID,
    required: true,
    referenceRole: 'adjacent-angle',
    fileName: 'GENERATED_IDENTITY_ANCHOR.png',
}

const outfitAnchorBinding: CharacterPanelOutputBinding = {
    bindingKey: CHARACTER_OUTFIT_ANCHOR_BINDING_KEY,
    sourceNodeId: CHARACTER_OUTFIT_ANCHOR_PANEL_ID,
    required: true,
    referenceRole: 'canonical-anchor',
    fileName: 'GENERATED_OUTFIT_ANCHOR.png',
}

const backAnchorBinding: CharacterPanelOutputBinding = {
    bindingKey: CHARACTER_BACK_ANCHOR_BINDING_KEY,
    sourceNodeId: CHARACTER_BACK_ANCHOR_PANEL_ID,
    required: true,
    referenceRole: 'opposite-angle',
    fileName: 'GENERATED_BACK_OUTFIT_ANCHOR.png',
}

export const characterSheetShotGraph = {
    defaultPanelIds: [
        CHARACTER_IDENTITY_ANCHOR_PANEL_ID,
        CHARACTER_OUTFIT_ANCHOR_PANEL_ID,
        CHARACTER_BACK_ANCHOR_PANEL_ID,
    ],
    generatedReferenceSets: {
        identity: [{
            ...identityAnchorBinding,
            referenceRole: 'canonical-anchor' as const,
        }],
        identityAndOutfit: [identityAnchorBinding, outfitAnchorBinding],
        identityAndCompleteOutfit: [identityAnchorBinding, outfitAnchorBinding, backAnchorBinding],
    },
} as const

function generatedReferenceDependencies(
    bindings: readonly CharacterPanelOutputBinding[],
): CapabilityMediaDagNodePlan<CharacterPanelOutputBinding> {
    return {
        dependsOn: [...new Set(bindings.map(binding => binding.sourceNodeId))],
        outputBindings: structuredClone(bindings),
    }
}

const frontFacePanel: CharacterPanelSpec = {
    panelId: CHARACTER_IDENTITY_ANCHOR_PANEL_ID,
    kind: 'head',
    title: 'Neutral front identity portrait',
    target: 'close straight-on head-and-shoulders identity portrait with a relaxed neutral expression, level gaze, closed relaxed mouth, 10-12 percent clean clearance above the complete hair or headwear, the complete face and neck visible, a crop immediately below the collarbones with no armpits or arms, head upright, and the head and facial region occupying 55-60 percent of image height so facial details are sharp and unobstructed',
    crop: 'upper-body',
    dependsOn: [],
    outputBindings: [],
    required: true,
    condition: 'always',
    acceptanceDimensions: ['request-compliance', 'depiction-medium', 'facial-identity', 'hair', 'skin', 'distinctive-features', 'sharpness', 'framing'],
}

const frontBodyPanel: CharacterPanelSpec = {
    panelId: CHARACTER_OUTFIT_ANCHOR_PANEL_ID,
    kind: 'body',
    title: 'Front body',
    target: 'relaxed straight-on full-body front view from the complete top of the hair or headwear through the footwear, head upright, shoulders level, arms hanging naturally with slight separation from the torso, and feet hip-width apart',
    crop: 'full-body',
    ...generatedReferenceDependencies(characterSheetShotGraph.generatedReferenceSets.identity),
    required: true,
    condition: 'always',
    acceptanceDimensions: ['request-compliance', 'depiction-medium', 'target-view', 'facial-identity', 'body-proportions', 'clothing', 'materials', 'framing'],
}

const backBodyPanel: CharacterPanelSpec = {
    panelId: CHARACTER_BACK_ANCHOR_PANEL_ID,
    kind: 'body',
    title: 'Back body',
    target: 'neutral straight-on full-body back view from the complete top of the hair or headwear through the footwear, with the rear silhouette, garment construction, layers, seams, accessories, materials, and footwear clearly visible',
    crop: 'full-body',
    ...generatedReferenceDependencies(characterSheetShotGraph.generatedReferenceSets.identityAndOutfit),
    required: true,
    condition: 'always',
    acceptanceDimensions: ['request-compliance', 'depiction-medium', 'target-view', 'identity', 'body-proportions', 'clothing', 'materials', 'framing'],
}

const optionalPanels: Readonly<Record<string, CharacterPanelSpec>> = {
    'body-profile': {
        panelId: 'body-profile',
        kind: 'body',
        title: 'Walking body profile',
        target: 'exact left-profile full-body walking view from the complete top of the hair or headwear through the footwear, head upright with level gaze, spine neutral, modest stride, relaxed arm counter-swing, and a clearly readable silhouette',
        crop: 'full-body',
        ...generatedReferenceDependencies(characterSheetShotGraph.generatedReferenceSets.identityAndCompleteOutfit),
        required: true,
        condition: 'always',
        acceptanceDimensions: ['request-compliance', 'depiction-medium', 'target-view', 'identity', 'body-proportions', 'clothing', 'materials', 'framing'],
    },
    'head-three-quarter': {
        panelId: 'head-three-quarter',
        kind: 'head',
        title: 'Three-quarter face',
        target: 'close three-quarter head-and-shoulders identity view with a relaxed neutral expression, 10-12 percent clean clearance above the complete hair or headwear, the complete face and neck visible, a crop immediately below the collarbones with no armpits or arms, the head upright, and the head and facial region occupying 55-60 percent of image height',
        crop: 'upper-body',
        ...generatedReferenceDependencies(characterSheetShotGraph.generatedReferenceSets.identityAndCompleteOutfit),
        required: true,
        condition: 'always',
        acceptanceDimensions: ['request-compliance', 'depiction-medium', 'target-view', 'facial-identity', 'hair', 'skin', 'distinctive-features', 'sharpness'],
    },
    'prop-primary': {
        panelId: 'prop-primary',
        kind: 'prop',
        title: 'Belongings',
        target: 'isolated primary belongings, equipment, accessories, or prop arranged clearly at character scale',
        crop: 'prop',
        ...generatedReferenceDependencies(characterSheetShotGraph.generatedReferenceSets.identityAndCompleteOutfit),
        required: false,
        condition: 'generate-when-no-observed-prop',
        acceptanceDimensions: ['request-compliance', 'depiction-medium', 'prop-design', 'materials', 'color', 'scale', 'framing'],
    },
    'action-signature': {
        panelId: 'action-signature',
        kind: 'action',
        title: 'Signature pose',
        target: 'complete character in a restrained signature action pose with the full silhouette visible',
        crop: 'action',
        ...generatedReferenceDependencies(characterSheetShotGraph.generatedReferenceSets.identityAndCompleteOutfit),
        required: true,
        condition: 'always',
        acceptanceDimensions: ['request-compliance', 'depiction-medium', 'action-pose', 'facial-identity', 'body-proportions', 'clothing', 'materials', 'framing'],
    },
    'outfit-front-detail': {
        panelId: 'outfit-front-detail',
        kind: 'body',
        title: 'Front outfit detail',
        target: 'neutral straight-on upper-body outfit construction view from the complete top of the hair or headwear through the hips, with garment layers, closures, seams, accessories, and material transitions clearly visible',
        crop: 'upper-body',
        ...generatedReferenceDependencies(characterSheetShotGraph.generatedReferenceSets.identityAndCompleteOutfit),
        required: true,
        condition: 'always',
        acceptanceDimensions: ['request-compliance', 'depiction-medium', 'target-view', 'identity', 'clothing', 'materials', 'accessories', 'framing'],
    },
    'outfit-back-detail': {
        panelId: 'outfit-back-detail',
        kind: 'body',
        title: 'Back outfit detail',
        target: 'neutral straight-on upper-body back view from the complete top of the hair or headwear through the hips, with rear garment construction, seams, accessories, and material transitions clearly visible',
        crop: 'upper-body',
        ...generatedReferenceDependencies(characterSheetShotGraph.generatedReferenceSets.identityAndCompleteOutfit),
        required: true,
        condition: 'always',
        acceptanceDimensions: ['request-compliance', 'depiction-medium', 'target-view', 'identity', 'clothing', 'materials', 'accessories', 'framing'],
    },
    'prop-secondary': {
        panelId: 'prop-secondary',
        kind: 'prop',
        title: 'Additional belongings',
        target: 'isolated secondary belongings, equipment, accessories, or prop arranged clearly at character scale without repeating the primary belonging',
        crop: 'prop',
        ...generatedReferenceDependencies(characterSheetShotGraph.generatedReferenceSets.identityAndCompleteOutfit),
        required: false,
        condition: 'generate-when-no-observed-prop',
        acceptanceDimensions: ['request-compliance', 'depiction-medium', 'prop-design', 'materials', 'color', 'scale', 'framing'],
    },
}

const numberWords: Readonly<Record<string, number>> = {
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
}

function resolveRequestedPanelCount(prompt: string, requestedPriorityCount: number): number {
    const countPattern = /\b(3|4|5|6|7|8|9|10|three|four|five|six|seven|eight|nine|ten)(?:\s*[- ]\s*|\s+)(?:(?:different|distinct|detailed|separate|total|character|full)\s+){0,2}(?:shot|view|panel|angle|pose|image)s?\b/iu
    const match = countPattern.exec(prompt)
    if (match?.[1]) {
        const count = Number(match[1])
            || numberWords[match[1].toLocaleLowerCase('en-US')]
            || CHARACTER_SHEET_DEFAULT_OPERATION_COUNT
        return Math.max(CHARACTER_SHEET_DEFAULT_OPERATION_COUNT, Math.min(CHARACTER_SHEET_MAX_OPERATION_COUNT, count))
    }
    if (/\b(?:comprehensive|exhaustive)\b/iu.test(prompt)) return CHARACTER_SHEET_MAX_OPERATION_COUNT
    const expandsDefault = /\b(?:include|add|show|cover|detail|feature|focus on)\b(?:\s+\S+){0,4}\s+\b(?:belongings?|props?|equipment|gear|weapons?|accessories|profiles?|back views?|rear views?|face angles?|facial details?|action poses?|pose studies|outfits?|clothing|garments?|materials?)\b/iu.test(prompt)
    if (!expandsDefault) return CHARACTER_SHEET_DEFAULT_OPERATION_COUNT
    return Math.min(
        CHARACTER_SHEET_MAX_OPERATION_COUNT,
        CHARACTER_SHEET_DEFAULT_OPERATION_COUNT + requestedPriorityCount,
    )
}

function getRequestedOptionalPanelOrder(prompt: string): string[] {
    const normalized = prompt.toLocaleLowerCase('en-US')
    const requested: string[] = []
    const add = (...panelIds: string[]): void => {
        for (const panelId of panelIds) {
            if (!requested.includes(panelId)) requested.push(panelId)
        }
    }

    if (/\b(?:belonging|belongings|prop|props|equipment|gear|weapon|weapons|accessor(?:y|ies)|item|items)\b/u.test(normalized)) {
        add('prop-primary')
    }
    if (/\b(?:multiple|several|different|additional|secondary)\b(?:\s+\S+){0,3}\s+\b(?:belongings?|props?|equipment|gear|weapons?|accessories|items?)\b/u.test(normalized)) {
        add('prop-secondary')
    }
    if (/\b(?:profile|side(?:[- ]?on)?|side view)\b/u.test(normalized)) add('body-profile')
    if (/\b(?:face angle|facial detail|portrait|close[- ]?up)\b/u.test(normalized)) add('head-three-quarter')
    if (/\b(?:action|pose|movement|dynamic)\b/u.test(normalized)) add('action-signature')
    if (/\b(?:outfit|clothing|garment|costume|material|seam|closure|layer)\b/u.test(normalized)) {
        add('outfit-front-detail', 'outfit-back-detail')
    }

    return requested
}

function getOptionalPanelOrder(requested: readonly string[]): string[] {
    const ordered = [...requested]
    const add = (...panelIds: string[]): void => {
        for (const panelId of panelIds) {
            if (!ordered.includes(panelId)) ordered.push(panelId)
        }
    }

    add(
        'body-profile',
        'head-three-quarter',
        'prop-primary',
        'action-signature',
        'outfit-front-detail',
        'outfit-back-detail',
        'prop-secondary',
    )
    return ordered
}

export function buildCharacterPanelSpecs(userPrompt = ''): CharacterPanelSpec[] {
    const requested = getRequestedOptionalPanelOrder(userPrompt)
    const panelCount = resolveRequestedPanelCount(userPrompt, requested.length)
    const optionalCount = panelCount - CHARACTER_SHEET_DEFAULT_OPERATION_COUNT
    const optional = getOptionalPanelOrder(requested)
        .slice(0, optionalCount)
        .map(panelId => optionalPanels[panelId]!)
    return structuredClone([
        frontFacePanel,
        frontBodyPanel,
        backBodyPanel,
        ...optional,
    ])
}

export function buildCharacterSheetRenderPlan(args: {
    capabilityRunId: string
    sourceAssetIds: string[]
    userPrompt: string
}): CharacterSheetRenderPlan {
    const plan: CharacterSheetRenderPlan = {
        kind: 'character-sheet',
        capabilityRunId: args.capabilityRunId,
        sourceAssetIds: [...new Set(args.sourceAssetIds)],
        userPrompt: args.userPrompt.trim(),
        panels: buildCharacterPanelSpecs(args.userPrompt),
        layoutId: 'character-sheet-3840x2560',
        semanticRetryLimit: 0,
    }
    assertValidCharacterSheetRenderPlan(plan)
    return plan
}

export function assertValidCharacterSheetRenderPlan(value: unknown): asserts value is CharacterSheetRenderPlan {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CHARACTER_SHEET_PLAN_INVALID')
    const plan = value as Partial<CharacterSheetRenderPlan>
    if (plan.kind !== 'character-sheet') throw new Error('CHARACTER_SHEET_PLAN_KIND_INVALID')
    if (typeof plan.capabilityRunId !== 'string' || !plan.capabilityRunId.trim()) throw new Error('CHARACTER_SHEET_PLAN_RUN_ID_REQUIRED')
    if (typeof plan.userPrompt !== 'string' || !plan.userPrompt.trim()) throw new Error('CHARACTER_SHEET_PLAN_PROMPT_REQUIRED')
    if (!Array.isArray(plan.sourceAssetIds) || plan.sourceAssetIds.some(assetId => typeof assetId !== 'string' || !assetId.trim())) {
        throw new Error('CHARACTER_SHEET_PLAN_SOURCE_ASSETS_INVALID')
    }
    if (new Set(plan.sourceAssetIds).size !== plan.sourceAssetIds.length) throw new Error('CHARACTER_SHEET_PLAN_SOURCE_ASSETS_DUPLICATE')
    if (plan.layoutId !== 'character-sheet-3840x2560') throw new Error('CHARACTER_SHEET_PLAN_LAYOUT_INVALID')
    if (plan.semanticRetryLimit !== 0) throw new Error('CHARACTER_SHEET_PLAN_RETRY_LIMIT_INVALID')
    if (!Array.isArray(plan.panels)
        || plan.panels.length < CHARACTER_SHEET_DEFAULT_OPERATION_COUNT
        || plan.panels.length > CHARACTER_SHEET_MAX_OPERATION_COUNT) {
        throw new Error('CHARACTER_SHEET_PLAN_PANEL_COUNT_INVALID')
    }
    const panelIds = new Set<string>()
    for (const panel of plan.panels) {
        if (!panel || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(panel.panelId)) throw new Error('CHARACTER_SHEET_PLAN_PANEL_ID_INVALID')
        if (panelIds.has(panel.panelId)) throw new Error(`CHARACTER_SHEET_PLAN_PANEL_ID_DUPLICATE:${panel.panelId}`)
        panelIds.add(panel.panelId)
    }
    for (const panel of plan.panels) {
        if (!Array.isArray(panel.dependsOn)
            || panel.dependsOn.some(dependency => typeof dependency !== 'string')) {
            throw new Error(`CHARACTER_SHEET_PLAN_DEPENDENCIES_INVALID:${panel.panelId}`)
        }
        if (panel.dependsOn.some(dependency => !panelIds.has(dependency))) {
            throw new Error(`CHARACTER_SHEET_PLAN_DEPENDENCY_UNKNOWN:${panel.panelId}`)
        }
        if (!Array.isArray(panel.outputBindings)) {
            throw new Error(`CHARACTER_SHEET_PLAN_OUTPUT_BINDINGS_INVALID:${panel.panelId}`)
        }
        const bindingKeys = new Set<string>()
        for (const binding of panel.outputBindings) {
            if (!binding
                || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(binding.bindingKey)
                || typeof binding.sourceNodeId !== 'string'
                || typeof binding.required !== 'boolean'
                || !['canonical-anchor', 'adjacent-angle', 'opposite-angle'].includes(binding.referenceRole)
                || !/^GENERATED_[A-Z0-9_]+\.png$/u.test(binding.fileName)) {
                throw new Error(`CHARACTER_SHEET_PLAN_OUTPUT_BINDING_INVALID:${panel.panelId}`)
            }
            if (!panel.dependsOn.includes(binding.sourceNodeId)) {
                throw new Error(`CHARACTER_SHEET_PLAN_OUTPUT_BINDING_SOURCE_INVALID:${panel.panelId}`)
            }
            if (bindingKeys.has(binding.bindingKey)) {
                throw new Error(`CHARACTER_SHEET_PLAN_OUTPUT_BINDING_DUPLICATE:${panel.panelId}`)
            }
            bindingKeys.add(binding.bindingKey)
        }
    }
    for (const [index, panelId] of characterSheetShotGraph.defaultPanelIds.entries()) {
        if (plan.panels[index]?.panelId !== panelId || plan.panels[index]?.required !== true) {
            throw new Error(`CHARACTER_SHEET_PLAN_DEFAULT_SEQUENCE_INVALID:${panelId}`)
        }
    }
    const identityAnchor = plan.panels.find(panel => panel.panelId === CHARACTER_IDENTITY_ANCHOR_PANEL_ID)
    if (!identityAnchor?.required
        || identityAnchor.dependsOn.length > 0
        || identityAnchor.outputBindings.length > 0) {
        throw new Error('CHARACTER_SHEET_PLAN_IDENTITY_ANCHOR_INVALID')
    }
    const outfitAnchor = plan.panels.find(panel => panel.panelId === CHARACTER_OUTFIT_ANCHOR_PANEL_ID)
    if (!outfitAnchor?.required) throw new Error('CHARACTER_SHEET_PLAN_OUTFIT_ANCHOR_INVALID')
    assertGeneratedReferenceSet(
        outfitAnchor,
        characterSheetShotGraph.generatedReferenceSets.identity,
    )
    for (const panel of plan.panels) {
        if (panel.panelId === CHARACTER_IDENTITY_ANCHOR_PANEL_ID
            || panel.panelId === CHARACTER_OUTFIT_ANCHOR_PANEL_ID) continue
        if (panel.panelId === CHARACTER_BACK_ANCHOR_PANEL_ID) {
            assertGeneratedReferenceSet(
                panel,
                characterSheetShotGraph.generatedReferenceSets.identityAndOutfit,
            )
            continue
        }
        assertGeneratedReferenceSet(
            panel,
            characterSheetShotGraph.generatedReferenceSets.identityAndCompleteOutfit,
        )
    }
    assertAcyclicPanels(plan.panels)
    if (plan.panels.length > CHARACTER_SHEET_MAX_PROVIDER_OPERATIONS) {
        throw new Error('CHARACTER_SHEET_PLAN_OPERATION_BOUND_EXCEEDED')
    }
}

function assertGeneratedReferenceSet(
    panel: CharacterPanelSpec,
    expectedBindings: readonly CharacterPanelOutputBinding[],
): void {
    const expectedDependencies = [...new Set(expectedBindings.map(binding => binding.sourceNodeId))]
    if (panel.dependsOn.length !== expectedDependencies.length
        || panel.dependsOn.some((dependency, index) => dependency !== expectedDependencies[index])
        || panel.outputBindings.length !== expectedBindings.length) {
        throw new Error(`CHARACTER_SHEET_PLAN_GENERATED_REFERENCE_SET_INVALID:${panel.panelId}`)
    }
    for (const [index, expected] of expectedBindings.entries()) {
        const actual = panel.outputBindings[index]
        if (actual?.bindingKey !== expected.bindingKey
            || actual.sourceNodeId !== expected.sourceNodeId
            || actual.required !== expected.required
            || actual.referenceRole !== expected.referenceRole
            || actual.fileName !== expected.fileName) {
            throw new Error(`CHARACTER_SHEET_PLAN_GENERATED_REFERENCE_SET_INVALID:${panel.panelId}`)
        }
    }
}

function assertAcyclicPanels(panels: CharacterPanelSpec[]): void {
    const panelsById = new Map(panels.map(panel => [panel.panelId, panel]))
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (panelId: string): void => {
        if (visited.has(panelId)) return
        if (visiting.has(panelId)) throw new Error(`CHARACTER_SHEET_PLAN_CYCLE:${panelId}`)
        visiting.add(panelId)
        for (const dependency of panelsById.get(panelId)?.dependsOn ?? []) visit(dependency)
        visiting.delete(panelId)
        visited.add(panelId)
    }
    for (const panel of panels) visit(panel.panelId)
}

export function isCapabilityMediaExecutionPlan(value: CapabilityJsonValue | unknown): value is CharacterSheetRenderPlan {
    try {
        assertValidCharacterSheetRenderPlan(value)
        return true
    } catch {
        return false
    }
}
