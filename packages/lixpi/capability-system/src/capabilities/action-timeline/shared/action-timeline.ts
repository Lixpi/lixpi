'use strict'

import type { CapabilityJsonValue } from '@lixpi/constants'
import { Schema, type NodeSpec } from 'prosemirror-model'

import {
    CapabilityArtifactSharedRegistry,
    type CapabilityArtifactSharedDefinition,
} from '../../../shared/capability-artifact.ts'

export const ACTION_TIMELINE_MODULE_ID = 'action-timeline'
export const ACTION_TIMELINE_TOOL_ID = 'global.action-timeline'
export const ACTION_TIMELINE_ARTIFACT_TYPE_ID = 'action-timeline'
export const ACTION_TIMELINE_SCHEMA_VERSION = 'action-timeline-v1'
export const ACTION_TIMELINE_MIN_PRECISION_MS = 1

export type ActionTimelineInput = {
    prompt: string
    referenceAssetIds: string[]
    durationMs: number
    precisionMs: number
}

export type ActionTimelineDocumentAttrs = {
    schemaVersion: typeof ACTION_TIMELINE_SCHEMA_VERSION
    durationMs: number
    precisionMs: number
}

export type ActionTimelineSegmentAttrs = {
    startMs: number
    endMs: number
}

export type ActionTimelineTextRun = { text: string }
export type ActionTimelineReferenceRun = { assetId: string }
export type ActionTimelineRun = ActionTimelineTextRun | ActionTimelineReferenceRun

export type ActionTimelineReferenceMetadata = {
    mediaKind: 'image' | 'video' | 'audio' | 'document'
    displayName: string
}

export type ActionTimelineGeneratedSegment = {
    slotIndex: number
    runs: ActionTimelineRun[]
}

export type ActionTimelineGridSlot = {
    slotIndex: number
    startMs: number
    endMs: number
}

export type ActionTimelineTimingInput = {
    durationMs?: number
    precisionMs?: number
}

type ProseMirrorJsonNode = {
    type: string
    attrs?: Record<string, unknown>
    text?: string
    content?: ProseMirrorJsonNode[]
}

export function createActionTimelineGrid(durationMs: number, precisionMs: number): ActionTimelineGridSlot[] {
    assertTimelineTiming(durationMs, precisionMs)
    const segmentCount = Math.ceil(durationMs / precisionMs)
    return Array.from({ length: segmentCount }, (_, slotIndex) => ({
        slotIndex,
        startMs: slotIndex * precisionMs,
        endMs: Math.min((slotIndex + 1) * precisionMs, durationMs),
    }))
}

export function assertTimelineTiming(durationMs: number, precisionMs: number): void {
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
        throw new Error('ACTION_TIMELINE_DURATION_INVALID')
    }
    if (!Number.isSafeInteger(precisionMs) || precisionMs < ACTION_TIMELINE_MIN_PRECISION_MS) {
        throw new Error('ACTION_TIMELINE_PRECISION_INVALID')
    }
}

export function parseActionTimelineTiming(text: string): ActionTimelineTimingInput {
    const timingMatches = [...text.matchAll(
        /(\d+(?:\.\d{1,3})?)\s*(?:-\s*)?(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m)\b/giu,
    )]
    const explicitPrecisionMatch = timingMatches.find(match => hasPrecisionContext(text, match))
    const explicitDurationMatch = timingMatches.find(match => (
        match !== explicitPrecisionMatch && hasDurationContext(text, match)
    ))
    const durationMatch = explicitDurationMatch
        ?? (timingMatches.length >= 2
            ? timingMatches.find(match => match !== explicitPrecisionMatch)
            : undefined)
    const precisionMatch = explicitPrecisionMatch
        ?? (timingMatches.length >= 2
            ? timingMatches.find(match => match !== durationMatch)
            : undefined)
    const durationMs = durationMatch
        ? timingMatchToMilliseconds(durationMatch, 1)
        : undefined
    const precisionMs = precisionMatch
        ? timingMatchToMilliseconds(precisionMatch, ACTION_TIMELINE_MIN_PRECISION_MS)
        : undefined
    return {
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(precisionMs !== undefined ? { precisionMs } : {}),
    }
}

function hasPrecisionContext(text: string, match: RegExpMatchArray): boolean {
    const index = match.index ?? 0
    const before = text.slice(Math.max(0, index - 40), index).toLocaleLowerCase('en-US')
    const afterStart = index + match[0].length
    const after = text.slice(afterStart, afterStart + 36).toLocaleLowerCase('en-US')
    return /(?:precision|interval|cadence|every|each|per|(?:actions?|beats?|segments?)\s*(?:of|every|lasting)?|(?:each|per)\s+(?:action|beat|segment))\s*(?:is|of|:|=)?\s*$/u.test(before)
        || /^\s*(?:precision|intervals?|cadence|details?|actions?(?!\s+timeline)|beats?|segments?|per\s+(?:action|beat|segment)|each\s+(?:action|beat|segment))\b/u.test(after)
}

function hasDurationContext(text: string, match: RegExpMatchArray): boolean {
    const index = match.index ?? 0
    const before = text.slice(Math.max(0, index - 32), index).toLocaleLowerCase('en-US')
    const afterStart = index + match[0].length
    const after = text.slice(afterStart, afterStart + 36).toLocaleLowerCase('en-US')
    return /(?:duration|total|length|runtime|for|over|lasting)\s*(?:is|of|:|=)?\s*$/u.test(before)
        || /^\s*(?:duration|total|overall|long|runtime|action\s+timeline|timeline|sequence|shot\s+plan|shot|scene|video|clip)\b/u.test(after)
}

export function secondsTextToMilliseconds(raw: string, minimumMs: number): number | undefined {
    return timeTextToMilliseconds(raw, 'seconds', minimumMs)
}

function timingMatchToMilliseconds(match: RegExpMatchArray, minimumMs: number): number | undefined {
    if (!match[1] || !match[2]) return undefined
    return timeTextToMilliseconds(match[1], match[2], minimumMs)
}

function timeTextToMilliseconds(raw: string, rawUnit: string, minimumMs: number): number | undefined {
    const normalized = raw.trim()
    if (!/^\d+(?:\.\d{1,3})?$/u.test(normalized)) return undefined
    const [whole, fraction = ''] = normalized.split('.')
    const fractionScale = 10 ** fraction.length
    const unitCount = (Number(whole) * fractionScale) + Number(fraction || '0')
    const normalizedUnit = rawUnit.toLocaleLowerCase('en-US')
    const unitMilliseconds = normalizedUnit === 'ms'
        || normalizedUnit.startsWith('msec')
        || normalizedUnit.startsWith('millisecond')
        ? 1
        : normalizedUnit === 'm'
            || normalizedUnit.startsWith('min')
            ? 60000
            : 1000
    const scaledMilliseconds = unitCount * unitMilliseconds
    if (!Number.isSafeInteger(scaledMilliseconds) || scaledMilliseconds % fractionScale !== 0) return undefined
    const milliseconds = scaledMilliseconds / fractionScale
    return Number.isSafeInteger(milliseconds) && milliseconds >= minimumMs
        ? milliseconds
        : undefined
}

export function isActionTimelineCreationIntent(prompt: string): boolean {
    return /\b(?:action\s+timeline|timed\s+(?:action|shot)\s+plan|shot\s+plan|storyboard\s+timeline)\b/iu.test(prompt)
        || /\b(?:split|break|cut|plan)\b(?:\s+\S+){0,8}\b(?:into|as)\b(?:\s+\S+){0,4}\b(?:beats?|shots?|segments?)\b/iu.test(prompt)
}

export function assertGeneratedSegments(
    segments: readonly ActionTimelineGeneratedSegment[],
    grid: readonly ActionTimelineGridSlot[],
    authorizedReferenceAssetIds: ReadonlySet<string>,
): void {
    if (segments.length !== grid.length) throw new Error('ACTION_TIMELINE_SEGMENT_COUNT_INVALID')
    const seenSlots = new Set<number>()
    for (const segment of segments) {
        if (!Number.isSafeInteger(segment.slotIndex)
            || segment.slotIndex < 0
            || segment.slotIndex >= grid.length
            || seenSlots.has(segment.slotIndex)) {
            throw new Error(`ACTION_TIMELINE_SLOT_INVALID:${segment.slotIndex}`)
        }
        seenSlots.add(segment.slotIndex)
        assertRuns(segment.runs, authorizedReferenceAssetIds)
    }
}

export function assertActionTimelineRuns(
    segments: readonly ActionTimelineGeneratedSegment[],
    authorizedReferenceAssetIds: ReadonlySet<string>,
): void {
    for (const segment of segments) assertRuns(segment.runs, authorizedReferenceAssetIds)
}

export function buildActionTimelineDocument(
    input: Pick<ActionTimelineInput, 'durationMs' | 'precisionMs'>,
    segments: readonly ActionTimelineGeneratedSegment[],
    referenceMetadata: ReadonlyMap<string, ActionTimelineReferenceMetadata> = new Map(),
): ProseMirrorJsonNode {
    const grid = createActionTimelineGrid(input.durationMs, input.precisionMs)
    if (segments.length !== grid.length) throw new Error('ACTION_TIMELINE_SEGMENT_COUNT_INVALID')
    const segmentsBySlot = new Map(segments.map(segment => [segment.slotIndex, segment]))
    return {
        type: 'doc',
        attrs: {
            schemaVersion: ACTION_TIMELINE_SCHEMA_VERSION,
            durationMs: input.durationMs,
            precisionMs: input.precisionMs,
        },
        content: grid.map(slot => {
            const segment = segmentsBySlot.get(slot.slotIndex)
            if (!segment) throw new Error(`ACTION_TIMELINE_SLOT_MISSING:${slot.slotIndex}`)
            const inlineContent = segment.runs.flatMap(run => 'text' in run
                ? run.text ? [{ type: 'text', text: run.text }] : []
                : [{
                    type: 'prompt_reference',
                    attrs: {
                        referenceType: 'media',
                        assetId: run.assetId,
                        nodeId: '',
                        mediaKind: referenceMetadata.get(run.assetId)?.mediaKind ?? 'image',
                        moduleId: '',
                        capabilityId: '',
                        artifactTypeId: '',
                        displayName: referenceMetadata.get(run.assetId)?.displayName ?? run.assetId,
                    },
                }])
            return {
                type: 'actionTimelineSegment',
                attrs: { startMs: slot.startMs, endMs: slot.endMs },
                content: [{ type: 'paragraph', content: inlineContent }],
            }
        }),
    }
}

export function createActionTimelineDocumentSchema(): Schema {
    const promptReferenceSpec: NodeSpec = {
        inline: true,
        atom: true,
        selectable: false,
        group: 'inline',
        attrs: {
            referenceType: { default: 'media' },
            assetId: { default: '' },
            nodeId: { default: '' },
            mediaKind: { default: '' },
            moduleId: { default: '' },
            capabilityId: { default: '' },
            artifactTypeId: { default: '' },
            displayName: { default: '' },
        },
        parseDOM: [{
            tag: 'span[data-prompt-reference-type]',
            getAttrs: (dom: HTMLElement) => ({
                referenceType: dom.getAttribute('data-prompt-reference-type') ?? 'media',
                assetId: dom.getAttribute('data-asset-id') ?? '',
                nodeId: dom.getAttribute('data-node-id') ?? '',
                mediaKind: dom.getAttribute('data-media-kind') ?? '',
                moduleId: dom.getAttribute('data-module-id') ?? '',
                capabilityId: dom.getAttribute('data-capability-id') ?? '',
                artifactTypeId: dom.getAttribute('data-artifact-type-id') ?? '',
                displayName: dom.getAttribute('data-prompt-reference-display-name') ?? '',
            }),
        }],
        toDOM: node => ['span', {
            'data-prompt-reference-type': node.attrs.referenceType,
            'data-asset-id': node.attrs.assetId,
            'data-node-id': node.attrs.nodeId,
            'data-media-kind': node.attrs.mediaKind,
            'data-module-id': node.attrs.moduleId,
            'data-capability-id': node.attrs.capabilityId,
            'data-artifact-type-id': node.attrs.artifactTypeId,
            'data-prompt-reference-display-name': node.attrs.displayName,
            class: 'prompt-reference-chip prompt-reference-chip-media',
        }, node.attrs.displayName || node.attrs.assetId],
    }
    return new Schema({
        nodes: {
            doc: {
                content: 'actionTimelineSegment+',
                attrs: {
                    schemaVersion: { default: ACTION_TIMELINE_SCHEMA_VERSION },
                    durationMs: { default: 0 },
                    precisionMs: { default: 0 },
                },
            },
            actionTimelineSegment: {
                group: 'block',
                content: 'paragraph+',
                defining: true,
                isolating: true,
                attrs: {
                    startMs: { default: 0 },
                    endMs: { default: 0 },
                },
                parseDOM: [{
                    tag: 'section[data-action-timeline-segment]',
                    getAttrs: (dom: HTMLElement) => ({
                        startMs: Number(dom.getAttribute('data-start-ms')),
                        endMs: Number(dom.getAttribute('data-end-ms')),
                    }),
                }],
                toDOM: node => ['section', {
                    'data-action-timeline-segment': '',
                    'data-start-ms': node.attrs.startMs,
                    'data-end-ms': node.attrs.endMs,
                    class: 'action-timeline-segment',
                }, 0],
            },
            paragraph: {
                content: 'inline*',
                group: 'block',
                parseDOM: [{ tag: 'p' }],
                toDOM: () => ['p', 0],
            },
            prompt_reference: promptReferenceSpec,
            text: { group: 'inline' },
        },
    })
}

export const actionTimelineArtifactDefinition: CapabilityArtifactSharedDefinition = {
    artifactTypeId: ACTION_TIMELINE_ARTIFACT_TYPE_ID,
    displayName: 'Action Timeline',
    schemaVersion: ACTION_TIMELINE_SCHEMA_VERSION,
    allowedEmbeddedReferenceTypes: ['media'],
    createDocumentSchema: createActionTimelineDocumentSchema,
    assertInitialDocument: assertActionTimelineDocument,
    assertEditableMutation: assertActionTimelineEditableMutation,
    collectReferencedAssetIds: collectActionTimelineReferencedAssetIds,
    serializeForModel: serializeActionTimelineForModel,
    buildCatalogMetadata: buildActionTimelineCatalogMetadata,
}

export function registerActionTimelineSharedDefinition(registry: CapabilityArtifactSharedRegistry): void {
    registry.register(actionTimelineArtifactDefinition)
}

export function assertActionTimelineDocument(input: object): void {
    const doc = asNode(input, 'doc')
    const attrs = doc.attrs ?? {}
    if (attrs.schemaVersion !== ACTION_TIMELINE_SCHEMA_VERSION) {
        throw new Error('ACTION_TIMELINE_SCHEMA_VERSION_INVALID')
    }
    const durationMs = readInteger(attrs.durationMs, 'ACTION_TIMELINE_DURATION_INVALID')
    const precisionMs = readInteger(attrs.precisionMs, 'ACTION_TIMELINE_PRECISION_INVALID')
    const grid = createActionTimelineGrid(durationMs, precisionMs)
    const segments = doc.content ?? []
    if (segments.length !== grid.length) throw new Error('ACTION_TIMELINE_SEGMENT_COUNT_INVALID')
    for (const [index, segmentInput] of segments.entries()) {
        const segment = asNode(segmentInput, 'actionTimelineSegment')
        const slot = grid[index]!
        if (segment.attrs?.startMs !== slot.startMs || segment.attrs?.endMs !== slot.endMs) {
            throw new Error(`ACTION_TIMELINE_BOUNDARY_INVALID:${index}`)
        }
        if (!segment.content?.length || segment.content.some(child => child.type !== 'paragraph')) {
            throw new Error(`ACTION_TIMELINE_CONTENT_INVALID:${index}`)
        }
        walkNodes(segment, node => {
            if (node.type !== 'prompt_reference') return
            if (node.attrs?.referenceType !== 'media' || !readNonEmptyString(node.attrs.assetId)) {
                throw new Error(`ACTION_TIMELINE_REFERENCE_INVALID:${index}`)
            }
        })
    }
    createActionTimelineDocumentSchema().nodeFromJSON(input).check()
}

export function assertActionTimelineEditableMutation(previousInput: object, proposedInput: object): void {
    assertActionTimelineDocument(previousInput)
    const previous = asNode(previousInput, 'doc')
    const proposed = asNode(proposedInput, 'doc')
    if (!sameTimingAttrs(previous.attrs, proposed.attrs)) throw new Error('ACTION_TIMELINE_TIMING_MUTATION_FORBIDDEN')
    const previousSegments = previous.content ?? []
    const proposedSegments = proposed.content ?? []
    if (previousSegments.length !== proposedSegments.length) {
        throw new Error('ACTION_TIMELINE_STRUCTURE_MUTATION_FORBIDDEN')
    }
    for (const [index, previousSegment] of previousSegments.entries()) {
        const proposedSegment = proposedSegments[index]
        if (!proposedSegment
            || previousSegment.attrs?.startMs !== proposedSegment.attrs?.startMs
            || previousSegment.attrs?.endMs !== proposedSegment.attrs?.endMs) {
            throw new Error(`ACTION_TIMELINE_BOUNDARY_MUTATION_FORBIDDEN:${index}`)
        }
    }
    assertActionTimelineDocument(proposedInput)
}

export function collectActionTimelineReferencedAssetIds(input: object): string[] {
    const doc = asNode(input, 'doc')
    const assetIds: string[] = []
    const seen = new Set<string>()
    walkNodes(doc, node => {
        if (node.type !== 'prompt_reference') return
        if (node.attrs?.referenceType !== 'media') throw new Error('ACTION_TIMELINE_NESTED_ARTIFACT_FORBIDDEN')
        const assetId = readNonEmptyString(node.attrs.assetId)
        if (!assetId || seen.has(assetId)) return
        seen.add(assetId)
        assetIds.push(assetId)
    })
    return assetIds
}

export function serializeActionTimelineForModel(
    input: object,
    labels: ReadonlyMap<string, string>,
): { text: string; referencedAssetIds: string[] } {
    assertActionTimelineDocument(input)
    const doc = asNode(input, 'doc')
    const referencedAssetIds = collectActionTimelineReferencedAssetIds(input)
    const sections = (doc.content ?? []).map(segment => {
        const startMs = readInteger(segment.attrs?.startMs, 'ACTION_TIMELINE_BOUNDARY_INVALID')
        const endMs = readInteger(segment.attrs?.endMs, 'ACTION_TIMELINE_BOUNDARY_INVALID')
        const text = collectInlineText(segment, labels)
        return `${formatTimelineTime(startMs)} - ${formatTimelineTime(endMs)}\n${text}`
    })
    return { text: sections.join('\n\n'), referencedAssetIds }
}

export function buildActionTimelineCatalogMetadata(input: object): Record<string, CapabilityJsonValue> {
    assertActionTimelineDocument(input)
    const doc = asNode(input, 'doc')
    return {
        durationMs: readInteger(doc.attrs?.durationMs, 'ACTION_TIMELINE_DURATION_INVALID'),
        precisionMs: readInteger(doc.attrs?.precisionMs, 'ACTION_TIMELINE_PRECISION_INVALID'),
        segmentCount: doc.content?.length ?? 0,
        referencedAssetIds: collectActionTimelineReferencedAssetIds(input),
    }
}

export function formatTimelineTime(milliseconds: number): string {
    const totalSeconds = milliseconds / 1000
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds - minutes * 60
    const formattedSeconds = Number.isInteger(seconds)
        ? String(seconds).padStart(2, '0')
        : seconds.toFixed(3).replace(/0+$/, '').padStart(2, '0')
    return `${minutes}:${formattedSeconds}`
}

function assertRuns(runs: readonly ActionTimelineRun[], authorizedReferenceAssetIds: ReadonlySet<string>): void {
    if (!Array.isArray(runs) || runs.length === 0) throw new Error('ACTION_TIMELINE_RUNS_INVALID')
    let hasContent = false
    for (const run of runs) {
        if ('text' in run) {
            if (typeof run.text !== 'string') throw new Error('ACTION_TIMELINE_TEXT_RUN_INVALID')
            hasContent ||= run.text.trim().length > 0
            continue
        }
        if (!readNonEmptyString(run.assetId) || !authorizedReferenceAssetIds.has(run.assetId)) {
            throw new Error(`ACTION_TIMELINE_REFERENCE_NOT_AUTHORIZED:${String(run.assetId)}`)
        }
        hasContent = true
    }
    if (!hasContent) throw new Error('ACTION_TIMELINE_RUNS_EMPTY')
}

function asNode(input: object, expectedType: string): ProseMirrorJsonNode {
    const candidate = input as ProseMirrorJsonNode
    if (candidate.type !== expectedType) throw new Error(`ACTION_TIMELINE_NODE_TYPE_INVALID:${expectedType}`)
    return candidate
}

function walkNodes(node: ProseMirrorJsonNode, visitor: (node: ProseMirrorJsonNode) => void): void {
    visitor(node)
    for (const child of node.content ?? []) walkNodes(child, visitor)
}

function collectInlineText(node: ProseMirrorJsonNode, labels: ReadonlyMap<string, string>): string {
    const parts: string[] = []
    walkNodes(node, child => {
        if (child.type === 'text' && child.text) parts.push(child.text)
        if (child.type !== 'prompt_reference') return
        const assetId = readNonEmptyString(child.attrs?.assetId)
        if (!assetId) throw new Error('ACTION_TIMELINE_REFERENCE_INVALID')
        const label = labels.get(assetId)?.trim()
        if (!label) throw new Error(`ACTION_TIMELINE_REFERENCE_LABEL_MISSING:${assetId}`)
        parts.push(`@${label}`)
    })
    return parts.join('').trim()
}

function sameTimingAttrs(
    previous: Record<string, unknown> | undefined,
    proposed: Record<string, unknown> | undefined,
): boolean {
    return previous?.schemaVersion === proposed?.schemaVersion
        && previous?.durationMs === proposed?.durationMs
        && previous?.precisionMs === proposed?.precisionMs
}

function readInteger(value: unknown, errorCode: string): number {
    if (!Number.isSafeInteger(value)) throw new Error(errorCode)
    return value as number
}

function readNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
