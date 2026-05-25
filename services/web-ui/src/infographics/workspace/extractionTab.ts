'use strict'

import { html, applyStyle } from '$src/utils/domTemplates.ts'
import { NATS_SUBJECTS, STREAM_STATUS, type CanvasFeatureExtractionState, type StageTraceEvent } from '@lixpi/constants'
import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'
import {
    computeExtractionTimelineModel,
    formatStageDuration,
    type PhaseView,
    type SubstepView,
} from '$src/infographics/workspace/extractionTimelineModel.ts'
import { MarkdownStreamRenderer, renderMarkdownStatic } from '$src/utils/markdownStreamRenderer.ts'
import { aiRobotFaceIcon, claudeIcon, geminiIcon, gptAvatarIcon, stabilityIcon } from '$src/svgIcons/index.ts'

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

const withApiBaseUrl = (url: string): string =>
    url.startsWith('/api/') ? `${API_BASE_URL}${url}` : url

export type ExtractionTabContext = {
    imageNatsUrl?: string
    contextMessages?: Array<{ role: string; content: any }>
    aiModel?: string
    aiImageModel?: string
}

export type ExtractionTabPersistence = {
    getState?: (extractionRunId: string) => CanvasFeatureExtractionState | undefined
    saveState?: (state: CanvasFeatureExtractionState) => void
}

const VALID_EXTRACTION_STATUSES: Array<CanvasFeatureExtractionState['status']> = [
    'pending', 'analyzing', 'routing', 'extracting', 'extracting_axes',
    'materializing_crops', 'synthesizing', 'generating_samples', 'saving', 'completed', 'failed',
]

const pendingContexts = new Map<string, ExtractionTabContext>()

export function setPendingExtractionContext(extractionRunId: string, ctx: ExtractionTabContext) {
    pendingContexts.set(extractionRunId, ctx)
}

export function getPendingExtractionContext(extractionRunId: string): ExtractionTabContext | undefined {
    return pendingContexts.get(extractionRunId)
}

function getExtractionDetailText(content: any): string {
    const detailText = content.extractionDetail ?? content.stepDetail ?? content.statusDetail ?? content.reasoning
    return typeof detailText === 'string' ? detailText : ''
}

function normalizeExtractionStatus(status: any): CanvasFeatureExtractionState['status'] {
    const statusText = typeof status === 'string' ? status : 'analyzing'
    return (VALID_EXTRACTION_STATUSES as string[]).includes(statusText)
        ? statusText as CanvasFeatureExtractionState['status']
        : 'analyzing'
}

function buildSubstepRow(substep: SubstepView): HTMLLIElement {
    // data-stage lets the live token stream target this row's output area without a full re-render.
    const rowEl = html`<li className=${`extraction-substep extraction-substep-${substep.status}`} data=${{ stage: substep.stage }}>
        <div className="extraction-substep-head">
            <span className="extraction-substep-label">${substep.label}</span>
            <span className="extraction-substep-aside"></span>
        </div>
    </li>` as HTMLLIElement

    const asideEl = rowEl.querySelector('.extraction-substep-aside') as HTMLElement
    if (substep.model) asideEl.appendChild(html`<span className="extraction-substep-model">${substep.model}</span>` as HTMLElement)
    if (substep.status !== 'running') asideEl.appendChild(html`<span className="extraction-substep-duration">${formatStageDuration(substep.durationMs)}</span>` as HTMLElement)
    asideEl.appendChild(html`<span className="extraction-substep-status"></span>` as HTMLElement)

    if (substep.summary) rowEl.appendChild(html`<div className="extraction-substep-summary">${substep.summary}</div>` as HTMLElement)
    if (substep.errorMessage) rowEl.appendChild(html`<div className="extraction-substep-error-text">${substep.errorMessage}</div>` as HTMLElement)
    if (substep.promptPreview) {
        // Render the prompt through the markdown stream parser, not as raw text.
        const previewDetails = html`<details className="extraction-substep-details">
            <summary>Prompt preview</summary>
        </details>` as HTMLElement
        previewDetails.appendChild(renderMarkdownStatic(substep.promptPreview, `prompt:${substep.stage}`, 'extraction-substep-preview lixpi-markdown'))
        rowEl.appendChild(previewDetails)
    }
    // The "Model output" block is attached after the timeline renders (live: a
    // persistent MarkdownStreamRenderer that survives rebuilds; persisted: a static render).
    return rowEl
}

function buildPhaseTimeline(phases: PhaseView[], containerEl: HTMLElement, isLive: boolean): void {
    containerEl.replaceChildren()
    const listEl = html`<ol className=${`extraction-phase-timeline${isLive ? ' extraction-phase-timeline-live' : ''}`}></ol>` as HTMLOListElement

    for (const phase of phases) {
        const phaseEl = html`<li className=${`extraction-phase extraction-phase-${phase.status}`}>
            <div className="extraction-phase-head">
                <span className="extraction-phase-dot"></span>
                <span className="extraction-phase-label">${phase.label}</span>
            </div>
        </li>` as HTMLLIElement
        const headEl = phaseEl.querySelector('.extraction-phase-head') as HTMLElement

        if (phase.key === 'generate' && phase.substeps.length > 0) {
            headEl.appendChild(html`<span className="extraction-phase-count">${String(phase.substeps.length)}</span>` as HTMLElement)
        }
        if (phase.durationMs != null) {
            headEl.appendChild(html`<span className="extraction-phase-duration">${formatStageDuration(phase.durationMs)}</span>` as HTMLElement)
        }
        if (phase.meta) {
            phaseEl.appendChild(html`<div className="extraction-phase-meta">${phase.meta}</div>` as HTMLElement)
        }

        if (phase.substeps.length > 0) {
            const substepsEl = html`<ol className="extraction-phase-substeps"></ol>` as HTMLOListElement
            for (const substep of phase.substeps) substepsEl.appendChild(buildSubstepRow(substep))
            phaseEl.appendChild(substepsEl)
        } else if (phase.status === 'active') {
            phaseEl.appendChild(html`<div className="extraction-phase-waiting">Working…</div>` as HTMLElement)
        }

        listEl.appendChild(phaseEl)
    }

    containerEl.appendChild(listEl)
}

function appendImageAuth(url: string, accessToken = ''): string {
    const apiUrl = withApiBaseUrl(url)
    if (!accessToken) return apiUrl
    const separator = apiUrl.includes('?') ? '&' : '?'
    return `${apiUrl}${separator}${new URLSearchParams({ token: accessToken }).toString()}`
}

function getFeatureSampleUrl(feature: any, sample: any, accessToken = '', workspaceId = ''): string {
    if (sample.imageUrl) return appendImageAuth(sample.imageUrl, accessToken)
    return withApiBaseUrl(`/api/features/${feature.featureId}/samples/${sample.idx}?${new URLSearchParams({ token: accessToken, workspaceId }).toString()}`)
}

function buildFeatureCard(feature: any, containerEl: HTMLElement, accessToken = '', workspaceId = '') {
    containerEl.replaceChildren()
    const cardEl = html`<div className="extraction-feature-card">
        <div className="extraction-feature-card-eyebrow">Saved Feature</div>
        <div className="extraction-feature-card-header">
            <span className="extraction-feature-card-category-badge">${feature.category}</span>
            <strong className="extraction-feature-card-name">@${feature.name}</strong>
            <span className="extraction-feature-card-scope-chip">${feature.scope ?? 'workspace'}</span>
        </div>
        <p className="extraction-feature-card-summary">${feature.summary}</p>
        <div className="extraction-feature-card-tags"></div>
        <div className="extraction-feature-card-samples"></div>
    </div>` as HTMLElement
    const tagsEl = cardEl.querySelector('.extraction-feature-card-tags') as HTMLElement
    for (const tag of (feature.tags ?? [])) {
        tagsEl.appendChild(html`<span className="extraction-feature-card-tag">${tag}</span>` as HTMLElement)
    }
    const samplesEl = cardEl.querySelector('.extraction-feature-card-samples') as HTMLElement
    for (const sample of (feature.sampleImages ?? [])) {
        const thumbStyle = { width: '100%', aspectRatio: '3 / 2', objectFit: 'contain' as const, borderRadius: '6px' }
        samplesEl.appendChild(html`<img className="extraction-feature-card-sample-thumb" style=${thumbStyle} src=${getFeatureSampleUrl(feature, sample, accessToken, workspaceId)} alt=${sample.subject} />` as HTMLElement)
    }
    containerEl.appendChild(cardEl)
}

function renderExtractionError(containerEl: HTMLElement, message: string) {
    containerEl.replaceChildren(html`<p className="extraction-tab-error">${message}</p>` as HTMLElement)
}

function renderUserText(contentEl: HTMLElement, userText: string) {
    contentEl.replaceChildren()
    const lines = userText.split(/\n+/).map((line) => line.trim()).filter(Boolean)
    for (const line of lines.length > 0 ? lines : [userText]) {
        contentEl.appendChild(html`<p>${line}</p>` as HTMLElement)
    }
}

function getAiProviderFromModel(aiModel: string | undefined): string {
    const modelText = (aiModel ?? '').toLowerCase()
    if (/anthropic|claude|opus|sonnet|haiku/.test(modelText)) return 'Anthropic'
    if (/google|gemini/.test(modelText)) return 'Google'
    if (/openai|gpt|\bo[134]\b/.test(modelText)) return 'OpenAI'
    if (/stability|stable[-\s]?diffusion|stable[-\s]?image/.test(modelText)) return 'Stability'
    return aiModel?.split(':')[0] || ''
}

function getAssistantIcon(provider: string): string {
    switch (provider) {
        case 'Anthropic': return claudeIcon
        case 'Google': return geminiIcon
        case 'OpenAI': return gptAvatarIcon
        case 'Stability': return stabilityIcon
        default: return aiRobotFaceIcon
    }
}

function createExtractionConversationLayout(bodyEl: HTMLElement, userText: string, aiProvider = ''): {
    timelineContainer: HTMLElement
    featureCardArea: HTMLElement
    assistantContentEl: HTMLElement
} {
    bodyEl.replaceChildren()
    const normalizedProviderClass = aiProvider ? ` assistant-${aiProvider.toLowerCase()}` : ''
    const assistantIcon = getAssistantIcon(aiProvider)
    const threadEl = html`<div className="extraction-chat-thread ai-chat-thread-wrapper">
        <div className="ai-chat-thread-content">
            <div className="ai-user-message-wrapper">
                <div className="ai-user-message">
                    <div className="ai-user-message-content"></div>
                </div>
            </div>
            <div className="ai-response-message-wrapper extraction-assistant-message">
                <div className="ai-response-message">
                    <div className="ai-response-message-bubble">
                        <div className="ai-response-message-content"></div>
                    </div>
                </div>
                <div className="ai-response-message-meta">
                    <div className=${`user-avatar${normalizedProviderClass}`} innerHTML=${assistantIcon}></div>
                </div>
            </div>
        </div>
    </div>` as HTMLElement

    const userContentEl = threadEl.querySelector('.ai-user-message-content') as HTMLElement
    renderUserText(userContentEl, userText)

    const assistantContentEl = threadEl.querySelector('.ai-response-message-content') as HTMLElement
    const timelineContainer = html`<div className="extraction-tab-steps"></div>` as HTMLElement
    const featureCardArea = html`<div className="extraction-tab-card-area"></div>` as HTMLElement
    assistantContentEl.appendChild(timelineContainer)
    assistantContentEl.appendChild(featureCardArea)

    bodyEl.appendChild(threadEl)
    return { timelineContainer, featureCardArea, assistantContentEl }
}

function appendReasoningControls(bodyEl: HTMLElement, initialText = ''): { panelEl: HTMLElement; getText: () => string; appendText: (text: string) => void } {
    const startOpen = initialText.length > 0
    const reasoningToggle = html`<button type="button" className="extraction-tab-reasoning-toggle">${startOpen ? '▼' : '▶'} Agent reasoning</button>` as HTMLButtonElement
    const reasoningPanel = html`<div className="extraction-tab-reasoning-panel" style=${{ display: startOpen ? 'block' : 'none' }}></div>` as HTMLElement
    if (initialText) reasoningPanel.insertAdjacentText('beforeend', initialText)
    reasoningToggle.addEventListener('click', () => {
        const open = reasoningPanel.style.display !== 'none'
        applyStyle(reasoningPanel, { display: open ? 'none' : 'block' })
        reasoningToggle.textContent = open ? '▶ Agent reasoning' : '▼ Agent reasoning'
    })
    bodyEl.appendChild(reasoningToggle)
    bodyEl.appendChild(reasoningPanel)

    const openIfClosed = () => {
        if (reasoningPanel.style.display !== 'none') return
        applyStyle(reasoningPanel, { display: 'block' })
        reasoningToggle.textContent = '▼ Agent reasoning'
    }

    return {
        panelEl: reasoningPanel,
        getText: () => reasoningPanel.textContent ?? '',
        // Auto-opens the panel the first time live reasoning arrives so the user
        // can see streaming tokens without clicking the toggle. No reasoning is dropped.
        appendText: (text: string) => {
            if (!text) return
            openIfClosed()
            reasoningPanel.insertAdjacentText('beforeend', text)
        },
    }
}

async function renderPersistedFeatureCard(featureCard: Record<string, any>, featureCardArea: HTMLElement, workspaceId: string) {
    try {
        const accessToken = (await AuthService.getTokenSilently()) || ''
        buildFeatureCard(featureCard, featureCardArea, accessToken, workspaceId)
    } catch (error) {
        console.warn('Failed to load auth token for persisted extraction feature card:', error)
        buildFeatureCard(featureCard, featureCardArea, '', workspaceId)
    }
}

// Renders persisted per-stage model output statically (reload path — no live stream).
function attachStaticStageOutputs(timelineContainer: HTMLElement, phases: PhaseView[]) {
    for (const phase of phases) {
        for (const substep of phase.substeps) {
            if (!substep.liveOutput) continue
            const sub = timelineContainer.querySelector(`.extraction-substep[data-stage="${substep.stage}"]`)
            if (!sub) continue
            const detailsEl = html`<details className="extraction-substep-output-details">
                <summary>Model output</summary>
            </details>` as HTMLElement
            detailsEl.appendChild(renderMarkdownStatic(substep.liveOutput, `persist:${substep.stage}`, 'extraction-substep-output lixpi-markdown'))
            sub.appendChild(detailsEl)
        }
    }
}

function renderPersistedExtractionState(bodyEl: HTMLElement, state: CanvasFeatureExtractionState, workspaceId: string) {
    const { timelineContainer, featureCardArea, assistantContentEl } = createExtractionConversationLayout(
        bodyEl,
        state.userText ?? 'Extract feature',
        state.aiProvider,
    )
    const phases = computeExtractionTimelineModel(state.traceEvents ?? [], state.status, false, state.stageReasoning ?? {})
    buildPhaseTimeline(phases, timelineContainer, false)
    attachStaticStageOutputs(timelineContainer, phases)
    if (state.featureCard) void renderPersistedFeatureCard(state.featureCard, featureCardArea, workspaceId)
    if (state.error) renderExtractionError(featureCardArea, `Feature extraction failed: ${state.error}`)

    // Older runs stored a single reasoning blob instead of per-stage output — surface it
    // in a fallback panel so historical reasoning is never lost.
    const hasStageReasoning = !!state.stageReasoning && Object.keys(state.stageReasoning).length > 0
    if (!hasStageReasoning && state.reasoningText) appendReasoningControls(assistantContentEl, state.reasoningText)
}

function parseFeatureCardPayload(buffer: string): any | null {
    const trimmed = buffer.trim()
    try {
        return JSON.parse(trimmed)
    } catch {}

    const startIndex = trimmed.indexOf('{"type":"feature_card"')
    const endIndex = trimmed.lastIndexOf('}')
    if (startIndex === -1 || endIndex <= startIndex) return null

    try {
        return JSON.parse(trimmed.slice(startIndex, endIndex + 1))
    } catch {
        return null
    }
}

// Called when an extraction tab submits a request.
export async function submitExtractionRequest(
    bodyEl: HTMLElement,
    extractionRunId: string,
    workspaceId: string,
    userText: string,
    ctx: ExtractionTabContext,
    persistence: ExtractionTabPersistence = {},
) {
    const aiProvider = getAiProviderFromModel(ctx.aiModel)
    const { timelineContainer, featureCardArea, assistantContentEl } = createExtractionConversationLayout(bodyEl, userText, aiProvider)
    const traceEvents: StageTraceEvent[] = []
    let currentExtractionStatus: CanvasFeatureExtractionState['status'] = 'analyzing'
    let featureCard: Record<string, any> | undefined
    let extractionError: string | undefined
    // Streamed model output keyed by stage. `currentReasoningStage` tracks the most recent
    // in-flight stage so reasoning chunks land under the right substep. Router and synthesis
    // are the only stages that stream thinking, and they never overlap, so this is unambiguous.
    const stageReasoning: Record<string, string> = {}
    let currentReasoningStage = 'router'
    let accessToken = ''
    let persistTimer: ReturnType<typeof setTimeout> | null = null
    const buildPersistedState = (): CanvasFeatureExtractionState => ({
        extractionRunId,
        status: currentExtractionStatus,
        userText,
        aiProvider,
        stageReasoning,
        featureCard,
        traceEvents,
        error: extractionError,
        updatedAt: Date.now(),
    })
    const persistNow = () => {
        if (persistTimer !== null) {
            clearTimeout(persistTimer)
            persistTimer = null
        }
        persistence.saveState?.(buildPersistedState())
    }
    const schedulePersist = () => {
        if (persistTimer !== null) return
        persistTimer = setTimeout(() => {
            persistTimer = null
            persistence.saveState?.(buildPersistedState())
        }, 600)
    }
    // Persistent per-stage markdown renderers for streamed "Model output". Each owns its
    // DOM (a <details> wrapping a MarkdownStreamRenderer) so it survives full timeline rebuilds —
    // we just re-attach it under the matching substep after every render.
    const outputs = new Map<string, { renderer: MarkdownStreamRenderer; detailsEl: HTMLDetailsElement }>()
    const ensureOutput = (stage: string) => {
        let output = outputs.get(stage)
        if (!output) {
            const renderer = new MarkdownStreamRenderer(`${extractionRunId}:${stage}`, 'extraction-substep-output lixpi-markdown')
            const detailsEl = html`<details className="extraction-substep-output-details">
                <summary>Model output</summary>
            </details>` as HTMLDetailsElement
            detailsEl.open = true
            detailsEl.appendChild(renderer.contentEl)
            output = { renderer, detailsEl }
            outputs.set(stage, output)
        }
        return output
    }
    const attachOutputs = () => {
        for (const [stage, output] of outputs) {
            const sub = timelineContainer.querySelector(`.extraction-substep[data-stage="${stage}"]`)
            if (sub && output.detailsEl.parentElement !== sub) sub.appendChild(output.detailsEl)
        }
    }
    const renderTimeline = () => {
        buildPhaseTimeline(computeExtractionTimelineModel(traceEvents, currentExtractionStatus, true, stageReasoning), timelineContainer, true)
        attachOutputs()
    }
    renderTimeline()

    // Streams a reasoning chunk into the active stage's "Model output" through the markdown
    // parser. The renderer appends incrementally, so there's no full re-render per token.
    const appendReasoning = (text: string) => {
        if (!text) return
        const stage = currentReasoningStage
        stageReasoning[stage] = (stageReasoning[stage] ?? '') + text
        const isNew = !outputs.has(stage)
        const output = ensureOutput(stage)
        if (isNew) renderTimeline()
        output.renderer.push(text)
        output.renderer.contentEl.scrollTop = output.renderer.contentEl.scrollHeight
        schedulePersist()
    }
    // Upsert by stage: the publish-only 'running' marker is replaced by its terminal
    // event, keeping one row per stage and a clean persisted trace.
    const upsertTraceEvent = (event: StageTraceEvent) => {
        const existingIndex = traceEvents.findIndex((existing) => existing.stage === event.stage)
        if (existingIndex >= 0) traceEvents[existingIndex] = event
        else traceEvents.push(event)
    }
    persistNow()

    const messages: Array<{ role: string; content: any }> = []
    if (ctx.contextMessages?.length) messages.push(...ctx.contextMessages)
    if (ctx.imageNatsUrl) {
        messages.push({ role: 'user', content: [{ type: 'input_image', image_url: ctx.imageNatsUrl }, { type: 'input_text', text: userText }] })
    } else {
        messages.push({ role: 'user', content: userText })
    }

    if (!ctx.aiModel) {
        currentExtractionStatus = 'failed'
        extractionError = 'Feature extraction could not start: no AI model is selected.'
        renderExtractionError(featureCardArea, extractionError)
        persistNow()
        return
    }

    const nats = servicesStore.getData('nats')
    if (!nats) {
        currentExtractionStatus = 'failed'
        extractionError = 'Feature extraction could not start: NATS is not connected.'
        renderExtractionError(featureCardArea, extractionError)
        persistNow()
        return
    }

    const subject = `${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${extractionRunId}`
    const errorSubject = `ai.interaction.chat.error.${workspaceId}:${extractionRunId}`
    nats.getSubscriptions?.([subject, errorSubject])?.forEach((sub: any) => sub.unsubscribe())
    let featureCardBuffer = ''
    let isCapturingFeatureCard = false
    const handleExtractionError = (error: unknown) => {
        currentExtractionStatus = 'failed'
        extractionError = String(error)
        renderTimeline()
        renderExtractionError(featureCardArea, `Feature extraction failed: ${extractionError}`)
        persistNow()
    }
    nats.subscribe(subject, (data: any) => {
        if (data?.error) {
            handleExtractionError(data.error)
            return
        }
        if (!data?.content) return
        const { content } = data
        if (content.stageTraceEvent) {
            const event = content.stageTraceEvent as StageTraceEvent
            upsertTraceEvent(event)
            if (event.status === 'running') {
                currentReasoningStage = event.stage
            } else {
                // Stage finished — flush and collapse its streamed output if it had any.
                const output = outputs.get(event.stage)
                if (output) {
                    output.renderer.finalize()
                    output.detailsEl.open = false
                }
            }
            if (event.stage === 'persist' && event.status === 'ok') currentExtractionStatus = 'completed'
            renderTimeline()
            schedulePersist()
        }
        if (content.extractionStatus) {
            currentExtractionStatus = normalizeExtractionStatus(content.extractionStatus)
            renderTimeline()
            schedulePersist()
        }
        // Feature card is delivered as structured content (not embedded in the text stream).
        if (content.featureCard) {
            featureCard = content.featureCard
            buildFeatureCard(content.featureCard, featureCardArea, accessToken, workspaceId)
            persistNow()
        }
        // Defensive: any explicit progress detail still surfaces in the reasoning panel.
        const explicitStepDetail = getExtractionDetailText(content)
        if (explicitStepDetail) appendReasoning(`${explicitStepDetail}\n`)
        if (content.status === STREAM_STATUS.STREAMING && content.text) {
            const text = String(content.text)
            if (isCapturingFeatureCard || text.trimStart().startsWith('{"type":"feature_card"')) {
                isCapturingFeatureCard = true
                featureCardBuffer += text
                const payload = parseFeatureCardPayload(featureCardBuffer)
                if (payload?.type === 'feature_card' && payload.feature) {
                    featureCard = payload.feature
                    buildFeatureCard(payload.feature, featureCardArea, accessToken, workspaceId)
                    featureCardBuffer = ''
                    isCapturingFeatureCard = false
                    persistNow()
                }
                return
            }
            appendReasoning(text)
        }
        if (content.status === STREAM_STATUS.END_STREAM) {
            if (currentExtractionStatus !== 'failed') {
                currentExtractionStatus = 'completed'
            }
            renderTimeline()
            if (featureCardBuffer && !featureCardArea.hasChildNodes() && currentExtractionStatus !== 'failed') {
                extractionError = 'Feature extraction completed, but the feature card could not be rendered.'
                renderExtractionError(featureCardArea, extractionError)
            }
            persistNow()
        }
    })
    nats.subscribe(errorSubject, (data: any) => {
        handleExtractionError(data?.error ?? data?.message ?? 'Unknown extraction error')
    })

    try {
        const token = await AuthService.getTokenSilently()
        accessToken = token || ''
        nats.publish(NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.FEATURE_EXTRACT.START, {
            token, workspaceId, organizationId: '', extractionRunId, messages,
            aiModel: ctx.aiModel,
            aiImageModel: ctx.aiImageModel,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        currentExtractionStatus = 'failed'
        extractionError = message
        renderExtractionError(featureCardArea, `Feature extraction could not start: ${message}`)
        persistNow()
    }
}

// Renders the idle body shown before user submits
export function renderExtractionTabBody(
    _tabId: string,
    extractionRunId: string,
    bodyEl: HTMLElement,
    workspaceId: string,
    persistence: ExtractionTabPersistence = {},
) {
    const persistedState = persistence.getState?.(extractionRunId)
    if (persistedState) {
        renderPersistedExtractionState(bodyEl, persistedState, workspaceId)
        return
    }

    const ctx = getPendingExtractionContext(extractionRunId) ?? {}
    const hint = ctx.imageNatsUrl
        ? 'Describe what to extract from the image — type your request in the prompt below.'
        : 'Describe what feature to extract — type your request in the prompt below.'
    bodyEl.appendChild(html`<p className="extraction-tab-idle-hint">${hint}</p>` as HTMLElement)
}
