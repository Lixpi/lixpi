'use strict'

import type { CharacterFidelityObjectCoordinate } from '@lixpi/constants'
import type { CapabilityMediaStrategy } from '../../../../backend/capability-media-strategy.ts'
import { CapabilityMediaDagRunner } from '../../../../backend/capability-media-dag-runner.ts'
import {
    assertValidCharacterSheetRenderPlan,
    type CharacterPanelSpec,
    type CharacterSheetRenderPlan,
} from '../../shared/character-sheet-media-plan.ts'

import { resolveCharacterReferences } from './reference-resolver.ts'
import { analyzeCharacterEvidence, type CharacterEvidenceAnalyzerPort } from './evidence-analyzer.ts'
import type { CharacterEvidenceProfile } from './character-evidence.ts'
import { buildCharacterReferencePack } from './reference-pack.ts'
import { buildCharacterPanelPrompt, renderCharacterPanel } from './panel-renderer.ts'
import {
    assessCharacterPanel,
    type CharacterPanelAssessment,
    type CharacterPanelVlmAssessorPort,
} from './panel-assessor.ts'
import { composeCharacterSheet } from './character-sheet-compositor.ts'
import {
    CHARACTER_SHEET_TRACE_SCHEMA_VERSION,
    type CharacterPanelTrace,
    type CharacterSheetTrace,
} from './character-sheet-trace.ts'
import { createCharacterVlmPorts } from './character-vlm.ts'
import type { CharacterCreatorRuntimePorts } from './runtime-ports.ts'

export type CharacterSheetStrategyDeps = CharacterCreatorRuntimePorts & {
    evidenceAnalyzer?: CharacterEvidenceAnalyzerPort
    panelAssessor?: CharacterPanelVlmAssessorPort
    providerConcurrency?: number
    compositor?: typeof composeCharacterSheet
}

type RenderedPanel = {
    bytes: Buffer
    coordinate?: CharacterFidelityObjectCoordinate
    providerOperationId?: string
    includedReferenceRoles: string[]
    omittedReferenceRoles: string[]
}

export class CharacterSheetStrategy implements CapabilityMediaStrategy {
    readonly kind = 'character-sheet' as const

    constructor(private readonly deps: CharacterSheetStrategyDeps) {}

    async execute(
        state: Parameters<CapabilityMediaStrategy['execute']>[0],
        planValue: Parameters<CapabilityMediaStrategy['execute']>[1],
        options: Parameters<CapabilityMediaStrategy['execute']>[2],
    ) {
        assertValidCharacterSheetRenderPlan(planValue)
        const plan: CharacterSheetRenderPlan = planValue
        const modelCapabilities = state.imageModel.meta.imageReferenceCapabilities
        if (!modelCapabilities) throw new Error('IMAGE_REFERENCE_CAPABILITIES_REQUIRED')
        if (!modelCapabilities.conditioningModes.includes('identity')
            || modelCapabilities.maxIdentityReferenceImages === 0) {
            throw new Error('CHARACTER_CREATOR_IDENTITY_CONDITIONING_UNSUPPORTED')
        }
        const vlmPorts = createCharacterVlmPorts({
            provider: state.reasoningModel.provider,
            modelVersion: state.reasoningModel.modelVersion,
            inferenceCapabilities: state.reasoningModel.inferenceCapabilities,
            maxOutputTokensCeiling: state.reasoningModel.maxCompletionSize,
            vlm: this.deps.structuredVlm,
        })
        const store = this.deps.transientMedia.create(state)
        try {
            await options.reportProgress?.({
                phase: 'preparing',
                completedSteps: 0,
                totalSteps: plan.panels.length,
                message: `Preparing source evidence for ${plan.panels.length} shots.`,
            })
            const sources = await resolveCharacterReferences({
                assetIds: plan.sourceAssetIds,
                organizationId: state.organizationId,
                workspaceId: state.workspaceId,
                userId: state.userId,
                assets: this.deps.referenceAssets,
            })
            let evidence: CharacterEvidenceProfile
            let evidenceAnalysisWarning: string | undefined
            try {
                evidence = await analyzeCharacterEvidence({
                    sources,
                    userPrompt: plan.userPrompt,
                    analyzer: this.deps.evidenceAnalyzer ?? vlmPorts.evidenceAnalyzer,
                    signal: options.signal,
                })
            } catch (error) {
                if (options.signal?.aborted) throw error
                evidenceAnalysisWarning = formatRuntimeWarning('Source evidence analysis was unavailable', error)
                evidence = {
                    medium: 'unknown',
                    facts: [],
                    palette: [],
                    costumeNotes: [],
                    materialNotes: [],
                    distinguishingDetailNotes: [],
                    sourceCoverage: sources.map((source): CharacterEvidenceProfile['sourceCoverage'][number] => ({
                        sourceAssetId: source.assetId,
                        angles: ['unspecified'],
                        regions: ['face', 'body', 'outfit'],
                    })),
                    conflicts: [],
                }
                await options.reportProgress?.({
                    phase: 'preparing',
                    completedSteps: 0,
                    totalSteps: plan.panels.length,
                    message: 'Source analysis was unavailable; continuing once with the direct references.',
                })
            }
            const referencePack = await buildCharacterReferencePack({
                sources,
                evidence,
                capabilities: modelCapabilities,
                store,
            })
            const renderedPanels = new Map<string, RenderedPanel>()
            const renderFailures = new Map<string, string>()
            const assessments = new Map<string, CharacterPanelAssessment>()
            const observedProp = referencePack.entries.find(entry => entry.role === 'prop-crop')
            const observedPropSpec = observedProp
                ? plan.panels.find(panel => panel.panelId === 'prop-primary')
                : undefined
            if (observedProp && observedPropSpec) {
                renderedPanels.set(observedPropSpec.panelId, {
                    bytes: decodeDataUrl(observedProp.url),
                    includedReferenceRoles: ['prop-crop'],
                    omittedReferenceRoles: [],
                })
            }
            const renderPanels = plan.panels
                .filter(panel => panel.panelId !== observedPropSpec?.panelId)
                .map(panel => ({ ...panel, nodeId: panel.panelId }))
            const fidelity = sources.length > 0 ? this.deps.fidelity : undefined
            let completedRenders = renderedPanels.size
            let providerOperationAttempts = 0
            let partialIndex = 0
            let progressivePublishChain = Promise.resolve()
            const publishProgressiveSheet = async (): Promise<void> => {
                if (!options.publishImagePartial || renderedPanels.size === 0) return
                const snapshot = [...renderedPanels.entries()].map(([panelId, rendered]) => ({
                    panelId,
                    bytes: rendered.bytes,
                }))
                const assessmentSnapshot = new Map(assessments)
                const nextPartialIndex = ++partialIndex
                progressivePublishChain = progressivePublishChain.then(async () => {
                    try {
                        const composition = await (this.deps.compositor ?? composeCharacterSheet)({
                            panelSpecs: plan.panels,
                            panels: snapshot,
                            evidence,
                            assessments: assessmentSnapshot,
                            unavailablePanelIds: new Set(renderFailures.keys()),
                            ...(evidenceAnalysisWarning ? { additionalIssues: [evidenceAnalysisWarning] } : {}),
                            final: false,
                        })
                        await options.publishImagePartial?.(
                            composition.bytes.toString('base64'),
                            nextPartialIndex,
                        )
                    } catch {
                        // Progress presentation must never invalidate rendered work.
                    }
                })
                await progressivePublishChain
            }

            await publishProgressiveSheet()
            const runner = new CapabilityMediaDagRunner(renderPanels, this.deps.providerConcurrency ?? 3, 0)
            await runner.run({
                signal: options.signal,
                allowTerminalFailure: () => true,
                execute: async panel => {
                    try {
                        const anchors = panel.dependsOn.flatMap(panelId => {
                            const rendered = renderedPanels.get(panelId)
                            return rendered ? [{ panelId, bytes: rendered.bytes }] : []
                        })
                        const evidenceSummary = evidence.facts
                            .filter(fact => fact.visibility === 'observed')
                            .slice(0, 16)
                            .map(fact => `${fact.feature}: ${fact.value}`)
                            .join('; ')
                        const prompt = buildCharacterPanelPrompt({
                            panel,
                            userPrompt: plan.userPrompt,
                            evidenceSummary,
                        })
                        providerOperationAttempts += 1
                        const rendered = await renderCharacterPanel({
                            imageGeneration: this.deps.imageGeneration,
                            context: state,
                            plan,
                            panel,
                            attempt: 1,
                            prompt,
                            references: referencePack.entries,
                            anchors,
                            signal: options.signal,
                        })
                        let coordinate: CharacterFidelityObjectCoordinate | undefined
                        try {
                            const stored = await store.putWithCoordinate({
                                mediaKind: 'image',
                                slot: `candidate-${panel.panelId}`,
                                bytes: rendered.bytes,
                                mimeType: 'image/png',
                                revision: 1,
                            })
                            coordinate = stored.coordinate
                        } catch (error) {
                            if (options.signal?.aborted) throw error
                        }
                        renderedPanels.set(panel.panelId, {
                            ...rendered,
                            ...(coordinate ? { coordinate } : {}),
                        })
                        completedRenders += 1
                        await options.reportProgress?.({
                            phase: 'rendering',
                            completedSteps: completedRenders,
                            totalSteps: plan.panels.length,
                            message: `Rendered ${completedRenders} of ${plan.panels.length} shots; the sheet preview is updating.`,
                        })
                        await publishProgressiveSheet()
                        return rendered
                    } catch (error) {
                        if (options.signal?.aborted) throw error
                        renderFailures.set(panel.panelId, (error as Error).message || 'Panel generation failed')
                        completedRenders += 1
                        await options.reportProgress?.({
                            phase: 'rendering',
                            completedSteps: completedRenders,
                            totalSteps: plan.panels.length,
                            message: `${panel.title} was unavailable; continuing with the rendered shots.`,
                        })
                        await publishProgressiveSheet()
                        throw error
                    }
                },
            })
            if (renderedPanels.size === 0) throw new Error('CHARACTER_SHEET_NO_RENDERED_PANELS')

            const assessablePanels = plan.panels.filter(panel => {
                const rendered = renderedPanels.get(panel.panelId)
                return rendered?.coordinate && panel.panelId !== observedPropSpec?.panelId
            })
            await options.reportProgress?.({
                phase: 'assessing',
                completedSteps: 0,
                totalSteps: assessablePanels.length,
                message: `Comparing ${assessablePanels.length} generated shots with the source evidence.`,
            })
            let completedAssessments = 0
            await runInBatches(assessablePanels, this.deps.providerConcurrency ?? 3, options.signal, async panel => {
                try {
                    const rendered = renderedPanels.get(panel.panelId)!
                    const anchors = panel.dependsOn.flatMap(panelId => {
                        const anchor = renderedPanels.get(panelId)
                        return anchor ? [anchor.bytes] : []
                    })
                    const assessment = await assessCharacterPanel({
                        panel,
                        attemptId: `${plan.capabilityRunId}:${panel.panelId}:1`,
                        candidateBytes: rendered.bytes,
                        candidateCoordinate: rendered.coordinate!,
                        sourceCoordinates: referencePack.entries
                            .filter(entry => entry.role === 'original-source' || entry.role === 'face-crop')
                            .slice(0, 5)
                            .map(entry => entry.coordinate),
                        sourceDataUrls: referencePack.entries
                            .filter(entry => entry.role === 'original-source'
                                || entry.role === 'face-crop'
                                || entry.role === 'body-outfit-crop')
                            .map(entry => entry.url),
                        evidence,
                        anchorBytes: anchors,
                        vlm: this.deps.panelAssessor ?? vlmPorts.panelAssessor,
                        fidelity,
                        signal: options.signal,
                    })
                    assessments.set(panel.panelId, assessment)
                } finally {
                    if (!options.signal?.aborted) {
                        completedAssessments += 1
                        await options.reportProgress?.({
                            phase: 'assessing',
                            completedSteps: completedAssessments,
                            totalSteps: assessablePanels.length,
                            message: `Completed ${completedAssessments} of ${assessablePanels.length} shot comparisons.`,
                        })
                        await publishProgressiveSheet()
                    }
                }
            })

            await options.reportProgress?.({
                phase: 'composing',
                completedSteps: renderedPanels.size,
                totalSteps: plan.panels.length,
                message: 'Composing the final sheet and surfacing comparison issues.',
            })
            const composition = await (this.deps.compositor ?? composeCharacterSheet)({
                panelSpecs: plan.panels,
                panels: [...renderedPanels.entries()].map(([panelId, rendered]) => ({
                    panelId,
                    bytes: rendered.bytes,
                })),
                evidence,
                assessments,
                unavailablePanelIds: new Set(renderFailures.keys()),
                ...(evidenceAnalysisWarning ? { additionalIssues: [evidenceAnalysisWarning] } : {}),
                final: true,
            })
            await progressivePublishChain
            const panelTraces = plan.panels.map(panel => buildPanelTrace({
                panel,
                rendered: renderedPanels.get(panel.panelId),
                assessment: assessments.get(panel.panelId),
                failure: renderFailures.get(panel.panelId),
                observed: panel.panelId === observedPropSpec?.panelId,
            }))
            const needsReview = panelTraces.filter(panel => panel.status !== 'completed')
            const reviewIssueCount = needsReview.length + (evidenceAnalysisWarning ? 1 : 0)
            const trace: CharacterSheetTrace = {
                traceVersion: 'capability-media-review-v1',
                schemaVersion: CHARACTER_SHEET_TRACE_SCHEMA_VERSION,
                capabilityId: 'global.character-creator',
                capabilityRunId: plan.capabilityRunId,
                provider: state.imageModel.provider,
                modelVersion: state.imageModel.modelVersion,
                compositor: 'sharp-character-sheet-3840x2560-v2',
                summary: reviewIssueCount > 0
                    ? `${renderedPanels.size} of ${plan.panels.length} shots rendered; ${reviewIssueCount} execution or comparison issues need review.`
                    : `${plan.panels.length} shots rendered and passed the configured comparison thresholds.`,
                automaticRetries: 0,
                recommendation: reviewIssueCount > 0
                    ? 'Review the flagged shots. Keep this candidate or explicitly generate another variant; no retry was started automatically.'
                    : 'Keep this candidate or explicitly generate another variant.',
                steps: [
                    ...(evidenceAnalysisWarning ? [{
                        stepId: 'source-evidence',
                        title: 'Source evidence',
                        status: 'needs-review' as const,
                        issues: [evidenceAnalysisWarning],
                    }] : []),
                    ...panelTraces.map(panel => ({
                        stepId: panel.panelId,
                        title: panel.title,
                        status: panel.status,
                        ...(panel.attempts > 0 && !panel.failedDimensions.includes('comparison-unavailable')
                            ? { score: panel.score }
                            : {}),
                        issues: [...new Set([
                            ...panel.failedDimensions,
                            ...(panel.warning ? [panel.warning] : []),
                        ])],
                    })),
                ],
                panels: panelTraces,
                inferredFeatures: evidence.facts
                    .filter(fact => fact.visibility === 'inferred')
                    .map(fact => fact.feature),
                totalProviderOperations: providerOperationAttempts,
                compositionSha256: composition.sha256,
            }
            return {
                generatedImages: [composition.bytes.toString('base64')],
                imageUsage: {
                    generatedCount: trace.totalProviderOperations,
                    size: '3840x2560',
                    quality: 'high',
                },
                capabilityMediaTrace: trace,
            }
        } finally {
            await store.clear()
        }
    }
}

function buildPanelTrace(args: {
    panel: CharacterPanelSpec
    rendered?: RenderedPanel
    assessment?: CharacterPanelAssessment
    failure?: string
    observed: boolean
}): CharacterPanelTrace {
    if (!args.rendered) {
        return {
            panelId: args.panel.panelId,
            title: args.panel.title,
            attempts: 0,
            selectedAttempt: 0,
            score: 0,
            status: 'unavailable',
            failedDimensions: ['generation-unavailable'],
            warning: args.failure ?? 'Shot was unavailable.',
            vlmAssessor: 'not-assessed',
            providerOperationIds: [],
            includedReferenceRoles: [],
            omittedReferenceRoles: [],
        }
    }
    if (args.observed) {
        return {
            panelId: args.panel.panelId,
            title: args.panel.title,
            attempts: 0,
            selectedAttempt: 0,
            score: 1,
            status: 'completed',
            failedDimensions: [],
            vlmAssessor: 'deterministic-observed-prop',
            providerOperationIds: [],
            includedReferenceRoles: ['prop-crop'],
            omittedReferenceRoles: [],
        }
    }
    const comparisonUnavailable = !args.assessment || args.assessment.dimensions.length === 0
    const failedDimensions = args.assessment?.failedDimensions ?? ['comparison-unavailable']
    return {
        panelId: args.panel.panelId,
        title: args.panel.title,
        attempts: 1,
        selectedAttempt: 1,
        score: args.assessment?.score ?? 0,
        status: comparisonUnavailable || failedDimensions.length > 0 ? 'needs-review' : 'completed',
        failedDimensions: comparisonUnavailable ? ['comparison-unavailable'] : failedDimensions,
        ...(comparisonUnavailable ? { warning: 'Comparison was unavailable; the rendered shot was preserved.' } : {}),
        vlmAssessor: args.assessment?.vlmAssessor ?? 'assessment-unavailable',
        providerOperationIds: args.rendered.providerOperationId ? [args.rendered.providerOperationId] : [],
        includedReferenceRoles: args.rendered.includedReferenceRoles,
        omittedReferenceRoles: args.rendered.omittedReferenceRoles,
    }
}

async function runInBatches<Item>(
    items: readonly Item[],
    concurrency: number,
    signal: AbortSignal | undefined,
    execute: (item: Item) => Promise<void>,
): Promise<void> {
    for (let offset = 0; offset < items.length; offset += concurrency) {
        if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
        await Promise.allSettled(items.slice(offset, offset + concurrency).map(execute))
        if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    }
}

function decodeDataUrl(value: string): Buffer {
    const separator = value.indexOf(',')
    if (separator < 0) throw new Error('CHARACTER_REFERENCE_DATA_URL_INVALID')
    return Buffer.from(value.slice(separator + 1), 'base64')
}

function formatRuntimeWarning(prefix: string, error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error)
    const normalized = detail.replace(/\s+/gu, ' ').trim().slice(0, 240)
    return normalized ? `${prefix}: ${normalized}` : prefix
}
