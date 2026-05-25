'use strict'

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import type { StageTraceEvent } from '@lixpi/constants'

import {
    classifyStage,
    computeExtractionTimelineModel,
    formatStageDuration,
    type PhaseView,
} from './extractionTimelineModel.ts'

const tabSource = readFileSync(resolve(__dirname, 'extractionTab.ts'), 'utf-8')
const modelSource = readFileSync(resolve(__dirname, 'extractionTimelineModel.ts'), 'utf-8')
const markdownSource = readFileSync(resolve(__dirname, '../../utils/markdownStreamRenderer.ts'), 'utf-8')
const markdownStyles = readFileSync(resolve(__dirname, '../../sass/_markdown.scss'), 'utf-8')
const styles = readFileSync(resolve(__dirname, 'media-library-panel.scss'), 'utf-8')

const event = (over: Partial<StageTraceEvent> & { stage: string; status: StageTraceEvent['status'] }): StageTraceEvent => ({
    extractionRunId: 'run-1',
    startedAt: 0,
    finishedAt: 0,
    durationMs: 0,
    ...over,
})

const phaseByKey = (phases: PhaseView[], key: string): PhaseView => {
    const phase = phases.find((candidate) => candidate.key === key)
    if (!phase) throw new Error(`phase ${key} not found`)
    return phase
}

describe('computeExtractionTimelineModel', () => {
    it('always returns the four phases in pipeline order', () => {
        const phases = computeExtractionTimelineModel([], 'analyzing', true)
        expect(phases.map((phase) => phase.key)).toEqual(['analyze', 'extract', 'generate', 'save'])
        expect(phases.map((phase) => phase.label)).toEqual([
            'Analyze input', 'Extract feature', 'Generate samples', 'Save to library',
        ])
    })

    it('renders a live skeleton with the first phase active and the rest pending', () => {
        const phases = computeExtractionTimelineModel([], 'analyzing', true)
        expect(phaseByKey(phases, 'analyze').status).toBe('active')
        expect(phaseByKey(phases, 'extract').status).toBe('pending')
        expect(phaseByKey(phases, 'generate').status).toBe('pending')
        expect(phaseByKey(phases, 'save').status).toBe('pending')
        expect(phases.every((phase) => phase.substeps.length === 0)).toBe(true)
    })

    it('shows the router substep spinning while the analyze phase is active', () => {
        const phases = computeExtractionTimelineModel([
            event({ stage: 'router', status: 'running', startedAt: 1 }),
        ], 'routing', true)
        const analyze = phaseByKey(phases, 'analyze')
        expect(analyze.status).toBe('active')
        expect(analyze.substeps).toHaveLength(1)
        expect(analyze.substeps[0]).toMatchObject({ stage: 'router', status: 'running', label: 'Scene assessment & router' })
    })

    it('marks a phase done on its terminal ok and makes the next phase active', () => {
        const phases = computeExtractionTimelineModel([
            event({ stage: 'router', status: 'ok', startedAt: 1, finishedAt: 100, durationMs: 99 }),
        ], 'extracting_axes', true)
        const analyze = phaseByKey(phases, 'analyze')
        expect(analyze.status).toBe('done')
        expect(analyze.durationMs).toBe(99)
        expect(phaseByKey(phases, 'extract').status).toBe('active')
    })

    it('groups extractor, crops and synthesis under Extract, sorted by start time', () => {
        const phases = computeExtractionTimelineModel([
            event({ stage: 'router', status: 'ok', startedAt: 1, finishedAt: 5 }),
            event({ stage: 'extractor:lighting', status: 'running', startedAt: 12 }),
            event({ stage: 'extractor:palette', status: 'ok', startedAt: 10, finishedAt: 30 }),
            event({ stage: 'crops', status: 'ok', startedAt: 11, finishedAt: 20 }),
            event({ stage: 'synthesis', status: 'running', startedAt: 40 }),
            event({ stage: 'extractors', status: 'ok', startedAt: 10, finishedAt: 35, outputSummary: 'extracted=2 failed=0' }),
        ], 'synthesizing', true)
        const extract = phaseByKey(phases, 'extract')
        expect(extract.status).toBe('active')
        // Container event ('extractors') is not a substep row — it only sets phase meta.
        expect(extract.meta).toBe('extracted=2 failed=0')
        expect(extract.substeps.map((substep) => substep.stage)).toEqual([
            'extractor:palette', 'crops', 'extractor:lighting', 'synthesis',
        ])
        expect(extract.substeps[0].label).toBe('palette extractor')
    })

    it('counts samples, sets generate meta, and enriches sample labels with kind', () => {
        const phases = computeExtractionTimelineModel([
            event({ stage: 'router', status: 'ok' }),
            event({ stage: 'synthesis', status: 'ok' }),
            event({ stage: 'sample:0', status: 'ok', startedAt: 1, inputSummary: 'kind=palette-board subject=swatches' }),
            event({ stage: 'sample:1', status: 'ok', startedAt: 2, inputSummary: 'kind=applied-medium-probe subject=sphere' }),
            event({ stage: 'samples', status: 'ok', outputSummary: 'samples=2' }),
        ], 'saving', true)
        const generate = phaseByKey(phases, 'generate')
        expect(generate.status).toBe('done')
        expect(generate.substeps).toHaveLength(2)
        expect(generate.meta).toBe('samples=2')
        expect(generate.substeps[0].label).toBe('Sample 0 · palette-board')
        expect(generate.substeps[1].label).toBe('Sample 1 · applied-medium-probe')
    })

    it('attaches streamed model output to the matching substep', () => {
        const phases = computeExtractionTimelineModel([
            event({ stage: 'router', status: 'running', startedAt: 1 }),
        ], 'routing', true, { router: 'thinking about the scene…' })
        const analyze = phaseByKey(phases, 'analyze')
        expect(analyze.substeps[0].liveOutput).toBe('thinking about the scene…')
        // Unrelated stages get no live output.
        const extract = phaseByKey(phases, 'extract')
        expect(extract.substeps.every((substep) => substep.liveOutput === undefined)).toBe(true)
    })

    it('marks the failing phase as error and blocks downstream phases', () => {
        const phases = computeExtractionTimelineModel([
            event({ stage: 'router', status: 'ok' }),
            event({ stage: 'extractor:palette', status: 'error', errorMessage: 'palette VLM 500' }),
        ], 'failed', true)
        const extract = phaseByKey(phases, 'extract')
        expect(extract.status).toBe('error')
        expect(extract.substeps[0]).toMatchObject({ status: 'error', errorMessage: 'palette VLM 500' })
        expect(phaseByKey(phases, 'generate').status).toBe('pending')
        expect(phaseByKey(phases, 'save').status).toBe('pending')
    })

    it('dedupes a running marker against its terminal event by stage', () => {
        const phases = computeExtractionTimelineModel([
            event({ stage: 'router', status: 'running', startedAt: 1 }),
            event({ stage: 'router', status: 'ok', startedAt: 1, finishedAt: 100, durationMs: 99 }),
        ], 'extracting_axes', true)
        const analyze = phaseByKey(phases, 'analyze')
        expect(analyze.substeps).toHaveLength(1)
        expect(analyze.substeps[0].status).toBe('ok')
    })

    it('replays persisted completed runs with every phase done and no anticipatory spinner', () => {
        const phases = computeExtractionTimelineModel([
            event({ stage: 'router', status: 'ok' }),
            event({ stage: 'synthesis', status: 'ok' }),
            event({ stage: 'samples', status: 'ok' }),
            event({ stage: 'persist', status: 'ok' }),
        ], 'completed', false)
        expect(phases.every((phase) => phase.status === 'done')).toBe(true)
    })

    it('shows a completed run as fully done even when terminal events are missing', () => {
        const phases = computeExtractionTimelineModel([], 'completed', false)
        expect(phases.every((phase) => phase.status === 'done')).toBe(true)
    })
})

describe('classifyStage', () => {
    it('maps each backend stage onto the right phase', () => {
        expect(classifyStage('router').phaseKey).toBe('analyze')
        expect(classifyStage('extractor:palette')).toMatchObject({ phaseKey: 'extract', kind: 'substep' })
        expect(classifyStage('extractors').kind).toBe('container')
        expect(classifyStage('crops').phaseKey).toBe('extract')
        expect(classifyStage('synthesis').phaseKey).toBe('extract')
        expect(classifyStage('sample:3')).toMatchObject({ phaseKey: 'generate', kind: 'substep' })
        expect(classifyStage('samples').kind).toBe('container')
        expect(classifyStage('persist').phaseKey).toBe('save')
        // Unknown stages are surfaced, never dropped.
        expect(classifyStage('mystery-stage')).toMatchObject({ phaseKey: 'extract', kind: 'substep', label: 'mystery-stage' })
    })
})

describe('formatStageDuration', () => {
    it('formats milliseconds, seconds and minutes', () => {
        expect(formatStageDuration(500)).toBe('500ms')
        expect(formatStageDuration(1500)).toBe('1.5s')
        expect(formatStageDuration(65_000)).toBe('1.1min')
    })
})

describe('extraction tab DOM + style contract', () => {
    it('renders via pure CSS — no d3 in the timeline anymore', () => {
        expect(tabSource).not.toContain('d3-selection')
        expect(modelSource).not.toContain('d3-selection')
        expect(styles).toContain('@keyframes extraction-spin')
        expect(styles).toContain('.extraction-phase-timeline')
        expect(styles).toContain('.extraction-substep')
    })

    it('drops the old flat stage-timeline dump and the dead d3 guide', () => {
        expect(styles).not.toContain('.extraction-stage-timeline')
        expect(styles).not.toContain('.extraction-timeline-guide')
        expect(tabSource).not.toContain('buildStageTimeline')
        expect(tabSource).not.toContain('renderTimelineGuide')
    })

    it('keeps every trace field visible — nothing silenced', () => {
        expect(tabSource).toContain('extraction-substep-summary')
        expect(tabSource).toContain('extraction-substep-error-text')
        expect(tabSource).toContain('extraction-substep-preview')
        expect(tabSource).toContain('Prompt preview')
        // Streaming reasoning is still surfaced, and explicit detail is never dropped.
        expect(tabSource).toContain('Agent reasoning')
        expect(tabSource).toContain('appendReasoning')
    })

    it('streams model output live into a per-substep area', () => {
        expect(tabSource).toContain('extraction-substep-output')
        expect(tabSource).toContain('Model output')
        expect(tabSource).toContain('currentReasoningStage')
        expect(tabSource).toContain('stageReasoning')
        expect(styles).toContain('.extraction-substep-output')
    })

    it('renders prompt and model output through the unified markdown stream renderer', () => {
        expect(markdownSource).toContain("from '@lixpi/markdown-stream-parser'")
        expect(markdownSource).toContain('MarkdownStreamParser.getInstance')
        expect(markdownSource).toContain('parseToken')
        expect(markdownSource).toContain('subscribeToTokenParse')
        // Prompt preview uses static markdown; live output uses the streaming renderer.
        expect(tabSource).toContain('renderMarkdownStatic')
        expect(tabSource).toContain('MarkdownStreamRenderer')
        // Markdown element styles are global so the renderer is reusable anywhere.
        expect(markdownStyles).toContain('.lixpi-markdown')
        expect(markdownStyles).toContain('.lixpi-md-paragraph')
    })

    it('receives the feature card as structured content (not parsed from text)', () => {
        expect(tabSource).toContain('content.featureCard')
    })

    it('preserves the exported integration contract used by WorkspaceCanvas', () => {
        expect(tabSource).toContain('export async function submitExtractionRequest')
        expect(tabSource).toContain('export function renderExtractionTabBody')
        expect(tabSource).toContain('export function setPendingExtractionContext')
        expect(tabSource).toContain('export function getPendingExtractionContext')
    })
})
