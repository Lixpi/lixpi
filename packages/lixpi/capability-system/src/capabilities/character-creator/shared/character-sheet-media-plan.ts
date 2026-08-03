'use strict'

import type { CapabilityJsonValue } from '@lixpi/constants'
import type { CapabilityMediaExecutionPlan } from '../../../shared/capability-media-execution-plan.ts'

export type CharacterPanelKind = 'body' | 'head' | 'expression' | 'mouth' | 'hand' | 'prop' | 'action'
export type CharacterPanelCrop = 'full-body' | 'head-and-shoulders' | 'face' | 'mouth' | 'hands' | 'prop' | 'action'
export type CharacterPanelCondition = 'always' | 'generate-when-no-observed-prop'

export type CharacterPanelSpec = {
    panelId: string
    kind: CharacterPanelKind
    title: string
    target: string
    crop: CharacterPanelCrop
    dependsOn: string[]
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
    semanticRetryLimit: 1
}

export const CHARACTER_SHEET_BASE_OPERATION_COUNT = 26
export const CHARACTER_SHEET_MAX_OPERATION_COUNT = 27
export const CHARACTER_SHEET_MAX_PROVIDER_OPERATIONS = 54

const bodyPanels: CharacterPanelSpec[] = [
    ['body-front', 'Front', 'front view', []],
    ['body-three-quarter-front-left', 'Three-quarter front', 'three-quarter front-left view', ['body-front']],
    ['body-profile-left', 'Profile', 'left profile view', ['body-three-quarter-front-left']],
    ['body-three-quarter-back-left', 'Three-quarter back', 'three-quarter back-left view', ['body-profile-left']],
    ['body-back', 'Back', 'back view', ['body-three-quarter-back-left']],
].map(([panelId, title, target, dependsOn]) => ({
    panelId: panelId as string,
    kind: 'body',
    title: title as string,
    target: target as string,
    crop: 'full-body',
    dependsOn: dependsOn as string[],
    required: true,
    condition: 'always',
    acceptanceDimensions: ['target-view', 'identity', 'body-proportions', 'clothing', 'materials', 'framing'],
}))

const headTargets = [
    ['head-front', 'Front head', 'front head view', 'body-front', undefined],
    ['head-three-quarter-front-left', 'Three-quarter front head', 'three-quarter front-left head view', 'body-three-quarter-front-left', 'head-front'],
    ['head-profile-left', 'Profile head', 'left profile head view', 'body-profile-left', 'head-three-quarter-front-left'],
    ['head-three-quarter-back-left', 'Three-quarter back head', 'three-quarter back-left head view', 'body-three-quarter-back-left', 'head-profile-left'],
    ['head-back', 'Back head', 'back head view', 'body-back', 'head-three-quarter-back-left'],
] as const

const headPanels: CharacterPanelSpec[] = headTargets.map(([panelId, title, target, bodyDependency, headDependency]) => ({
    panelId,
    kind: 'head',
    title,
    target,
    crop: 'head-and-shoulders',
    dependsOn: headDependency ? [...new Set(['head-front', bodyDependency, headDependency])] : [],
    required: true,
    condition: 'always',
    acceptanceDimensions: ['target-view', 'facial-identity', 'hair', 'skin', 'distinctive-features', 'clothing', 'framing'],
}))

const expressionPanels: CharacterPanelSpec[] = [
    ['expression-smile', 'Smile', 'natural smile'],
    ['expression-anger', 'Anger', 'controlled angry expression'],
    ['expression-sadness', 'Sadness', 'subtle sad expression'],
    ['expression-surprise', 'Surprise', 'natural surprised expression'],
].map(([panelId, title, target]) => ({
    panelId,
    kind: 'expression',
    title,
    target,
    crop: 'face',
    dependsOn: ['head-front'],
    required: true,
    condition: 'always',
    acceptanceDimensions: ['expression', 'facial-identity', 'hair', 'skin', 'crop', 'no-text'],
}))

const mouthPanels: CharacterPanelSpec[] = [
    ['mouth-open', 'Open mouth', 'relaxed open mouth'],
    ['mouth-grin', 'Grin', 'broad tooth-visible grin'],
    ['mouth-pursed', 'Pursed lips', 'pursed lips'],
    ['mouth-shout', 'Shout', 'open shouting mouth'],
].map(([panelId, title, target]) => ({
    panelId,
    kind: 'mouth',
    title,
    target,
    crop: 'mouth',
    dependsOn: ['head-front'],
    required: true,
    condition: 'always',
    acceptanceDimensions: ['mouth-shape', 'facial-identity', 'skin', 'crop', 'no-text'],
}))

const handPanels: CharacterPanelSpec[] = [
    ['hand-left', 'Left hand', 'left hand close-up'],
    ['hand-right', 'Right hand', 'right hand close-up'],
].map(([panelId, title, target]) => ({
    panelId,
    kind: 'hand',
    title,
    target,
    crop: 'hands',
    dependsOn: ['body-front'],
    required: true,
    condition: 'always',
    acceptanceDimensions: ['anatomy', 'skin', 'accessories', 'materials', 'crop'],
}))

const actionPanels: CharacterPanelSpec[] = [
    ['action-walk', 'Walk', 'walking action pose'],
    ['action-run', 'Run', 'running action pose'],
    ['action-crouch', 'Crouch', 'balanced crouching pose'],
    ['action-jump', 'Jump', 'airborne jumping pose'],
    ['action-reach', 'Reach', 'reaching action pose'],
    ['action-hero', 'Hero pose', 'confident signature pose'],
].map(([panelId, title, target]) => ({
    panelId,
    kind: 'action',
    title,
    target,
    crop: 'action',
    dependsOn: ['body-front', 'head-front'],
    required: true,
    condition: 'always',
    acceptanceDimensions: ['action-pose', 'facial-identity', 'body-proportions', 'clothing', 'materials', 'framing'],
}))

const propPanel: CharacterPanelSpec = {
    panelId: 'prop-primary',
    kind: 'prop',
    title: 'Primary prop',
    target: 'isolated primary character prop',
    crop: 'prop',
    dependsOn: ['body-front'],
    required: false,
    condition: 'generate-when-no-observed-prop',
    acceptanceDimensions: ['prop-design', 'materials', 'scale', 'crop', 'no-text'],
}

export function buildCharacterPanelSpecs(): CharacterPanelSpec[] {
    return structuredClone([
        ...bodyPanels,
        ...headPanels,
        ...expressionPanels,
        ...mouthPanels,
        ...handPanels,
        propPanel,
        ...actionPanels,
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
        panels: buildCharacterPanelSpecs(),
        layoutId: 'character-sheet-3840x2560',
        semanticRetryLimit: 1,
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
    if (plan.semanticRetryLimit !== 1) throw new Error('CHARACTER_SHEET_PLAN_RETRY_LIMIT_INVALID')
    if (!Array.isArray(plan.panels) || plan.panels.length !== CHARACTER_SHEET_MAX_OPERATION_COUNT) {
        throw new Error('CHARACTER_SHEET_PLAN_PANEL_COUNT_INVALID')
    }
    const panelIds = new Set<string>()
    for (const panel of plan.panels) {
        if (!panel || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(panel.panelId)) throw new Error('CHARACTER_SHEET_PLAN_PANEL_ID_INVALID')
        if (panelIds.has(panel.panelId)) throw new Error(`CHARACTER_SHEET_PLAN_PANEL_ID_DUPLICATE:${panel.panelId}`)
        panelIds.add(panel.panelId)
    }
    for (const panel of plan.panels) {
        if (panel.dependsOn.some(dependency => !panelIds.has(dependency))) {
            throw new Error(`CHARACTER_SHEET_PLAN_DEPENDENCY_UNKNOWN:${panel.panelId}`)
        }
    }
    assertAcyclicPanels(plan.panels)
    if (plan.panels.filter(panel => panel.condition === 'always').length !== CHARACTER_SHEET_BASE_OPERATION_COUNT) {
        throw new Error('CHARACTER_SHEET_PLAN_BASE_OPERATION_COUNT_INVALID')
    }
    const maximumOperations = plan.panels.length * (plan.semanticRetryLimit + 1)
    if (maximumOperations > CHARACTER_SHEET_MAX_PROVIDER_OPERATIONS) throw new Error('CHARACTER_SHEET_PLAN_OPERATION_BOUND_EXCEEDED')
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
