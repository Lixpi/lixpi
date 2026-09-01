import {
    type CharacterFidelityObjectCoordinate,
    type ExecutionTrace,
    type ExecutionTraceHandle,
    type ExecutionTraceModelCall,
    type MediaGenerationRunProgress,
    type OperationProgressItem,
} from '@lixpi/constants'
import {
    type CapabilityMediaStrategy,
} from '../../../../backend/capability-media-strategy.ts'
import { CapabilityMediaDagRunner } from '../../../../backend/capability-media-dag-runner.ts'
import {
    assertValidCharacterSheetRenderPlan,
    CHARACTER_BACK_ANCHOR_PANEL_ID,
    CHARACTER_IDENTITY_ANCHOR_PANEL_ID,
    CHARACTER_OUTFIT_ANCHOR_PANEL_ID,
    type CharacterPanelSpec,
    type CharacterPanelOutputBinding,
    type CharacterSheetRenderPlan,
} from '../../shared/character-sheet-media-plan.ts'

import {
    resolveCharacterReferences,
    type ResolvedCharacterReference,
} from './reference-resolver.ts'
import {
    analyzeCharacterEvidence,
    selectCharacterEvidenceFacts,
    type CharacterEvidenceAnalyzerPort,
} from './evidence-analyzer.ts'
import {
    type CharacterEvidenceProfile,
} from './character-evidence.ts'
import {
    buildCharacterReferencePack,
    type CharacterReferencePack,
} from './reference-pack.ts'
import {
    buildCharacterPanelPrompt,
    renderCharacterPanel,
    type CharacterPanelRenderResult,
} from './panel-renderer.ts'
import {
    assessCharacterPanel,
    getCharacterPanelStructuralFailures,
    type CharacterPanelAssessment,
    type CharacterPanelVlmAssessorPort,
} from './panel-assessor.ts'
import { selectCharacterPanelReferenceEntries } from './panel-reference-selection.ts'
import { loadCharacterPoseReference } from './pose-reference.ts'
import { composeCharacterSheet } from './character-sheet-compositor.ts'
import {
    CHARACTER_SHEET_TRACE_SCHEMA_VERSION,
    type CharacterPanelTrace,
    type CharacterSheetTrace,
} from './character-sheet-trace.ts'
import {
    createCharacterVlmPorts,
    describeCharacterPanelAssessmentFailure,
} from './character-vlm.ts'
import { selectCharacterPanelsForRegeneration } from './panel-regeneration.ts'
import {
    type CharacterCreatorRuntimePorts,
    type CharacterImageReference,
} from './runtime-ports.ts'

export type CharacterSheetStrategyDeps = CharacterCreatorRuntimePorts & {
    evidenceAnalyzer?: CharacterEvidenceAnalyzerPort
    panelAssessor?: CharacterPanelVlmAssessorPort
    providerConcurrency?: number
    compositor?: typeof composeCharacterSheet
}

type RenderedPanel = {
    bytes: Buffer
    reused?: boolean
    coordinate?: CharacterFidelityObjectCoordinate
    providerOperationId?: string
    resolvedImageSize?: string
    includedReferenceRoles: string[]
    omittedReferenceRoles: string[]
}

type CharacterRenderDagNode = CharacterPanelSpec & {
    nodeId: string
}

type CharacterProgressSnapshot = {
    phase: MediaGenerationRunProgress['phase']
    plan: CharacterSheetRenderPlan
    preparationStage: 'resolving-references' | 'analyzing-evidence' | 'building-reference-pack' | 'completed'
    preparationSourceCount?: number
    preparationEvidenceSummary?: string
    preparationReferenceSummary?: string
    renderedPanels: ReadonlyMap<string, RenderedPanel>
    renderFailures: ReadonlyMap<string, string>
    runningPanelIds: ReadonlySet<string>
    assessments: ReadonlyMap<string, CharacterPanelAssessment>
    assessmentFailures: ReadonlyMap<string, string>
    assessmentEligiblePanelIds: ReadonlySet<string>
    runningAssessmentPanelIds: ReadonlySet<string>
    observedPanelIds: ReadonlySet<string>
    compositionStage: 'pending' | 'assembling' | 'sealing' | 'completed'
    sourceWarning?: string
    // Durable per-item execution traces, keyed by progress item id. Every model
    // call the pipeline made — with its params and the references handed to it —
    // is recorded here as the run proceeds and sealed with the item. Status-only
    // callers that build a snapshot to ask a single question omit it.
    traces?: ReadonlyMap<string, ExecutionTrace>
}

const CHARACTER_PROGRESS_HEARTBEAT_MS = 5_000

class AsyncSerialQueue {
    private tail = Promise.resolve()

    async run(task: () => Promise<void>): Promise<void> {
        const previous = this.tail
        let release = (): void => undefined
        this.tail = new Promise<void>(resolve => {
            release = () => resolve()
        })
        await previous
        try {
            await task()
        } finally {
            release()
        }
    }

    async waitForIdle(): Promise<void> {
        await this.tail
    }
}

function formatElapsedTime(elapsedMs: number): string {
    const elapsedSeconds = Math.max(1, Math.floor(elapsedMs / 1_000))
    const minutes = Math.floor(elapsedSeconds / 60)
    const seconds = elapsedSeconds % 60
    return minutes > 0 ? `${minutes}m ${seconds}s elapsed` : `${seconds}s elapsed`
}

async function executeWithProgressHeartbeat<T>({
    signal,
    report,
    buildProgress,
    execute,
}: {
    signal: AbortSignal | undefined
    report: (progress: Omit<MediaGenerationRunProgress, 'items'>) => Promise<void>
    buildProgress: (elapsedMs: number) => Omit<MediaGenerationRunProgress, 'items'>
    execute: () => Promise<T>
}): Promise<T> {
    const startedAt = Date.now()
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let pendingHeartbeat = Promise.resolve()
    const scheduleHeartbeat = (): void => {
        if (stopped || signal?.aborted) return
        timer = setTimeout(() => {
            if (stopped || signal?.aborted) return
            pendingHeartbeat = (async () => {
                try {
                    await report(buildProgress(Date.now() - startedAt))
                } catch {
                    // Progress reporting is advisory and cannot fail the operation.
                }
                scheduleHeartbeat()
            })()
        }, CHARACTER_PROGRESS_HEARTBEAT_MS)
    }
    scheduleHeartbeat()
    try {
        return await execute()
    } finally {
        stopped = true
        if (timer !== undefined) clearTimeout(timer)
        await pendingHeartbeat
    }
}

function buildCharacterProgressItems(snapshot: CharacterProgressSnapshot): OperationProgressItem[] {
    const phaseOrder: MediaGenerationRunProgress['phase'][] = ['preparing', 'rendering', 'assessing', 'composing']
    const phaseIndex = phaseOrder.indexOf(snapshot.phase)
    const phaseIsComplete = (phase: MediaGenerationRunProgress['phase']): boolean => {
        if (phase === 'preparing') return snapshot.preparationStage === 'completed'
        if (phase === 'rendering') {
            return snapshot.runningPanelIds.size === 0
                && snapshot.renderedPanels.size + snapshot.renderFailures.size >= snapshot.plan.panels.length
        }
        if (phase === 'assessing') {
            return snapshot.runningAssessmentPanelIds.size === 0
                && snapshot.assessments.size + snapshot.assessmentFailures.size
                    >= snapshot.assessmentEligiblePanelIds.size
        }
        return snapshot.compositionStage === 'completed'
    }
    const getPhaseStatus = (phase: MediaGenerationRunProgress['phase']): OperationProgressItem['status'] => {
        const itemIndex = phaseOrder.indexOf(phase)
        if (itemIndex < phaseIndex) return 'completed'
        if (itemIndex > phaseIndex) return 'pending'
        return phaseIsComplete(phase) ? 'completed' : 'running'
    }
    const preparationStages: CharacterProgressSnapshot['preparationStage'][] = [
        'resolving-references',
        'analyzing-evidence',
        'building-reference-pack',
        'completed',
    ]
    const preparationStageIndex = preparationStages.indexOf(snapshot.preparationStage)
    const getPreparationStatus = (
        stage: Exclude<CharacterProgressSnapshot['preparationStage'], 'completed'>,
        failed = false,
    ): OperationProgressItem['status'] => {
        const itemIndex = preparationStages.indexOf(stage)
        if (itemIndex < preparationStageIndex) return failed ? 'failed' : 'completed'
        if (itemIndex > preparationStageIndex) return 'pending'
        return 'running'
    }
    const preparationChildren: OperationProgressItem[] = [
        {
            id: 'resolve-source-references',
            title: 'Load source references',
            status: getPreparationStatus('resolving-references'),
            summary: snapshot.preparationSourceCount === undefined
                ? `Authorizing and loading ${snapshot.plan.sourceAssetIds.length} source image(s).`
                : `${snapshot.preparationSourceCount} authorized source image(s) loaded at full usable resolution.`,
        },
        {
            id: 'analyze-identity-evidence',
            title: 'Analyze identity evidence',
            status: getPreparationStatus('analyzing-evidence', Boolean(snapshot.sourceWarning)),
            summary: snapshot.sourceWarning
                ?? snapshot.preparationEvidenceSummary
                ?? 'Inspecting observed identity, outfit, material, palette, and source coverage evidence.',
        },
        {
            id: 'build-reference-pack',
            title: 'Build reference pack',
            status: getPreparationStatus('building-reference-pack'),
            summary: snapshot.preparationReferenceSummary
                ?? 'Preparing lossless identity crops and provider-ready source references.',
        },
    ]
    const renderChildren = snapshot.plan.panels.map((panel): OperationProgressItem => ({
        id: `render:${panel.panelId}`,
        title: panel.title,
        status: snapshot.renderFailures.has(panel.panelId)
            ? 'failed'
            : snapshot.renderedPanels.has(panel.panelId)
            ? 'completed'
            : snapshot.runningPanelIds.has(panel.panelId)
            ? 'running'
            : phaseIndex > phaseOrder.indexOf('rendering')
            ? 'skipped'
            : 'pending',
        summary: formatRenderProgressSummary(panel.panelId, snapshot),
    }))
    const assessmentChildren = snapshot.plan.panels.map((panel): OperationProgressItem => ({
        id: `assess:${panel.panelId}`,
        title: panel.title,
        status: getAssessmentProgressStatus(panel.panelId, snapshot, phaseIndex, phaseOrder),
        summary: formatAssessmentProgressSummary(panel.panelId, snapshot),
        meta: formatAssessmentProgressMeta(panel.panelId, snapshot),
    }))
    const assessmentExecutionFailed = snapshot.plan.panels.some(panel => (
        assessmentPanelExecutionFailed(panel.panelId, snapshot)
    ))
    const assessmentNeedsAttention = snapshot.plan.panels.some(panel => (
        assessmentPanelNeedsReview(panel.panelId, snapshot)
    ))
    const compositionStages: CharacterProgressSnapshot['compositionStage'][] = [
        'pending',
        'assembling',
        'sealing',
        'completed',
    ]
    const compositionStageIndex = compositionStages.indexOf(snapshot.compositionStage)
    const getCompositionStatus = (stage: 'assembling' | 'sealing'): OperationProgressItem['status'] => {
        if (snapshot.phase !== 'composing') return 'pending'
        const itemIndex = compositionStages.indexOf(stage)
        if (itemIndex < compositionStageIndex) return 'completed'
        if (itemIndex > compositionStageIndex) return 'pending'
        return 'running'
    }
    const availablePanelCount = snapshot.renderedPanels.size
    const plannedShotTitles = snapshot.plan.panels.map(panel => panel.title).join(', ')

    return attachProgressTraces([
        {
            id: 'validate-and-plan',
            title: 'Validate request and plan shots',
            status: 'completed',
            summary: `${snapshot.plan.sourceAssetIds.length} reference Asset(s) accepted; ${snapshot.plan.panels.length} shot(s) planned with one provider attempt each.`,
            children: [
                {
                    id: 'validate-character-request',
                    title: 'Validate character request',
                    status: 'completed',
                    summary: `${snapshot.plan.userPrompt.length}-character request accepted with ${snapshot.plan.sourceAssetIds.length} reference Asset(s).`,
                },
                {
                    id: 'build-character-render-plan',
                    title: 'Build character render plan',
                    status: 'completed',
                    summary: `${snapshot.plan.panels.length} shot(s) planned: ${plannedShotTitles}. The portrait, front full-body, and back full-body shots form the configured reference barrier chain.`,
                },
            ],
        },
        {
            id: 'source-evidence',
            title: 'Prepare identity evidence',
            status: snapshot.sourceWarning && phaseIsComplete('preparing')
                ? 'failed'
                : getPhaseStatus('preparing'),
            ...(snapshot.sourceWarning ? { summary: snapshot.sourceWarning } : {}),
            children: preparationChildren,
        },
        {
            id: 'render-shots',
            title: `Generate three required anchors plus ${snapshot.plan.panels.length - 3} optional shot(s)`,
            status: snapshot.renderFailures.size > 0 && phaseIsComplete('rendering')
                ? 'failed'
                : getPhaseStatus('rendering'),
            summary: snapshot.renderFailures.size > 0
                ? `${availablePanelCount} of ${snapshot.plan.panels.length} shots rendered; ${snapshot.renderFailures.size} unavailable. No automatic retry was started.`
                : snapshot.renderedPanels.has(CHARACTER_BACK_ANCHOR_PANEL_ID)
                ? `${availablePanelCount} of ${snapshot.plan.panels.length} shots rendered; all three generated anchors are available to every optional shot.`
                : snapshot.renderedPanels.has(CHARACTER_OUTFIT_ANCHOR_PANEL_ID)
                ? `${availablePanelCount} of ${snapshot.plan.panels.length} shots rendered; the back full-body outfit anchor is the remaining barrier.`
                : snapshot.renderedPanels.has(CHARACTER_IDENTITY_ANCHOR_PANEL_ID)
                ? `${availablePanelCount} of ${snapshot.plan.panels.length} shots rendered; the front full-body outfit anchor is the next barrier.`
                : `${availablePanelCount} of ${snapshot.plan.panels.length} shots rendered; the front identity portrait is the first barrier.`,
            children: renderChildren,
        },
        {
            id: 'compare-fidelity',
            title: 'Compare identity fidelity',
            status: assessmentExecutionFailed && phaseIsComplete('assessing')
                ? 'failed'
                : assessmentNeedsAttention && phaseIsComplete('assessing')
                ? 'attention'
                : getPhaseStatus('assessing'),
            summary: formatAssessmentGroupSummary(snapshot),
            meta: formatAssessmentGroupMeta(snapshot),
            children: assessmentChildren,
        },
        {
            id: 'compose-sheet',
            title: 'Compose character sheet',
            status: getPhaseStatus('composing'),
            summary: snapshot.compositionStage === 'completed'
                ? `Final 3840×2560 PNG composed from ${availablePanelCount} available shot(s).`
                : `Preparing a deterministic 3840×2560 sheet from ${availablePanelCount} available shot(s).`,
            children: [
                {
                    id: 'assemble-sheet',
                    title: 'Assemble rendered shots',
                    status: getCompositionStatus('assembling'),
                    summary: snapshot.compositionStage === 'pending'
                        ? 'Waiting for generation and fidelity evaluation to finish.'
                        : `${availablePanelCount} available shot(s) are being fitted into the deterministic layout.`,
                },
                {
                    id: 'seal-sheet-output',
                    title: 'Seal final image output',
                    status: getCompositionStatus('sealing'),
                    summary: snapshot.compositionStage === 'completed'
                        ? 'Final PNG is ready for normal generated-asset settlement.'
                        : 'Waiting for the composed PNG before handing it to asset settlement.',
                },
            ],
        },
    ], snapshot.traces ?? new Map())
}

// The provider is handed a mix of Asset-backed references and generated or pose
// references that have no Asset of their own. Asset-backed ones become handles
// the reader can hover; the rest are named by role so nothing is invisible.
function buildPanelReferenceHandles(
    references: readonly CharacterImageReference[],
    selectedReferenceEntries: readonly { role: string; sourceAssetId?: string }[],
): ExecutionTraceHandle[] {
    const assetIdByRole = new Map(selectedReferenceEntries.flatMap(entry => (
        entry.sourceAssetId ? [[entry.role, entry.sourceAssetId] as const] : []
    )))
    return references.map((reference): ExecutionTraceHandle => {
        const assetId = assetIdByRole.get(reference.role)
        return assetId
            ? {
                kind: 'media',
                id: assetId,
                displayName: assetId,
                mediaKind: 'image',
                role: reference.role,
            }
            : {
                kind: 'media',
                id: reference.fileName ?? reference.role,
                displayName: reference.fileName ?? reference.role,
                mediaKind: 'image',
                role: reference.role,
                note: 'Generated during this run',
            }
    })
}

// Traces are recorded against progress item ids while the run proceeds, then
// grafted onto the item tree here so the timeline and the trace stay one object.
function attachProgressTraces(
    items: OperationProgressItem[],
    traces: ReadonlyMap<string, ExecutionTrace>,
): OperationProgressItem[] {
    return items.map(item => ({
        ...item,
        ...(traces.get(item.id) ? { trace: traces.get(item.id) } : {}),
        ...(item.children ? { children: attachProgressTraces(item.children, traces) } : {}),
    }))
}

function formatRenderProgressSummary(panelId: string, snapshot: CharacterProgressSnapshot): string {
    const panel = snapshot.plan.panels.find(candidate => candidate.panelId === panelId)
    const generatedReferenceRoles = panel?.outputBindings.map(binding => binding.referenceRole) ?? []
    const failure = snapshot.renderFailures.get(panelId)
    if (failure) {
        return failure.startsWith('Required generated output unavailable:')
            ? `Not started because a required generated reference was unavailable. ${failure}`
            : formatRuntimeWarning('Provider generation failed', failure)
    }
    const rendered = snapshot.renderedPanels.get(panelId)
    if (rendered) {
        if (snapshot.observedPanelIds.has(panelId)) {
            return 'Used the observed lossless source crop directly; no provider generation was required.'
        }
        const included = rendered.includedReferenceRoles.length > 0
            ? [...new Set(rendered.includedReferenceRoles)].join(', ')
            : 'none reported'
        const omitted = rendered.omittedReferenceRoles.length > 0
            ? ` Omitted by provider: ${[...new Set(rendered.omittedReferenceRoles)].join(', ')}.`
            : ''
        const anchorResult = generatedReferenceRoles.length > 0
            ? generatedReferenceRoles.every(role => rendered.includedReferenceRoles.includes(role))
                ? generatedReferenceRoles.includes('opposite-angle')
                    ? ' The generated portrait, front full-body, and back full-body anchors were all used.'
                    : generatedReferenceRoles.includes('adjacent-angle')
                    ? ' The generated portrait and front full-body anchors were both used.'
                    : ' The generated neutral-front identity anchor was used.'
                : ' One or more required generated reference roles were not reported by the provider.'
            : panelId === CHARACTER_IDENTITY_ANCHOR_PANEL_ID
            ? ' This shot is the generated identity anchor for the front full-body shot and every later shot.'
            : panelId === CHARACTER_OUTFIT_ANCHOR_PANEL_ID
            ? ' This shot is the generated outfit anchor used with the identity portrait by every later shot.'
            : panelId === CHARACTER_BACK_ANCHOR_PANEL_ID
            ? ' This shot is the generated rear-outfit anchor used with the portrait and front full-body shot by every optional shot.'
            : ''
        return `Rendered in one provider attempt. References used: ${included}.${anchorResult}${omitted}`
    }
    if (snapshot.runningPanelIds.has(panelId)) {
        if (panelId === CHARACTER_IDENTITY_ANCHOR_PANEL_ID) {
            return 'Generating the required neutral-front identity anchor from the authorized source evidence.'
        }
        if (panelId === CHARACTER_OUTFIT_ANCHOR_PANEL_ID) {
            return 'Generating the required front full-body outfit anchor from the completed identity portrait.'
        }
        if (panelId === CHARACTER_BACK_ANCHOR_PANEL_ID) {
            return 'Generating the required back full-body outfit anchor from the completed portrait and front full-body shot.'
        }
        return 'Provider generation is running with all three generated anchors, plus original evidence and this shot’s pose control.'
    }
    const missingDependencies = panel?.dependsOn.filter(dependency => !snapshot.renderedPanels.has(dependency)) ?? []
    if (missingDependencies.length > 0) {
        return `Blocked until required generated shot(s) finish successfully: ${missingDependencies.join(', ')}.`
    }
    return snapshot.phase === 'rendering'
        ? 'Queued until its shot dependencies and a provider slot are ready.'
        : 'Waiting for identity evidence preparation to finish.'
}

function getAssessmentProgressStatus(
    panelId: string,
    snapshot: CharacterProgressSnapshot,
    phaseIndex: number,
    phaseOrder: MediaGenerationRunProgress['phase'][],
): OperationProgressItem['status'] {
    const assessingPhaseIndex = phaseOrder.indexOf('assessing')
    if (snapshot.renderFailures.has(panelId) || !snapshot.renderedPanels.has(panelId)) {
        return phaseIndex >= assessingPhaseIndex ? 'skipped' : 'pending'
    }
    if (snapshot.observedPanelIds.has(panelId)) {
        return phaseIndex >= assessingPhaseIndex ? 'skipped' : 'pending'
    }
    if (!snapshot.assessmentEligiblePanelIds.has(panelId)) {
        return phaseIndex >= assessingPhaseIndex ? 'failed' : 'pending'
    }
    if (snapshot.assessmentFailures.has(panelId)) return 'failed'
    const assessment = snapshot.assessments.get(panelId)
    if (assessment) {
        if (assessment.dimensions.length === 0) return 'failed'
        return assessmentNeedsReview(assessment) ? 'attention' : 'completed'
    }
    if (snapshot.runningAssessmentPanelIds.has(panelId)) return 'running'
    return phaseIndex > assessingPhaseIndex ? 'failed' : 'pending'
}

function formatAssessmentProgressSummary(panelId: string, snapshot: CharacterProgressSnapshot): string {
    if (snapshot.renderFailures.has(panelId) || !snapshot.renderedPanels.has(panelId)) {
        return 'Skipped because no rendered shot was available.'
    }
    if (snapshot.observedPanelIds.has(panelId)) {
        return 'Not required: this panel came directly from observed source evidence.'
    }
    const failure = snapshot.assessmentFailures.get(panelId)
    if (failure) return formatAssessmentFailureProgress(failure)
    const assessment = snapshot.assessments.get(panelId)
    if (assessment) return formatAssessmentResult(assessment)
    if (
        !snapshot.assessmentEligiblePanelIds.has(panelId)
        && (snapshot.phase === 'assessing' || snapshot.phase === 'composing')
    ) {
        return 'Evaluation unavailable because the rendered shot could not be staged for comparison; shot retained for review.'
    }
    if (snapshot.runningAssessmentPanelIds.has(panelId)) {
        return 'Scoring identity, outfit, anatomy, pose, and the shot-specific acceptance dimensions.'
    }
    if (snapshot.renderedPanels.has(panelId) && snapshot.phase === 'rendering') {
        return 'Rendered shot is ready; evaluation will start after the remaining shot generation settles.'
    }
    return snapshot.phase === 'assessing'
        ? 'Queued for identity fidelity evaluation.'
        : 'Waiting for the rendered shot.'
}

function formatAssessmentResult(assessment: CharacterPanelAssessment): string {
    if (assessment.dimensions.length === 0) {
        const dimensionResult = assessment.vlmError?.message
            ?? 'The evaluator did not return usable per-dimension scores.'
        return `Per-dimension evaluation unavailable; rendered shot retained for review. ${dimensionResult.replace(/[.!?]+$/u, '')} · ${formatFaceFidelityResult(assessment)}`
    }
    const outcome = assessment.failedDimensions.length > 0
        ? `Needs review: ${assessment.failedDimensions.map(formatDimensionName).join(', ')}`
        : 'Passed every evaluated dimension'
    const dimensionScores = assessment.dimensions
        .map(dimension => `${formatDimensionName(dimension.dimension)} ${formatPercent(dimension.score)}`)
        .join(' · ')
    const mismatchDiagnostics = assessment.dimensions.flatMap(dimension => (
        dimension.mismatchCodes.length > 0
            ? [`${formatDimensionName(dimension.dimension)}: ${dimension.mismatchCodes.map(formatDimensionName).join(', ')}`]
            : []
    ))
    const diagnostics = mismatchDiagnostics.length > 0
        ? ` · Reported mismatches: ${mismatchDiagnostics.join(' · ')}`
        : ''
    return `Overall ${formatPercent(assessment.score)} · ${outcome} · ${dimensionScores} · ${formatFaceFidelityResult(assessment)}${diagnostics}`
}

function formatAssessmentProgressMeta(panelId: string, snapshot: CharacterProgressSnapshot): string {
    if (snapshot.renderFailures.has(panelId) || !snapshot.renderedPanels.has(panelId)) return 'No rendered shot'
    if (snapshot.observedPanelIds.has(panelId)) return 'Source evidence'
    if (snapshot.assessmentFailures.has(panelId)) return 'Evaluation failed'
    const assessment = snapshot.assessments.get(panelId)
    if (assessment) {
        if (assessment.dimensions.length === 0) {
            const faceResult = assessment.fidelityMetric.available
                    && assessment.fidelityMetric.cosineSimilarity !== undefined
                ? `face ${formatPercent(assessment.fidelityMetric.cosineSimilarity)}`
                : 'face unavailable'
            return `Dimension scoring unavailable · ${faceResult}`
        }
        const reviewCount = assessment.failedDimensions.length
        const faceUnavailable = isRequiredFaceFidelityUnavailable(assessment) ? ' · face unavailable' : ''
        return `${formatPercent(assessment.score)} · ${reviewCount === 0 ? 'passed' : `${reviewCount} flag(s)`}${faceUnavailable}`
    }
    if (
        !snapshot.assessmentEligiblePanelIds.has(panelId)
        && (snapshot.phase === 'assessing' || snapshot.phase === 'composing')
    ) {
        return 'Unavailable'
    }
    if (snapshot.runningAssessmentPanelIds.has(panelId)) return 'Scoring now'
    if (snapshot.phase === 'composing') return 'Evaluation missing'
    if (snapshot.renderedPanels.has(panelId)) return 'Ready to score'
    return 'Waiting'
}

function formatAssessmentGroupSummary(snapshot: CharacterProgressSnapshot): string {
    const evaluated = [...snapshot.assessments.values()]
        .filter(assessment => assessment.dimensions.length > 0).length
    const reviewFlags = [...snapshot.assessments.values()]
        .filter(assessmentNeedsReview).length
    const evaluationFailures = snapshot.plan.panels
        .filter(panel => assessmentPanelExecutionFailed(panel.panelId, snapshot)).length
    const unavailableFaceChecks = [...snapshot.assessments.values()]
        .filter(isRequiredFaceFidelityUnavailable).length
    if (snapshot.phase === 'assessing') {
        return `${evaluated} of ${snapshot.assessmentEligiblePanelIds.size} eligible shot(s) scored; ${reviewFlags} contain review flags; ${evaluationFailures} panel evaluation failure(s); ${unavailableFaceChecks} required face check(s) unavailable.`
    }
    if (snapshot.phase === 'composing') {
        return `${evaluated} shot(s) scored; ${reviewFlags} contain review flags; ${evaluationFailures} panel evaluation failure(s); ${unavailableFaceChecks} required face check(s) unavailable. Every flagged shot opens with its scores and diagnostics.`
    }
    return 'Each rendered shot will receive per-dimension scores and an overall fidelity result.'
}

function formatAssessmentGroupMeta(snapshot: CharacterProgressSnapshot): string {
    const scored = [...snapshot.assessments.values()]
        .filter(assessment => assessment.dimensions.length > 0).length
    const flagged = [...snapshot.assessments.values()]
        .filter(assessmentNeedsReview).length
    const failed = snapshot.plan.panels
        .filter(panel => assessmentPanelExecutionFailed(panel.panelId, snapshot)).length
    const unavailableFaceChecks = [...snapshot.assessments.values()]
        .filter(isRequiredFaceFidelityUnavailable).length
    if (scored === 0 && snapshot.phase !== 'assessing' && snapshot.phase !== 'composing') return 'Waiting'
    return `${scored} scored · ${flagged} flagged${failed > 0 ? ` · ${failed} failed` : ''}${unavailableFaceChecks > 0 ? ` · ${unavailableFaceChecks} face unavailable` : ''}`
}

function formatFaceFidelityResult(assessment: CharacterPanelAssessment): string {
    if (
        assessment.fidelityMetric.available
        && assessment.fidelityMetric.cosineSimilarity !== undefined
    ) {
        return `face similarity ${formatPercent(assessment.fidelityMetric.cosineSimilarity)}`
    }
    const unavailableReason = assessment.fidelityMetric.unavailableReason
    if (unavailableReason === 'face-not-required') return 'face similarity not required for this shot'
    if (unavailableReason === 'non-photographic') return 'face similarity not supported for non-photographic evidence'
    const diagnostic = assessment.fidelityError?.code
        ?? unavailableReason
        ?? 'no reason returned'
    return `face similarity unavailable (${formatDimensionName(diagnostic)})`
}

function isRequiredFaceFidelityUnavailable(assessment: CharacterPanelAssessment): boolean {
    if (assessment.fidelityMetric.available) return false
    return assessment.fidelityMetric.unavailableReason !== 'face-not-required'
        && assessment.fidelityMetric.unavailableReason !== 'non-photographic'
}

function assessmentPanelExecutionFailed(panelId: string, snapshot: CharacterProgressSnapshot): boolean {
    if (snapshot.renderFailures.has(panelId) || !snapshot.renderedPanels.has(panelId)) return false
    if (snapshot.observedPanelIds.has(panelId)) return false
    if (snapshot.assessmentFailures.has(panelId)) return true
    const assessment = snapshot.assessments.get(panelId)
    if (assessment) return assessment.dimensions.length === 0
    if (!snapshot.assessmentEligiblePanelIds.has(panelId)) {
        return snapshot.phase === 'assessing' || snapshot.phase === 'composing'
    }
    return snapshot.phase === 'composing'
}

function assessmentPanelNeedsReview(panelId: string, snapshot: CharacterProgressSnapshot): boolean {
    if (snapshot.renderFailures.has(panelId) || !snapshot.renderedPanels.has(panelId)) return false
    if (snapshot.observedPanelIds.has(panelId)) return false
    if (!snapshot.assessmentEligiblePanelIds.has(panelId)) return snapshot.phase === 'assessing' || snapshot.phase === 'composing'
    if (snapshot.assessmentFailures.has(panelId)) return true
    const assessment = snapshot.assessments.get(panelId)
    return assessment ? assessmentNeedsReview(assessment) : snapshot.phase === 'composing'
}

function assessmentNeedsReview(assessment: CharacterPanelAssessment): boolean {
    return assessment.dimensions.length === 0 || assessment.failedDimensions.length > 0
}

function formatPercent(value: number): string {
    return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

function formatDimensionName(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
        .replace(/[-_]+/gu, ' ')
        .trim()
        .toLocaleLowerCase('en-US')
}

function summarizeEvidence(evidence: CharacterEvidenceProfile): string {
    const observed = evidence.facts.filter(fact => fact.visibility === 'observed').length
    const inferred = evidence.facts.length - observed
    return `${observed} observed trait(s), ${inferred} inferred trait(s), ${evidence.palette.length} palette value(s), and ${evidence.conflicts.length} conflict(s) found. Medium: ${evidence.medium}. Edit target: ${evidence.editTargetPolicy}.`
}

function summarizeReferencePack(entries: CharacterReferencePack['entries']): string {
    const counts = new Map<string, number>()
    for (const entry of entries) counts.set(entry.role, (counts.get(entry.role) ?? 0) + 1)
    const roles = [...counts.entries()].map(([role, count]) => `${role} ×${count}`).join(', ')
    return `${entries.length} provider-ready reference(s) prepared: ${roles || 'none'}.`
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
        const authoritativePrompt = state.sharedState.authoritativePrompt.trim() || plan.userPrompt
        const capabilityInstructions = [
            ...new Set(
                state.sharedState.capabilityInstructions
                    .map(instruction => instruction.trim())
                    .filter(Boolean),
            ),
        ]
        const capabilityReferences = buildSharedCapabilityReferences(state.sharedState.capabilityReferences)
        const completeRequest = [
            authoritativePrompt,
            ...capabilityInstructions.map(instruction => `Shared Capability instruction: ${instruction}`),
        ].join('\n\n')
        const modelCapabilities = state.imageModel.meta.imageReferenceCapabilities
        if (!modelCapabilities) throw new Error('IMAGE_REFERENCE_CAPABILITIES_REQUIRED')
        if (
            !modelCapabilities.conditioningModes.includes('identity')
            || modelCapabilities.maxIdentityReferenceImages === 0
        ) {
            throw new Error('CHARACTER_CREATOR_IDENTITY_CONDITIONING_UNSUPPORTED')
        }
        const requiredGeneratedReferenceCount = Math.max(
            ...plan.panels.map(panel => panel.outputBindings.filter(binding => binding.required).length),
        )
        if (
            modelCapabilities.maxIdentityReferenceImages < requiredGeneratedReferenceCount
            || modelCapabilities.maxReferenceImages < requiredGeneratedReferenceCount
        ) {
            throw new Error('CHARACTER_CREATOR_GENERATED_REFERENCE_BUDGET_UNSUPPORTED')
        }
        const vlmPorts = createCharacterVlmPorts({
            provider: state.reasoningModel.provider,
            modelVersion: state.reasoningModel.modelVersion,
            inferenceCapabilities: state.reasoningModel.inferenceCapabilities,
            maxOutputTokensCeiling: state.reasoningModel.maxCompletionSize,
            vlm: this.deps.structuredVlm,
        })
        const store = this.deps.transientMedia.create(state)
        const renderedPanels = new Map<string, RenderedPanel>()
        const renderFailures = new Map<string, string>()
        const runningPanelIds = new Set<string>()
        const assessments = new Map<string, CharacterPanelAssessment>()
        const assessmentFailures = new Map<string, string>()
        const assessmentEligiblePanelIds = new Set<string>()
        const runningAssessmentPanelIds = new Set<string>()
        const observedPanelIds = new Set<string>()
        const progressTraces = new Map<string, ExecutionTrace>()
        const recordTrace = (itemId: string, update: (current: ExecutionTrace) => ExecutionTrace): void => {
            progressTraces.set(
                itemId,
                update(
                    progressTraces.get(itemId) ?? { traceVersion: 'execution-trace-v1' },
                ),
            )
        }
        const recordModelCall = (itemId: string, modelCall: ExecutionTraceModelCall): void => {
            recordTrace(itemId, current => ({
                ...current,
                modelCalls: [
                    ...(current.modelCalls ?? []).filter(existing => existing.id !== modelCall.id),
                    modelCall,
                ],
            }))
        }
        const recordPanelAssessmentTrace = (panelId: string, assessment: CharacterPanelAssessment): void => {
            recordModelCall(`assess:${panelId}`, {
                id: `assess-vlm:${panelId}`,
                role: 'assessor',
                provider: state.reasoningModel.provider,
                modelId: assessment.vlmAssessor || state.reasoningModel.modelVersion,
                purpose: 'Compare the rendered shot against the sources across the fidelity dimensions.',
                params: assessment.dimensions.map(dimension => ({
                    name: dimension.dimension,
                    value: String(dimension.score),
                })),
                inputHandles: sourceAssetHandles('comparison-source'),
                ...(assessment.vlmError ? { errorMessage: assessment.vlmError.message } : {}),
            })
            if (assessment.fidelityModelIds) {
                recordModelCall(`assess:${panelId}`, {
                    id: `assess-face:${panelId}`,
                    role: 'assessor',
                    provider: 'lixpi-fidelity',
                    modelId: assessment.fidelityModelIds.recognizer,
                    purpose: 'Measure facial similarity between the rendered shot and the sources.',
                    params: [
                        { name: 'detector', value: assessment.fidelityModelIds.detector },
                        { name: 'recognizer', value: assessment.fidelityModelIds.recognizer },
                        ...(typeof assessment.fidelityMetric.cosineSimilarity === 'number'
                            ? [{ name: 'cosineSimilarity', value: assessment.fidelityMetric.cosineSimilarity.toFixed(4) }]
                            : []),
                    ],
                    ...(assessment.fidelityError ? { errorMessage: assessment.fidelityError.message } : {}),
                })
            }
            recordTrace(`assess:${panelId}`, current => ({
                ...current,
                facts: [
                    { label: 'Overall score', value: assessment.score.toFixed(2) },
                    { label: 'Verdict', value: assessment.valid ? 'passed' : 'needs review' },
                    ...(assessment.failedDimensions.length
                        ? [{ label: 'Failed dimensions', value: assessment.failedDimensions.join(', ') }]
                        : []),
                ],
            }))
        }
        const sourceAssetHandles = (role: string): ExecutionTraceHandle[] =>
            plan.sourceAssetIds.map(assetId => ({
                kind: 'media' as const,
                id: assetId,
                displayName: assetId,
                mediaKind: 'image' as const,
                role,
            }))
        let preparationStage: CharacterProgressSnapshot['preparationStage'] = 'resolving-references'
        let preparationSourceCount: number | undefined
        let preparationEvidenceSummary: string | undefined
        let preparationReferenceSummary: string | undefined
        let compositionStage: CharacterProgressSnapshot['compositionStage'] = 'pending'
        let evidenceAnalysisWarning: string | undefined
        const progressReportQueue = new AsyncSerialQueue()
        const reportProgress = async (progress: Omit<MediaGenerationRunProgress, 'items'>): Promise<void> => {
            if (!options.reportProgress) return
            const progressSnapshot: MediaGenerationRunProgress = {
                ...progress,
                items: buildCharacterProgressItems({
                    phase: progress.phase,
                    plan,
                    preparationStage,
                    ...(preparationSourceCount === undefined ? {} : { preparationSourceCount }),
                    ...(preparationEvidenceSummary ? { preparationEvidenceSummary } : {}),
                    ...(preparationReferenceSummary ? { preparationReferenceSummary } : {}),
                    renderedPanels: new Map(renderedPanels),
                    renderFailures: new Map(renderFailures),
                    runningPanelIds: new Set(runningPanelIds),
                    assessments: new Map(assessments),
                    assessmentFailures: new Map(assessmentFailures),
                    assessmentEligiblePanelIds: new Set(assessmentEligiblePanelIds),
                    runningAssessmentPanelIds: new Set(runningAssessmentPanelIds),
                    observedPanelIds: new Set(observedPanelIds),
                    compositionStage,
                    ...(evidenceAnalysisWarning ? { sourceWarning: evidenceAnalysisWarning } : {}),
                    traces: new Map(progressTraces),
                }),
            }
            await progressReportQueue.run(async () => {
                await options.reportProgress!(progressSnapshot)
            })
        }
        const reportProgressSafely = async (
            progress: Omit<MediaGenerationRunProgress, 'items'>,
        ): Promise<void> => {
            try {
                await reportProgress(progress)
            } catch {
                // Progress reporting is advisory and cannot fail provider work.
            }
        }
        try {
            await reportProgress({
                phase: 'preparing',
                completedSteps: 0,
                totalSteps: 3,
                message: `Authorizing and loading ${plan.sourceAssetIds.length} source image(s).`,
            })
            const sources = await executeWithProgressHeartbeat({
                signal: options.signal,
                report: reportProgress,
                buildProgress: elapsedMs => ({
                    phase: 'preparing',
                    completedSteps: 0,
                    totalSteps: 3,
                    message: `Source loading is active: authorizing and reading ${plan.sourceAssetIds.length} image(s) at usable resolution; ${formatElapsedTime(elapsedMs)}.`,
                }),
                execute: () =>
                    resolveCharacterReferences({
                        assetIds: plan.sourceAssetIds,
                        organizationId: state.organizationId,
                        workspaceId: state.workspaceId,
                        userId: state.userId,
                        assets: this.deps.referenceAssets,
                        panels: plan.panels,
                    }),
            })
            const storedComponents = new Map<string, ResolvedCharacterReference>()
            for (const source of sources) {
                if (
                    source.sourceKind === 'composition-component'
                    && source.assetId === state.sharedState.editTargetAssetId
                    && source.componentId
                ) {
                    storedComponents.set(source.componentId, source)
                }
            }
            const assetSources = sources.filter(source => source.sourceKind === 'asset-rendition')
            const evidenceSources = sources.filter(source =>
                !(source.sourceKind === 'composition-component'
                    && source.assetId === state.sharedState.editTargetAssetId)
            )
            preparationSourceCount = evidenceSources.length
            recordTrace('resolve-source-references', current => ({
                ...current,
                handles: sourceAssetHandles('source-reference'),
                facts: [
                    { label: 'Authorized source images', value: String(evidenceSources.length) },
                    { label: 'Stored panels reused', value: String(storedComponents.size) },
                ],
            }))
            preparationStage = 'analyzing-evidence'
            await reportProgress({
                phase: 'preparing',
                completedSteps: 1,
                totalSteps: 3,
                message: `${evidenceSources.length} original source image(s) and ${storedComponents.size} stored panel(s) loaded. Analyzing identity, outfit, materials, and source coverage.`,
            })
            let evidence: CharacterEvidenceProfile
            const evidenceAnalysisStartedAt = Date.now()
            try {
                evidence = await executeWithProgressHeartbeat({
                    signal: options.signal,
                    report: reportProgress,
                    buildProgress: elapsedMs => ({
                        phase: 'preparing',
                        completedSteps: 1,
                        totalSteps: 3,
                        message: `Identity analysis is active on ${evidenceSources.length} original source image(s): checking observed facial traits, outfit, materials, palette, conflicts, and source coverage; ${formatElapsedTime(elapsedMs)}.`,
                    }),
                    execute: () =>
                        analyzeCharacterEvidence({
                            sources: evidenceSources,
                            editTargets: [...storedComponents.values()],
                            referenceAliases: state.sharedState.mediaReferenceAliases,
                            panels: plan.panels,
                            userPrompt: completeRequest,
                            editTargetPresent: storedComponents.size > 0,
                            analyzer: this.deps.evidenceAnalyzer ?? vlmPorts.evidenceAnalyzer,
                            signal: options.signal,
                        }),
                })
                recordModelCall('analyze-identity-evidence', {
                    id: 'evidence-analysis',
                    role: 'resolver',
                    provider: state.reasoningModel.provider,
                    modelId: state.reasoningModel.modelVersion,
                    purpose: 'Read the supplied references for observed identity, outfit, material, palette, and coverage evidence.',
                    params: [
                        ...(state.reasoningModel.maxCompletionSize
                            ? [{ name: 'maxOutputTokens', value: String(state.reasoningModel.maxCompletionSize) }]
                            : []),
                        { name: 'sources', value: String(evidenceSources.length) },
                        { name: 'editTargets', value: String(storedComponents.size) },
                    ],
                    prompt: completeRequest,
                    inputHandles: sourceAssetHandles('evidence-source'),
                    startedAt: evidenceAnalysisStartedAt,
                    completedAt: Date.now(),
                })
            } catch (error) {
                if (options.signal?.aborted) throw error
                evidenceAnalysisWarning = formatRuntimeWarning('Source evidence analysis was unavailable', error)
                recordModelCall('analyze-identity-evidence', {
                    id: 'evidence-analysis',
                    role: 'resolver',
                    provider: state.reasoningModel.provider,
                    modelId: state.reasoningModel.modelVersion,
                    purpose: 'Read the supplied references for observed identity and outfit evidence.',
                    inputHandles: sourceAssetHandles('evidence-source'),
                    startedAt: evidenceAnalysisStartedAt,
                    completedAt: Date.now(),
                    errorMessage: error instanceof Error ? error.message : String(error),
                })
                evidence = {
                    medium: 'unknown',
                    editTargetPolicy: storedComponents.size > 0
                        ? 'preserve-panel'
                        : 'not-present',
                    regenerationScope: 'full-sheet',
                    affectedPanelIds: plan.panels.map(panel => panel.panelId),
                    facts: [],
                    promptDirectives: [],
                    promptChangedFeatures: [],
                    palette: [],
                    costumeNotes: [],
                    materialNotes: [],
                    distinguishingDetailNotes: [],
                    sourceCoverage: evidenceSources.map((source): CharacterEvidenceProfile['sourceCoverage'][number] => ({
                        sourceAssetId: source.assetId,
                        angles: ['unspecified'],
                        regions: ['face', 'body', 'outfit'],
                    })),
                    conflicts: [],
                }
            }
            const regenerationDecision = selectCharacterPanelsForRegeneration({
                panels: plan.panels,
                availableComponentIds: new Set(storedComponents.keys()),
                regenerationScope: evidence.regenerationScope,
                affectedPanelIds: evidence.affectedPanelIds,
            })
            const reusedPanelIds = new Set(regenerationDecision.reusePanelIds)
            for (const panel of plan.panels) {
                const stored = storedComponents.get(panel.panelId)
                if (!stored || !reusedPanelIds.has(panel.panelId)) continue
                renderedPanels.set(panel.panelId, {
                    bytes: stored.bytes,
                    reused: true,
                    includedReferenceRoles: ['composition-component'],
                    omittedReferenceRoles: [],
                })
            }
            console.info('[CharacterCreatorRegeneration] decision', {
                capabilityRunId: plan.capabilityRunId,
                mode: regenerationDecision.mode,
                reason: regenerationDecision.reason,
                storedPanelIds: [...storedComponents.keys()],
                regeneratePanelIds: regenerationDecision.regeneratePanelIds,
                reusePanelIds: regenerationDecision.reusePanelIds,
            })
            preparationEvidenceSummary = summarizeEvidence(evidence)
            preparationStage = 'building-reference-pack'
            await reportProgress({
                phase: 'preparing',
                completedSteps: 2,
                totalSteps: 3,
                message: evidenceAnalysisWarning
                    ? 'Evidence analysis was unavailable. Building the reference pack directly from the authorized sources.'
                    : `${preparationEvidenceSummary} Building lossless identity crops and provider-ready references.`,
            })
            const referencePack = await executeWithProgressHeartbeat({
                signal: options.signal,
                report: reportProgress,
                buildProgress: elapsedMs => ({
                    phase: 'preparing',
                    completedSteps: 2,
                    totalSteps: 3,
                    message: `Reference-pack construction is active: preparing lossless identity crops and model-compatible source references from ${evidenceSources.length} original source image(s); ${formatElapsedTime(elapsedMs)}.`,
                }),
                execute: () =>
                    buildCharacterReferencePack({
                        sources,
                        evidence,
                        editTargetAssetId: state.sharedState.editTargetAssetId,
                        referenceAliases: state.sharedState.mediaReferenceAliases,
                        capabilities: modelCapabilities,
                        store,
                    }),
            })
            preparationReferenceSummary = summarizeReferencePack(referencePack.entries)
            recordTrace('build-reference-pack', current => ({
                ...current,
                handles: referencePack.entries.flatMap(entry =>
                    entry.sourceAssetId
                        ? [{
                            kind: 'media' as const,
                            id: entry.sourceAssetId,
                            displayName: entry.sourceAssetId,
                            mediaKind: 'image' as const,
                            role: entry.role,
                        }]
                        : []
                ),
                facts: [
                    { label: 'Reference entries', value: String(referencePack.entries.length) },
                    ...referencePack.entries.map(entry => ({
                        label: entry.role,
                        value: `${entry.width}×${entry.height}`,
                    })),
                    { label: 'Max reference images', value: String(modelCapabilities.maxReferenceImages) },
                    { label: 'Max identity references', value: String(modelCapabilities.maxIdentityReferenceImages) },
                ],
            }))
            preparationStage = 'completed'
            await reportProgress({
                phase: 'preparing',
                completedSteps: 3,
                totalSteps: 3,
                message: `${preparationReferenceSummary} Starting shot generation.`,
            })
            const observedProp = referencePack.entries.find(entry => entry.role === 'prop-crop')
            const regeneratePanelIds = new Set(regenerationDecision.regeneratePanelIds)
            const observedPropSpec = observedProp
                    && !renderedPanels.has('prop-primary')
                    && !(storedComponents.size > 0 && regeneratePanelIds.has('prop-primary'))
                ? plan.panels.find(panel => panel.panelId === 'prop-primary')
                : undefined
            if (observedProp && observedPropSpec) {
                observedPanelIds.add(observedPropSpec.panelId)
                renderedPanels.set(observedPropSpec.panelId, {
                    bytes: decodeDataUrl(observedProp.url),
                    includedReferenceRoles: ['prop-crop'],
                    omittedReferenceRoles: [],
                })
            }
            const renderPanels: CharacterRenderDagNode[] = plan.panels
                .filter(panel => panel.panelId !== observedPropSpec?.panelId)
                .map(panel => ({ ...panel, nodeId: panel.panelId }))
            const initialPanelResults = new Map<string, CharacterPanelRenderResult>()
            for (const panel of renderPanels) {
                const rendered = renderedPanels.get(panel.panelId)
                if (rendered?.reused) initialPanelResults.set(panel.panelId, rendered)
            }
            const fidelity = evidenceSources.length > 0 ? this.deps.fidelity : undefined
            let completedRenders = renderedPanels.size
            let providerOperationAttempts = 0
            let partialIndex = 0
            const livePartialPanels = new Map<string, Buffer>()
            const reviewOnlyPanels = new Map<string, RenderedPanel>()
            const progressivePublishQueue = new AsyncSerialQueue()
            const publishProgressiveSheet = async (source: string): Promise<void> => {
                if (!options.publishImagePartial) return
                const visiblePanels = new Map<string, Buffer>(
                    [...renderedPanels.entries()].map(
                        ([panelId, rendered]): [string, Buffer] => [panelId, rendered.bytes],
                    ),
                )
                for (const [panelId, rendered] of reviewOnlyPanels) {
                    if (!visiblePanels.has(panelId)) visiblePanels.set(panelId, rendered.bytes)
                }
                for (const [panelId, bytes] of livePartialPanels) visiblePanels.set(panelId, bytes)
                if (visiblePanels.size === 0) return
                const snapshot = [...visiblePanels.entries()].map(([panelId, bytes]) => ({
                    panelId,
                    bytes,
                }))
                const assessmentSnapshot = new Map(assessments)
                const nextPartialIndex = ++partialIndex
                await progressivePublishQueue.run(async () => {
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
                    } catch (error) {
                        console.warn('[CharacterCreatorProjection] accepted-sheet projection unavailable', {
                            capabilityRunId: plan.capabilityRunId,
                            source,
                            partialIndex: nextPartialIndex,
                            error: error instanceof Error ? error.message : String(error),
                        })
                    }
                })
            }

            await publishProgressiveSheet('prepared-evidence')
            await reportProgress({
                phase: 'rendering',
                completedSteps: completedRenders,
                totalSteps: plan.panels.length,
                message: initialPanelResults.size > 0
                    ? `Reusing ${initialPanelResults.size} stored shot(s) and regenerating ${renderPanels.length - initialPanelResults.size} affected or missing shot(s); no automatic retries will run.`
                    : `Generating the neutral-front portrait, front full-body shot, and back full-body shot sequentially. The ${plan.panels.length - 3} optional shot(s) wait for all three terminal outputs; no automatic retries will run.`,
            })
            const runner = new CapabilityMediaDagRunner<CharacterRenderDagNode, CharacterPanelRenderResult>(
                renderPanels,
                this.deps.providerConcurrency ?? 3,
                0,
            )
            await executeWithProgressHeartbeat({
                signal: options.signal,
                report: reportProgress,
                buildProgress: elapsedMs => {
                    const activePanelTitles = plan.panels
                        .filter(panel => runningPanelIds.has(panel.panelId))
                        .map(panel => panel.title)
                    const remainingPanelCount = Math.max(
                        0,
                        plan.panels.length - completedRenders - activePanelTitles.length,
                    )
                    const waitingSummary = renderedPanels.has(CHARACTER_BACK_ANCHOR_PANEL_ID)
                        ? `${remainingPanelCount} queued`
                        : renderedPanels.has(CHARACTER_OUTFIT_ANCHOR_PANEL_ID)
                        ? `${remainingPanelCount} waiting for the back full-body outfit anchor`
                        : renderedPanels.has(CHARACTER_IDENTITY_ANCHOR_PANEL_ID)
                        ? `${remainingPanelCount} waiting for the front full-body outfit anchor`
                        : `${remainingPanelCount} waiting for the front identity portrait`
                    return {
                        phase: 'rendering',
                        completedSteps: completedRenders,
                        totalSteps: plan.panels.length,
                        message: `Provider rendering is active: ${completedRenders} of ${plan.panels.length} shot(s) finished; ${activePanelTitles.length} in flight${activePanelTitles.length > 0 ? ` (${activePanelTitles.join(', ')})` : ''}; ${waitingSummary}; ${formatElapsedTime(elapsedMs)}.`,
                    }
                },
                execute: () =>
                    runner.run({
                        initialResults: initialPanelResults,
                        signal: options.signal,
                        allowTerminalFailure: (_panel, error) => !isAbortFailure(error),
                        onNodeBlocked: async (panel, blocked) => {
                            renderFailures.set(
                                panel.panelId,
                                `Required generated output unavailable: ${blocked.missingBindingKeys.join(', ')}.`,
                            )
                            completedRenders += 1
                            await reportProgressSafely({
                                phase: 'rendering',
                                completedSteps: completedRenders,
                                totalSteps: plan.panels.length,
                                message: `${panel.title} was not started because required generated reference output was unavailable: ${blocked.missingBindingKeys.join(', ')}.`,
                            })
                        },
                        execute: async (panel, executionContext) => {
                            runningPanelIds.add(panel.panelId)
                            const generatedReferences = buildGeneratedPanelReferences(
                                panel.outputBindings,
                                executionContext.boundOutputs,
                            )
                            const selectedReferenceEntries = selectCharacterPanelReferenceEntries(
                                referencePack.entries,
                                panel,
                                evidence,
                            )
                            const references: CharacterImageReference[] = [
                                ...generatedReferences,
                                ...selectedReferenceEntries,
                                ...capabilityReferences,
                            ]
                            void reportProgressSafely({
                                phase: 'rendering',
                                completedSteps: completedRenders,
                                totalSteps: plan.panels.length,
                                message: panel.panelId === CHARACTER_IDENTITY_ANCHOR_PANEL_ID
                                    ? `Generating ${panel.title} as the required identity anchor from the authorized source evidence.`
                                    : panel.panelId === CHARACTER_OUTFIT_ANCHOR_PANEL_ID
                                    ? `Generating ${panel.title} from the completed identity portrait to establish the complete outfit.`
                                    : panel.panelId === CHARACTER_BACK_ANCHOR_PANEL_ID
                                    ? `Generating ${panel.title} from the completed portrait and front full-body shot to establish the rear outfit.`
                                    : `Generating ${panel.title} with all three completed anchors, plus original evidence and pose control.`,
                            })
                            try {
                                const sourceEvidenceSummary = selectCharacterEvidenceFacts({
                                    evidence,
                                    targetAngle: panel.target,
                                    promptChangedFeatures: evidence.promptChangedFeatures,
                                })
                                    .filter(fact => fact.visibility === 'observed')
                                    .slice(0, 16)
                                    .map(fact =>
                                        `${
                                            evidence.promptChangedFeatures.some(feature => (
                                                    normalizeEvidenceFeature(feature) === normalizeEvidenceFeature(fact.feature)
                                                )
                                                )
                                                ? '[REQUEST-CHANGED] '
                                                : ''
                                        }${
                                            formatEvidenceSourceAlias(
                                                fact.sourceAssetId,
                                                state.sharedState.mediaReferenceAliases,
                                            )
                                        }${fact.feature}: ${fact.value}`
                                    )
                                    .join('; ')
                                const prompt = buildCharacterPanelPrompt({
                                    panel,
                                    authoritativePrompt,
                                    sourceMedium: evidence.medium,
                                    sourceEvidenceSummary,
                                    promptDirectives: evidence.promptDirectives,
                                    sourceSubjectIdentityClassifications: state.sharedState.sourceSubjectIdentityClassifications,
                                    capabilityInstructions,
                                    capabilityReferenceCount: capabilityReferences.length,
                                    generatedReferenceBindings: panel.outputBindings,
                                    editTargetReferences: references.filter(reference => (
                                        reference.role === 'edit-target'
                                        || reference.role === 'edit-target-identity'
                                    )),
                                    originalSourceReferenceCount: selectedReferenceEntries.filter(entry => (
                                        entry.role === 'original-source'
                                        || entry.role === 'face-crop'
                                        || entry.role === 'body-outfit-crop'
                                        || entry.role === 'prop-crop'
                                    )).length,
                                })
                                providerOperationAttempts += 1
                                const panelRenderStartedAt = Date.now()
                                const rendered = await renderCharacterPanel({
                                    imageGeneration: this.deps.imageGeneration,
                                    context: state,
                                    plan,
                                    panel,
                                    attempt: 1,
                                    prompt,
                                    references,
                                    onImagePartial: async (imageBase64, providerPartialIndex) => {
                                        if (!imageBase64) return
                                        livePartialPanels.set(
                                            panel.panelId,
                                            decodeProviderPartialImage(imageBase64),
                                        )
                                        await publishProgressiveSheet(
                                            `provider:${panel.panelId}:${providerPartialIndex}`,
                                        )
                                    },
                                    signal: options.signal,
                                })
                                recordModelCall(`render:${panel.panelId}`, {
                                    id: `render:${panel.panelId}`,
                                    role: 'media',
                                    provider: state.imageModel.provider,
                                    modelId: state.imageModel.modelVersion,
                                    purpose: `Render ${panel.title}.`,
                                    params: [
                                        // What the provider was actually called with, which the
                                        // adapter resolves from the model's supported sizes.
                                        { name: 'size', value: rendered.resolvedImageSize ?? String(state.imageModel.requestedSize ?? 'auto') },
                                        { name: 'attempt', value: '1' },
                                        { name: 'referenceImages', value: String(references.length) },
                                        { name: 'conditioning', value: modelCapabilities.conditioningModes.join(', ') },
                                    ],
                                    prompt,
                                    inputHandles: buildPanelReferenceHandles(references, selectedReferenceEntries),
                                    ...(rendered.providerOperationId
                                        ? { providerOperationId: rendered.providerOperationId }
                                        : {}),
                                    startedAt: panelRenderStartedAt,
                                    completedAt: Date.now(),
                                })
                                recordTrace(`render:${panel.panelId}`, current => ({
                                    ...current,
                                    facts: [
                                        { label: 'References accepted by provider', value: rendered.includedReferenceRoles.join(', ') || 'none reported' },
                                        ...(rendered.omittedReferenceRoles.length
                                            ? [{ label: 'References omitted by provider', value: rendered.omittedReferenceRoles.join(', ') }]
                                            : []),
                                        ...(panel.outputBindings.length
                                            ? [{ label: 'Generated anchors attached', value: panel.outputBindings.map(binding => binding.referenceRole).join(', ') }]
                                            : []),
                                    ],
                                }))
                                const stored = await store.putWithCoordinate({
                                    mediaKind: 'image',
                                    slot: `candidate-${panel.panelId}`,
                                    bytes: rendered.bytes,
                                    mimeType: 'image/png',
                                    revision: 1,
                                })
                                reviewOnlyPanels.set(panel.panelId, {
                                    ...rendered,
                                    coordinate: stored.coordinate,
                                })
                                assessmentEligiblePanelIds.add(panel.panelId)
                                const poseReference = await loadCharacterPoseReference(panel)
                                const assessment = await assessCharacterPanel({
                                    panel,
                                    attemptId: `${plan.capabilityRunId}:${panel.panelId}:1`,
                                    candidateBytes: rendered.bytes,
                                    candidateCoordinate: stored.coordinate,
                                    sourceCoordinates: selectedReferenceEntries
                                        .filter(entry =>
                                            entry.role === 'edit-target'
                                            || entry.role === 'edit-target-identity'
                                            || entry.role === 'original-source'
                                            || entry.role === 'face-crop'
                                        )
                                        .slice(0, 5)
                                        .map(entry => entry.coordinate),
                                    sourceDataUrls: selectedReferenceEntries
                                        .filter(entry =>
                                            entry.role === 'edit-target'
                                            || entry.role === 'edit-target-identity'
                                            || entry.role === 'original-source'
                                            || entry.role === 'face-crop'
                                            || entry.role === 'body-outfit-crop'
                                        )
                                        .map(entry => entry.url),
                                    authoritativePrompt,
                                    capabilityInstructions,
                                    capabilityReferenceDataUrls: capabilityReferences
                                        .map(reference => reference.url)
                                        .filter(isInlineImageDataUrl),
                                    ...(poseReference ? { poseReferenceDataUrl: poseReference.url } : {}),
                                    evidence,
                                    vlm: this.deps.panelAssessor ?? vlmPorts.panelAssessor,
                                    fidelity,
                                    signal: options.signal,
                                })
                                assessments.set(panel.panelId, assessment)
                                recordPanelAssessmentTrace(panel.panelId, assessment)
                                const structuralFailures = getCharacterPanelStructuralFailures(panel, assessment)
                                console.info('[CharacterCreatorStructuralAssessment]', {
                                    capabilityRunId: plan.capabilityRunId,
                                    panelId: panel.panelId,
                                    releaseFailures: structuralFailures,
                                    dimensions: assessment.dimensions.map(dimension => ({
                                        dimension: dimension.dimension,
                                        score: dimension.score,
                                        mismatchCodes: dimension.mismatchCodes,
                                    })),
                                })
                                if (structuralFailures.length > 0) {
                                    throw new Error(
                                        `CHARACTER_PANEL_STRUCTURAL_CONTRACT_FAILED:${panel.panelId}:${structuralFailures.join(',')}`,
                                    )
                                }
                                livePartialPanels.delete(panel.panelId)
                                reviewOnlyPanels.delete(panel.panelId)
                                renderedPanels.set(panel.panelId, {
                                    ...rendered,
                                    coordinate: stored.coordinate,
                                })
                                completedRenders += 1
                                runningPanelIds.delete(panel.panelId)
                                await reportProgress({
                                    phase: 'rendering',
                                    completedSteps: completedRenders,
                                    totalSteps: plan.panels.length,
                                    message: panel.panelId === CHARACTER_IDENTITY_ANCHOR_PANEL_ID
                                        ? 'The neutral-front identity anchor is complete. Releasing the front full-body outfit shot.'
                                        : panel.panelId === CHARACTER_OUTFIT_ANCHOR_PANEL_ID
                                        ? 'The front full-body outfit anchor is complete. Releasing the back full-body outfit shot.'
                                        : panel.panelId === CHARACTER_BACK_ANCHOR_PANEL_ID
                                        ? `The back full-body outfit anchor is complete. Releasing ${plan.panels.length - 3} optional shot(s) with all three generated references attached.`
                                        : `Rendered ${completedRenders} of ${plan.panels.length} shots with all three generated anchors; the sheet preview is updating.`,
                                })
                                await publishProgressiveSheet(`terminal:${panel.panelId}`)
                                return rendered
                            } catch (error) {
                                runningPanelIds.delete(panel.panelId)
                                const livePartial = livePartialPanels.get(panel.panelId)
                                if (options.signal?.aborted || isAbortFailure(error)) {
                                    livePartialPanels.delete(panel.panelId)
                                    reviewOnlyPanels.delete(panel.panelId)
                                    throw error
                                }
                                if (!reviewOnlyPanels.has(panel.panelId) && livePartial) {
                                    reviewOnlyPanels.set(panel.panelId, {
                                        bytes: livePartial,
                                        includedReferenceRoles: [...new Set(references.map(reference => reference.role))],
                                        omittedReferenceRoles: [],
                                    })
                                }
                                livePartialPanels.delete(panel.panelId)
                                renderFailures.set(panel.panelId, (error as Error).message || 'Panel generation failed')
                                completedRenders += 1
                                await reportProgress({
                                    phase: 'rendering',
                                    completedSteps: completedRenders,
                                    totalSteps: plan.panels.length,
                                    message: panel.panelId === CHARACTER_IDENTITY_ANCHOR_PANEL_ID
                                        ? 'The required neutral-front identity anchor failed. Dependent provider work will not start.'
                                        : panel.panelId === CHARACTER_OUTFIT_ANCHOR_PANEL_ID
                                        ? 'The required front full-body outfit anchor failed. Later provider work will not start.'
                                        : panel.panelId === CHARACTER_BACK_ANCHOR_PANEL_ID
                                        ? 'The required back full-body outfit anchor failed. Optional provider work will not start.'
                                        : `${panel.title} was unavailable; continuing with the rendered shots.`,
                                })
                                await publishProgressiveSheet(`failed:${panel.panelId}`)
                                throw error
                            }
                        },
                    }),
            })
            const availablePanels = new Map(renderedPanels)
            for (const [panelId, rendered] of reviewOnlyPanels) {
                if (!availablePanels.has(panelId)) availablePanels.set(panelId, rendered)
            }
            if (availablePanels.size === 0) {
                const firstFailure = plan.panels
                    .map(panel => renderFailures.get(panel.panelId))
                    .find((failure): failure is string => Boolean(failure))
                throw new Error(firstFailure ?? 'CHARACTER_SHEET_NO_RENDERED_PANELS')
            }

            const assessablePanels = plan.panels.filter(panel => {
                const rendered = renderedPanels.get(panel.panelId)
                return rendered?.coordinate
                    && !assessments.has(panel.panelId)
                    && panel.panelId !== observedPropSpec?.panelId
            })
            for (const panel of assessablePanels) assessmentEligiblePanelIds.add(panel.panelId)
            await reportProgress({
                phase: 'assessing',
                completedSteps: 0,
                totalSteps: assessablePanels.length,
                message: `Comparing ${assessablePanels.length} generated shots with the source evidence.`,
            })
            let completedAssessments = 0
            await executeWithProgressHeartbeat({
                signal: options.signal,
                report: reportProgress,
                buildProgress: elapsedMs => {
                    const activePanelTitles = assessablePanels
                        .filter(panel => runningAssessmentPanelIds.has(panel.panelId))
                        .map(panel => panel.title)
                    return {
                        phase: 'assessing',
                        completedSteps: completedAssessments,
                        totalSteps: assessablePanels.length,
                        message: `Identity fidelity evaluation is active: ${completedAssessments} of ${assessablePanels.length} eligible shot(s) scored; ${activePanelTitles.length} in flight${activePanelTitles.length > 0 ? ` (${activePanelTitles.join(', ')})` : ''}; ${formatElapsedTime(elapsedMs)}.`,
                    }
                },
                execute: () =>
                    runInBatches(
                        assessablePanels,
                        this.deps.providerConcurrency ?? 3,
                        options.signal,
                        async panel => {
                            runningAssessmentPanelIds.add(panel.panelId)
                            void reportProgressSafely({
                                phase: 'assessing',
                                completedSteps: completedAssessments,
                                totalSteps: assessablePanels.length,
                                message: `Evaluating ${panel.title} against the source identity evidence.`,
                            })
                            try {
                                const rendered = renderedPanels.get(panel.panelId)!
                                const assessment = await assessCharacterPanel({
                                    panel,
                                    attemptId: `${plan.capabilityRunId}:${panel.panelId}:1`,
                                    candidateBytes: rendered.bytes,
                                    candidateCoordinate: rendered.coordinate!,
                                    sourceCoordinates: referencePack.entries
                                        .filter(entry =>
                                            entry.role === 'edit-target'
                                            || entry.role === 'edit-target-identity'
                                            || entry.role === 'original-source'
                                            || entry.role === 'face-crop'
                                        )
                                        .slice(0, 5)
                                        .map(entry => entry.coordinate),
                                    sourceDataUrls: referencePack.entries
                                        .filter(entry =>
                                            entry.role === 'edit-target'
                                            || entry.role === 'edit-target-identity'
                                            || entry.role === 'original-source'
                                            || entry.role === 'face-crop'
                                            || entry.role === 'body-outfit-crop'
                                        )
                                        .map(entry => entry.url),
                                    authoritativePrompt,
                                    capabilityInstructions,
                                    capabilityReferenceDataUrls: capabilityReferences
                                        .map(reference => reference.url)
                                        .filter(isInlineImageDataUrl),
                                    evidence,
                                    vlm: this.deps.panelAssessor ?? vlmPorts.panelAssessor,
                                    fidelity,
                                    signal: options.signal,
                                })
                                assessments.set(panel.panelId, assessment)
                                recordPanelAssessmentTrace(panel.panelId, assessment)
                            } catch (error) {
                                if (options.signal?.aborted) throw error
                                const failure = describeCharacterPanelAssessmentFailure(error)
                                assessmentFailures.set(panel.panelId, failure.progressMessage)
                                console.warn('[CharacterCreatorFidelity] panel evaluation unavailable', {
                                    capabilityRunId: plan.capabilityRunId,
                                    panelId: panel.panelId,
                                    panelTitle: panel.title,
                                    code: failure.code,
                                    diagnostic: failure.diagnostic,
                                    ...failure.context,
                                })
                                throw error
                            } finally {
                                runningAssessmentPanelIds.delete(panel.panelId)
                                if (!options.signal?.aborted) {
                                    completedAssessments += 1
                                    const assessment = assessments.get(panel.panelId)
                                    const assessmentFailure = assessmentFailures.get(panel.panelId)
                                    await reportProgress({
                                        phase: 'assessing',
                                        completedSteps: completedAssessments,
                                        totalSteps: assessablePanels.length,
                                        message: assessment
                                            ? `${panel.title}: ${formatAssessmentResult(assessment)}. ${completedAssessments} of ${assessablePanels.length} evaluations finished.`
                                            : `${panel.title}: ${formatAssessmentFailureProgress(assessmentFailure ?? 'No evaluation result was returned.')}. ${completedAssessments} of ${assessablePanels.length} evaluations finished.`,
                                    })
                                }
                            }
                        },
                    ),
            })

            compositionStage = 'assembling'
            await reportProgress({
                phase: 'composing',
                completedSteps: 0,
                totalSteps: 2,
                message: `Fitting ${availablePanels.size} available shot(s) into the final 3840×2560 character sheet.`,
            })
            const composition = await executeWithProgressHeartbeat({
                signal: options.signal,
                report: reportProgress,
                buildProgress: elapsedMs => ({
                    phase: 'composing',
                    completedSteps: 0,
                    totalSteps: 2,
                    message: `Final sheet composition is active: fitting ${availablePanels.size} available shot(s) into the deterministic 3840×2560 layout; ${formatElapsedTime(elapsedMs)}.`,
                }),
                execute: () =>
                    (this.deps.compositor ?? composeCharacterSheet)({
                        panelSpecs: plan.panels,
                        panels: [...availablePanels.entries()].map(([panelId, rendered]) => ({
                            panelId,
                            bytes: rendered.bytes,
                        })),
                        evidence,
                        assessments,
                        unavailablePanelIds: new Set(renderFailures.keys()),
                        ...(evidenceAnalysisWarning ? { additionalIssues: [evidenceAnalysisWarning] } : {}),
                        final: true,
                    }),
            })
            recordTrace('assemble-sheet', current => ({
                ...current,
                facts: [
                    { label: 'Compositor', value: 'sharp-character-sheet-3840x2560-v3' },
                    { label: 'Shots placed', value: String(availablePanels.size) },
                    { label: 'Shots unavailable', value: String(renderFailures.size) },
                    { label: 'Output', value: '3840×2560 PNG' },
                ],
            }))
            compositionStage = 'sealing'
            await reportProgress({
                phase: 'composing',
                completedSteps: 1,
                totalSteps: 2,
                message: 'The final PNG is composed. Sealing it for generated-asset settlement.',
            })
            await progressivePublishQueue.waitForIdle()
            compositionStage = 'completed'
            const fidelityReviewCount = plan.panels
                .filter(panel =>
                    assessmentPanelNeedsReview(panel.panelId, {
                        phase: 'composing',
                        plan,
                        preparationStage,
                        renderedPanels,
                        renderFailures,
                        runningPanelIds,
                        assessments,
                        assessmentFailures,
                        assessmentEligiblePanelIds,
                        runningAssessmentPanelIds,
                        observedPanelIds,
                        compositionStage,
                    })
                )
                .length
            await reportProgress({
                phase: 'composing',
                completedSteps: 2,
                totalSteps: 2,
                message: `Character sheet complete: ${availablePanels.size} available shot(s), ${fidelityReviewCount} fidelity review flag(s), ${renderFailures.size} render error(s). Finalizing the generated asset.`,
            })
            const panelTraces = plan.panels.map(panel =>
                buildPanelTrace({
                    panel,
                    rendered: availablePanels.get(panel.panelId),
                    assessment: assessments.get(panel.panelId),
                    failure: renderFailures.get(panel.panelId),
                    observed: panel.panelId === observedPropSpec?.panelId,
                })
            )
            const needsReview = panelTraces.filter(panel => panel.status !== 'completed')
            const reviewIssueCount = needsReview.length + (evidenceAnalysisWarning ? 1 : 0)
            const trace: CharacterSheetTrace = {
                traceVersion: 'capability-media-review-v1',
                schemaVersion: CHARACTER_SHEET_TRACE_SCHEMA_VERSION,
                capabilityId: 'global.character-creator',
                capabilityRunId: plan.capabilityRunId,
                provider: state.imageModel.provider,
                modelVersion: state.imageModel.modelVersion,
                compositor: 'sharp-character-sheet-3840x2560-v3',
                summary: reviewIssueCount > 0
                    ? `${availablePanels.size} of ${plan.panels.length} shots retained; ${reviewIssueCount} execution or comparison issues need review.`
                    : `${plan.panels.length} shots rendered and passed the configured comparison thresholds.`,
                automaticRetries: 0,
                recommendation: reviewIssueCount > 0
                    ? 'Review the flagged shots. Keep this candidate or explicitly generate another variant; no retry was started automatically.'
                    : 'Keep this candidate or explicitly generate another variant.',
                steps: [
                    ...(evidenceAnalysisWarning
                        ? [{
                            stepId: 'source-evidence',
                            title: 'Source evidence',
                            status: 'needs-review' as const,
                            issues: [evidenceAnalysisWarning],
                        }]
                        : []),
                    ...panelTraces.map(panel => ({
                        stepId: panel.panelId,
                        title: panel.title,
                        status: panel.status,
                        ...(panel.attempts > 0 && !panel.failedDimensions.includes('comparison-unavailable')
                            ? { score: panel.score }
                            : {}),
                        issues: [
                            ...new Set([
                                ...panel.failedDimensions,
                                ...(panel.warning ? [panel.warning] : []),
                            ]),
                        ],
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
                mediaComposition: {
                    kind: 'character-sheet',
                    capabilityId: 'global.character-creator',
                    sourceAssetIds: [...new Set(assetSources.map(source => source.assetId))],
                    components: plan.panels.flatMap(panel => {
                        const rendered = availablePanels.get(panel.panelId)
                        return rendered
                            ? [{
                                componentId: panel.panelId,
                                role: renderedPanels.has(panel.panelId)
                                    ? 'character-sheet-panel'
                                    : 'character-sheet-panel-review-only',
                                title: panel.title,
                                imageBase64: rendered.bytes.toString('base64'),
                                mimeType: 'image/png' as const,
                            }]
                            : []
                    }),
                },
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
            dimensionResults: [],
            warning: args.failure ?? 'Shot was unavailable.',
            vlmAssessor: 'not-assessed',
            providerOperationIds: [],
            includedReferenceRoles: [],
            omittedReferenceRoles: [],
        }
    }
    if (args.rendered.reused) {
        return {
            panelId: args.panel.panelId,
            title: args.panel.title,
            attempts: 0,
            selectedAttempt: 0,
            score: 1,
            status: 'completed',
            failedDimensions: [],
            dimensionResults: [],
            vlmAssessor: 'durable-composition-component',
            providerOperationIds: [],
            includedReferenceRoles: ['composition-component'],
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
            dimensionResults: [],
            vlmAssessor: 'deterministic-observed-prop',
            providerOperationIds: [],
            includedReferenceRoles: ['prop-crop'],
            omittedReferenceRoles: [],
        }
    }
    const comparisonUnavailable = !args.assessment || args.assessment.dimensions.length === 0
    const failedDimensions = args.assessment?.failedDimensions ?? ['comparison-unavailable']
    const traceFailures = comparisonUnavailable
        ? [...new Set(['comparison-unavailable', ...failedDimensions])]
        : failedDimensions
    return {
        panelId: args.panel.panelId,
        title: args.panel.title,
        attempts: 1,
        selectedAttempt: 1,
        score: args.assessment?.score ?? 0,
        status: comparisonUnavailable || failedDimensions.length > 0 ? 'needs-review' : 'completed',
        failedDimensions: traceFailures,
        dimensionResults: args.assessment?.dimensions ?? [],
        ...(args.assessment
            ? {
                faceFidelity: {
                    available: args.assessment.fidelityMetric.available,
                    ...(args.assessment.fidelityMetric.cosineSimilarity !== undefined
                        ? { cosineSimilarity: args.assessment.fidelityMetric.cosineSimilarity }
                        : {}),
                    ...(args.assessment.fidelityMetric.unavailableReason
                        ? { unavailableReason: args.assessment.fidelityMetric.unavailableReason }
                        : {}),
                    ...(args.assessment.fidelityError?.code
                        ? { errorCode: args.assessment.fidelityError.code }
                        : {}),
                    ...(args.assessment.fidelityModelIds?.detector
                        ? { detectorArtifactId: args.assessment.fidelityModelIds.detector }
                        : {}),
                    ...(args.assessment.fidelityModelIds?.recognizer
                        ? { recognizerArtifactId: args.assessment.fidelityModelIds.recognizer }
                        : {}),
                },
            }
            : {}),
        ...(args.assessment?.vlmError ? { vlmEvaluationError: args.assessment.vlmError } : {}),
        ...(args.failure
            ? {
                warning: args.failure,
            }
            : comparisonUnavailable
            ? {
                warning: args.assessment?.vlmError?.message
                    ?? 'Per-dimension comparison was unavailable; the rendered shot was preserved.',
            }
            : {}),
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

function isAbortFailure(error: unknown): boolean {
    const candidate = error as { name?: unknown; message?: unknown }
    const name = typeof candidate?.name === 'string' ? candidate.name : ''
    const message = typeof candidate?.message === 'string' ? candidate.message : String(error ?? '')
    return name === 'AbortError'
        || name === 'APIUserAbortError'
        || /(?:^|\b)abort(?:ed)?(?:\b|$)/iu.test(message)
}

function decodeDataUrl(value: string): Buffer {
    const separator = value.indexOf(',')
    if (separator < 0) throw new Error('CHARACTER_REFERENCE_DATA_URL_INVALID')
    return Buffer.from(value.slice(separator + 1), 'base64')
}

function decodeProviderPartialImage(value: string): Buffer {
    const dataUrl = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/u.exec(value)
    const base64 = dataUrl?.[1] ?? value
    if (!/^[A-Za-z0-9+/=\r\n]+$/u.test(base64)) {
        throw new Error('CHARACTER_PROVIDER_PARTIAL_FORMAT_INVALID')
    }
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.length === 0) throw new Error('CHARACTER_PROVIDER_PARTIAL_EMPTY')
    return bytes
}

function buildGeneratedPanelReferences(
    bindings: readonly CharacterPanelOutputBinding[],
    boundOutputs: ReadonlyMap<string, CharacterPanelRenderResult>,
): CharacterImageReference[] {
    return bindings.flatMap(binding => {
        const rendered = boundOutputs.get(binding.bindingKey)
        if (!rendered) return []
        return [{
            url: `data:image/png;base64,${rendered.bytes.toString('base64')}`,
            role: binding.referenceRole,
            fileName: binding.fileName,
        }]
    })
}

function buildSharedCapabilityReferences(
    references: ReadonlyArray<{ imageUrl: string }>,
): CharacterImageReference[] {
    const seen = new Set<string>()
    return references.flatMap(reference => {
        const imageUrl = reference.imageUrl.trim()
        if (!imageUrl || seen.has(imageUrl)) return []
        seen.add(imageUrl)
        return [{
            url: imageUrl,
            role: 'capability-reference' as const,
            fileName: `CAPABILITY_REFERENCE_${seen.size}.png`,
        }]
    })
}

function formatEvidenceSourceAlias(
    sourceAssetId: string | undefined,
    references: ReadonlyArray<{ assetId: string; alias: string }>,
): string {
    if (!sourceAssetId) return ''
    const alias = references.find(reference => reference.assetId === sourceAssetId)?.alias
    return alias ? `[${alias}] ` : ''
}

function isInlineImageDataUrl(value: string): boolean {
    return /^data:image\/(?:gif|jpeg|png|webp);base64,/u.test(value)
}

function formatRuntimeWarning(prefix: string, error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error)
    const normalized = detail.replace(/\s+/gu, ' ').trim().slice(0, 240)
    return normalized ? `${prefix}: ${normalized}` : prefix
}

function normalizeEvidenceFeature(value: string): string {
    return value.trim().toLocaleLowerCase('en-US')
}

function formatAssessmentFailureProgress(failure: string): string {
    return `Evaluation unavailable; rendered shot retained for review. ${failure.replace(/[.!?]+$/u, '')}`
}
