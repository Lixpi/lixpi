'use strict'

import type { CapabilityMediaStrategy } from '../../../../backend/capability-media-strategy.ts'
import { CapabilityMediaDagRunner } from '../../../../backend/capability-media-dag-runner.ts'
import {
    assertValidCharacterSheetRenderPlan,
    type CharacterSheetRenderPlan,
} from '../../shared/character-sheet-media-plan.ts'

import { resolveCharacterReferences } from './reference-resolver.ts'
import { analyzeCharacterEvidence, type CharacterEvidenceAnalyzerPort } from './evidence-analyzer.ts'
import { buildCharacterReferencePack } from './reference-pack.ts'
import { buildCharacterPanelPrompt, renderCharacterPanel } from './panel-renderer.ts'
import { assessCharacterPanel, type CharacterPanelVlmAssessorPort } from './panel-assessor.ts'
import {
    buildCharacterPanelCorrectionPrompt,
    selectCharacterPanelCandidate,
    type CharacterPanelCandidate,
} from './panel-selection.ts'
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

export class CharacterSheetStrategy implements CapabilityMediaStrategy {
    readonly kind = 'character-sheet' as const

    constructor(private readonly deps: CharacterSheetStrategyDeps) {}

    async execute(state: Parameters<CapabilityMediaStrategy['execute']>[0], planValue: Parameters<CapabilityMediaStrategy['execute']>[1], options: Parameters<CapabilityMediaStrategy['execute']>[2]) {
        assertValidCharacterSheetRenderPlan(planValue)
        const plan: CharacterSheetRenderPlan = planValue
        const organizationId = state.organizationId
        const userId = state.userId
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
            const sources = await resolveCharacterReferences({
                assetIds: plan.sourceAssetIds,
                organizationId,
                workspaceId: state.workspaceId,
                userId,
                assets: this.deps.referenceAssets,
            })
            const evidence = await analyzeCharacterEvidence({
                sources,
                userPrompt: plan.userPrompt,
                analyzer: this.deps.evidenceAnalyzer ?? vlmPorts.evidenceAnalyzer,
                signal: options.signal,
            })
            const referencePack = await buildCharacterReferencePack({
                sources,
                evidence,
                capabilities: modelCapabilities,
                store,
            })
            const observedProp = referencePack.entries.find(entry => entry.role === 'prop-crop')
            const panels = plan.panels
                .filter(panel => panel.condition === 'always' || !observedProp)
                .map(panel => ({ ...panel, nodeId: panel.panelId }))
            const selections = new Map<string, ReturnType<typeof selectCharacterPanelCandidate>>()
            const traces = new Map<string, CharacterPanelTrace>()
            const fidelity = sources.length > 0 ? this.deps.fidelity : undefined
            const semanticProviderOperations = new Set<string>()
            const runner = new CapabilityMediaDagRunner(panels, this.deps.providerConcurrency ?? 3, 1)

        const dagResult = await runner.run({
            signal: options.signal,
            allowTerminalFailure: panel => !panel.required,
            execute: async panel => {
                const anchors = panel.dependsOn.flatMap(panelId => {
                    const selection = selections.get(panelId)
                    return selection ? [{ panelId, bytes: selection.bytes }] : []
                })
                const evidenceSummary = evidence.facts
                    .filter(fact => fact.visibility === 'observed')
                    .slice(0, 16)
                    .map(fact => `${fact.feature}: ${fact.value}`)
                    .join('; ')
                const basePrompt = buildCharacterPanelPrompt({
                    panel,
                    userPrompt: plan.userPrompt,
                    evidenceSummary,
                })
                const candidates: CharacterPanelCandidate[] = []
                const providerOperationIds: string[] = []
                let prompt = basePrompt
                const roleTrace = { included: [] as string[], omitted: [] as string[] }
                for (let attempt = 1; attempt <= plan.semanticRetryLimit + 1; attempt += 1) {
                    semanticProviderOperations.add(`${panel.panelId}:${attempt}`)
                    const rendered = await renderCharacterPanel({
                        imageGeneration: this.deps.imageGeneration,
                        context: state,
                        plan,
                        panel,
                        attempt,
                        prompt,
                        references: referencePack.entries,
                        anchors,
                        signal: options.signal,
                    })
                    roleTrace.included = rendered.includedReferenceRoles
                    roleTrace.omitted = rendered.omittedReferenceRoles
                    if (rendered.providerOperationId) providerOperationIds.push(rendered.providerOperationId)
                    const stored = await store.putWithCoordinate({
                        mediaKind: 'image',
                        slot: `candidate-${panel.panelId}`,
                        bytes: rendered.bytes,
                        mimeType: 'image/png',
                        revision: attempt,
                    })
                    const assessment = await assessCharacterPanel({
                        panel,
                        attemptId: `${plan.capabilityRunId}:${panel.panelId}:${attempt}`,
                        candidateBytes: rendered.bytes,
                        candidateCoordinate: stored.coordinate,
                        sourceCoordinates: referencePack.entries
                            .filter(entry => entry.role === 'original-source' || entry.role === 'face-crop')
                            .slice(0, 5)
                            .map(entry => entry.coordinate),
                        sourceDataUrls: referencePack.entries
                            .filter(entry => entry.role === 'original-source' || entry.role === 'face-crop' || entry.role === 'body-outfit-crop')
                            .map(entry => entry.url),
                        evidence,
                        anchorBytes: anchors.map(anchor => anchor.bytes),
                        vlm: this.deps.panelAssessor ?? vlmPorts.panelAssessor,
                        fidelity,
                        signal: options.signal,
                    })
                    candidates.push({ attempt, bytes: rendered.bytes, assessment })
                    if (assessment.failedDimensions.length === 0) break
                    prompt = buildCharacterPanelCorrectionPrompt({ basePrompt, assessment })
                }
                const selection = selectCharacterPanelCandidate(candidates)
                selections.set(panel.panelId, selection)
                traces.set(panel.panelId, {
                    panelId: panel.panelId,
                    attempts: candidates.length,
                    selectedAttempt: selection.attempt,
                    score: selection.assessment.score,
                    ...(selection.warning ? { warning: selection.warning } : {}),
                    vlmAssessor: selection.assessment.vlmAssessor,
                    providerOperationIds,
                    includedReferenceRoles: roleTrace.included,
                    omittedReferenceRoles: roleTrace.omitted,
                })
                return selection
            },
        })

        for (const failed of dagResult.events.filter(event => event.type === 'failed')) {
            if (traces.has(failed.nodeId)) continue
            traces.set(failed.nodeId, {
                panelId: failed.nodeId,
                attempts: 0,
                selectedAttempt: 0,
                score: 0,
                warning: 'Optional panel was unavailable and left blank.',
                vlmAssessor: 'not-assessed',
                providerOperationIds: [],
                includedReferenceRoles: [],
                omittedReferenceRoles: [],
            })
        }

        if (observedProp) {
            const base64 = observedProp.url.slice(observedProp.url.indexOf(',') + 1)
            selections.set('prop-primary', {
                attempt: 0,
                bytes: Buffer.from(base64, 'base64'),
                assessment: {
                    panelId: 'prop-primary',
                    attemptId: `${plan.capabilityRunId}:prop-observed`,
                    valid: true,
                    score: 1,
                    dimensions: [],
                    fidelityMetric: { available: false, unavailableReason: 'face-not-required' },
                    vlmAssessor: 'deterministic-observed-prop',
                    failedDimensions: [],
                },
            })
            traces.set('prop-primary', {
                panelId: 'prop-primary',
                attempts: 0,
                selectedAttempt: 0,
                score: 1,
                vlmAssessor: 'deterministic-observed-prop',
                providerOperationIds: [],
                includedReferenceRoles: ['prop-crop'],
                omittedReferenceRoles: [],
            })
        }
        const composition = await (this.deps.compositor ?? composeCharacterSheet)({
            panels: [...selections.entries()].map(([panelId, selection]) => ({ panelId, bytes: selection.bytes })),
            evidence,
        })
        const trace: CharacterSheetTrace = {
            schemaVersion: CHARACTER_SHEET_TRACE_SCHEMA_VERSION,
            capabilityRunId: plan.capabilityRunId,
            provider: state.imageModel.provider,
            modelVersion: state.imageModel.modelVersion,
            compositor: 'sharp-character-sheet-3840x2560-v1',
            panels: plan.panels.flatMap(panel => traces.get(panel.panelId) ?? []),
            inferredFeatures: evidence.facts.filter(fact => fact.visibility === 'inferred').map(fact => fact.feature),
            totalProviderOperations: semanticProviderOperations.size,
            compositionSha256: composition.sha256,
        }
        return {
            generatedImages: [composition.bytes.toString('base64')],
            imageUsage: { generatedCount: semanticProviderOperations.size, size: '3840x2560', quality: 'high' },
            capabilityMediaTrace: trace,
        }
        } finally {
            await store.clear()
        }
    }
}
