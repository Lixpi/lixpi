'use strict'

import type { CapabilityJsonValue } from '@lixpi/constants'
import type { CapabilityMediaExecutionPlan } from '../../../shared/capability-media-execution-plan.ts'

export type CharacterPanelKind = 'body' | 'head' | 'expression' | 'prop' | 'action'
export type CharacterPanelCrop = 'full-body' | 'head-and-shoulders' | 'face' | 'prop' | 'action'
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
    semanticRetryLimit: 0
}

export const CHARACTER_SHEET_DEFAULT_OPERATION_COUNT = 3
export const CHARACTER_SHEET_BASE_OPERATION_COUNT = CHARACTER_SHEET_DEFAULT_OPERATION_COUNT
export const CHARACTER_SHEET_MAX_OPERATION_COUNT = 10
export const CHARACTER_SHEET_MAX_PROVIDER_OPERATIONS = CHARACTER_SHEET_MAX_OPERATION_COUNT

const frontFacePanel: CharacterPanelSpec = {
    panelId: 'head-front-detail',
    kind: 'head',
    title: 'Front face detail',
    target: 'straight-on front facial portrait with the face large, sharp, unobstructed, and clearly lit',
    crop: 'face',
    dependsOn: [],
    required: true,
    condition: 'always',
    acceptanceDimensions: ['facial-identity', 'hair', 'skin', 'distinctive-features', 'sharpness', 'framing'],
}

const frontBodyPanel: CharacterPanelSpec = {
    panelId: 'body-front',
    kind: 'body',
    title: 'Front body',
    target: 'neutral straight-on full-body front view from head to footwear',
    crop: 'full-body',
    dependsOn: [],
    required: true,
    condition: 'always',
    acceptanceDimensions: ['target-view', 'facial-identity', 'body-proportions', 'clothing', 'materials', 'framing'],
}

const threeQuarterBodyPanel: CharacterPanelSpec = {
    panelId: 'body-three-quarter-back',
    kind: 'body',
    title: 'Three-quarter body',
    target: 'full-body three-quarter back view that clearly shows silhouette, outfit construction, and footwear',
    crop: 'full-body',
    dependsOn: ['head-front-detail', 'body-front'],
    required: true,
    condition: 'always',
    acceptanceDimensions: ['target-view', 'identity', 'body-proportions', 'clothing', 'materials', 'framing'],
}

const optionalPanels: Readonly<Record<string, CharacterPanelSpec>> = {
    'body-profile': {
        panelId: 'body-profile',
        kind: 'body',
        title: 'Body profile',
        target: 'complete left profile full-body view from head to footwear',
        crop: 'full-body',
        dependsOn: ['head-front-detail', 'body-front'],
        required: true,
        condition: 'always',
        acceptanceDimensions: ['target-view', 'identity', 'body-proportions', 'clothing', 'materials', 'framing'],
    },
    'body-back': {
        panelId: 'body-back',
        kind: 'body',
        title: 'Back body',
        target: 'neutral straight-on full-body back view from head to footwear',
        crop: 'full-body',
        dependsOn: ['body-front'],
        required: true,
        condition: 'always',
        acceptanceDimensions: ['target-view', 'identity', 'body-proportions', 'clothing', 'materials', 'framing'],
    },
    'head-three-quarter': {
        panelId: 'head-three-quarter',
        kind: 'head',
        title: 'Three-quarter face',
        target: 'three-quarter facial portrait with the face large and clearly resolved',
        crop: 'face',
        dependsOn: ['head-front-detail'],
        required: true,
        condition: 'always',
        acceptanceDimensions: ['target-view', 'facial-identity', 'hair', 'skin', 'distinctive-features', 'sharpness'],
    },
    'expression-smile': {
        panelId: 'expression-smile',
        kind: 'expression',
        title: 'Smile',
        target: 'front facial close-up with a natural smile',
        crop: 'face',
        dependsOn: ['head-front-detail'],
        required: true,
        condition: 'always',
        acceptanceDimensions: ['expression', 'facial-identity', 'hair', 'skin', 'sharpness'],
    },
    'expression-serious': {
        panelId: 'expression-serious',
        kind: 'expression',
        title: 'Serious expression',
        target: 'front facial close-up with a focused serious expression',
        crop: 'face',
        dependsOn: ['head-front-detail'],
        required: true,
        condition: 'always',
        acceptanceDimensions: ['expression', 'facial-identity', 'hair', 'skin', 'sharpness'],
    },
    'expression-surprise': {
        panelId: 'expression-surprise',
        kind: 'expression',
        title: 'Surprise',
        target: 'front facial close-up with a natural surprised expression',
        crop: 'face',
        dependsOn: ['head-front-detail'],
        required: true,
        condition: 'always',
        acceptanceDimensions: ['expression', 'facial-identity', 'hair', 'skin', 'sharpness'],
    },
    'prop-primary': {
        panelId: 'prop-primary',
        kind: 'prop',
        title: 'Belongings',
        target: 'isolated primary belongings, equipment, accessories, or prop arranged clearly at character scale',
        crop: 'prop',
        dependsOn: ['body-front'],
        required: false,
        condition: 'generate-when-no-observed-prop',
        acceptanceDimensions: ['prop-design', 'materials', 'color', 'scale', 'framing'],
    },
    'action-signature': {
        panelId: 'action-signature',
        kind: 'action',
        title: 'Signature pose',
        target: 'complete character in a restrained signature action pose with the full silhouette visible',
        crop: 'action',
        dependsOn: ['head-front-detail', 'body-front'],
        required: true,
        condition: 'always',
        acceptanceDimensions: ['action-pose', 'facial-identity', 'body-proportions', 'clothing', 'materials', 'framing'],
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
    const expandsDefault = /\b(?:include|add|show|cover|detail|feature|focus on)\b(?:\s+\S+){0,4}\s+\b(?:belongings?|props?|equipment|gear|weapons?|accessories|expressions?|emotions?|profiles?|back views?|rear views?|face angles?|facial details?|action poses?|pose studies)\b/iu.test(prompt)
        || /\b(?:various|multiple|several|different)\s+(?:facial\s+)?(?:expressions|emotions)\b/iu.test(prompt)
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
    if (/\b(?:expressions|emotions)\b/u.test(normalized)) {
        add('expression-smile', 'expression-serious', 'expression-surprise')
    }
    if (/\bsmil(?:e|ing)\b/u.test(normalized)) add('expression-smile')
    if (/\b(?:serious (?:facial )?expression|focused expression)\b/u.test(normalized)) add('expression-serious')
    if (/\b(?:surprised expression|expression of surprise)\b/u.test(normalized)) add('expression-surprise')
    if (/\b(?:expression|emotion)\b/u.test(normalized) && !requested.some(panelId => panelId.startsWith('expression-'))) {
        add('expression-smile')
    }
    if (/\bprofile\b/u.test(normalized)) add('body-profile')
    if (/\b(?:back|rear)\b/u.test(normalized)) add('body-back')
    if (/\b(?:face angle|facial detail|portrait|close[- ]?up)\b/u.test(normalized)) add('head-three-quarter')
    if (/\b(?:action|pose|movement|dynamic)\b/u.test(normalized)) add('action-signature')

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
        'body-back',
        'head-three-quarter',
        'expression-smile',
        'expression-serious',
        'expression-surprise',
        'prop-primary',
        'action-signature',
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
        threeQuarterBodyPanel,
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
        if (panel.dependsOn.some(dependency => !panelIds.has(dependency))) {
            throw new Error(`CHARACTER_SHEET_PLAN_DEPENDENCY_UNKNOWN:${panel.panelId}`)
        }
    }
    assertAcyclicPanels(plan.panels)
    if (plan.panels.length > CHARACTER_SHEET_MAX_PROVIDER_OPERATIONS) {
        throw new Error('CHARACTER_SHEET_PLAN_OPERATION_BOUND_EXCEEDED')
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
