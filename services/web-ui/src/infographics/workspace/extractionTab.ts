'use strict'

import { html, applyStyle } from '$src/utils/domTemplates.ts'
import { NATS_SUBJECTS, AI_INTERACTION_CONSTANTS, type CanvasFeatureExtractionState, type StageTraceEvent } from '@lixpi/constants'
import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'
import { select } from 'd3-selection'
import { aiRobotFaceIcon, claudeIcon, geminiIcon, gptAvatarIcon, stabilityIcon } from '$src/svgIcons/index.ts'

const { STREAM_STATUS } = AI_INTERACTION_CONSTANTS
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

type ExtractionStep = {
    key: string
    label: string
    detail: string
}

type ExtractionStepDetails = Map<string, string>

const EXTRACTION_STEPS: ExtractionStep[] = [
    { key: 'analyzing', label: 'Analyze input', detail: 'Reading the prompt and source context.' },
    { key: 'extracting', label: 'Extract feature', detail: 'Distilling the reusable visual pattern.' },
    { key: 'generating_samples', label: 'Generate samples', detail: 'Creating previews to validate the feature.' },
    { key: 'saving', label: 'Save to library', detail: 'Writing the feature to your workspace library.' },
]

const EXTRACTION_STATUS_ORDER = ['pending', 'analyzing', 'extracting', 'generating_samples', 'saving', 'completed']
const TIMELINE_ROW_HEIGHT = 76
const TIMELINE_ROOT_X = 20
const TIMELINE_GUIDE_WIDTH = 40
const TIMELINE_ROW_CENTER_Y = 18

const pendingContexts = new Map<string, ExtractionTabContext>()

export function setPendingExtractionContext(extractionRunId: string, ctx: ExtractionTabContext) {
    pendingContexts.set(extractionRunId, ctx)
}

export function getPendingExtractionContext(extractionRunId: string): ExtractionTabContext | undefined {
    return pendingContexts.get(extractionRunId)
}

function getTimelineActiveIndex(currentStatus: string): number {
    if (currentStatus === 'completed') return EXTRACTION_STEPS.length - 1
    const stepIndex = EXTRACTION_STEPS.findIndex((step) => step.key === currentStatus)
    return stepIndex === -1 ? 0 : stepIndex
}

function getTimelineStepY(stepIndex: number): number {
    return stepIndex * TIMELINE_ROW_HEIGHT + TIMELINE_ROW_CENTER_Y
}

function getStepKeyForStatus(currentStatus: string): string {
    return EXTRACTION_STEPS[getTimelineActiveIndex(currentStatus)]?.key ?? EXTRACTION_STEPS[0].key
}

function appendStepDetail(stepDetails: ExtractionStepDetails, currentStatus: string, text: string): void {
    if (!text) return

    const stepKey = getStepKeyForStatus(currentStatus)
    const currentText = stepDetails.get(stepKey) ?? ''
    stepDetails.set(stepKey, `${currentText}${text}`)
}

function getExtractionDetailText(content: any): string {
    const detailText = content.extractionDetail ?? content.stepDetail ?? content.statusDetail ?? content.reasoning
    return typeof detailText === 'string' ? detailText : ''
}

function normalizeExtractionStatus(status: any): CanvasFeatureExtractionState['status'] {
    const statusText = typeof status === 'string' ? status : 'analyzing'
    if (statusText === 'failed') return 'failed'
    return EXTRACTION_STATUS_ORDER.includes(statusText) ? statusText as CanvasFeatureExtractionState['status'] : 'analyzing'
}

function createStepDetailsMap(stepDetails: Record<string, string> | undefined): ExtractionStepDetails {
    const detailsMap: ExtractionStepDetails = new Map()
    if (!stepDetails) return detailsMap

    for (const step of EXTRACTION_STEPS) {
        const detailText = stepDetails[step.key]
        if (typeof detailText === 'string' && detailText) detailsMap.set(step.key, detailText)
    }

    return detailsMap
}

function serializeStepDetails(stepDetails: ExtractionStepDetails): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [stepKey, detailText] of stepDetails) {
        if (detailText) result[stepKey] = detailText
    }
    return result
}

function renderTimelineGuide(listEl: HTMLOListElement, currentStatus: string) {
    const activeIndex = getTimelineActiveIndex(currentStatus)
    const lastIndex = EXTRACTION_STEPS.length - 1
    const firstY = getTimelineStepY(0)
    const lastY = getTimelineStepY(lastIndex)
    const activeY = getTimelineStepY(activeIndex)
    const svgHeight = lastY + TIMELINE_ROW_CENTER_Y

    const svg = select(listEl)
        .append('svg')
        .attr('class', 'extraction-timeline__guide')
        .attr('width', TIMELINE_GUIDE_WIDTH)
        .attr('height', svgHeight)
        .attr('viewBox', `0 0 ${TIMELINE_GUIDE_WIDTH} ${svgHeight}`)
        .attr('preserveAspectRatio', 'xMinYMin meet')

    svg.append('line')
        .attr('class', 'extraction-timeline__path extraction-timeline__path--muted')
        .attr('x1', TIMELINE_ROOT_X).attr('y1', firstY)
        .attr('x2', TIMELINE_ROOT_X).attr('y2', lastY)

    if (activeIndex > 0 || currentStatus === 'completed') {
        svg.append('line')
            .attr('class', 'extraction-timeline__path extraction-timeline__path--active')
            .attr('x1', TIMELINE_ROOT_X).attr('y1', firstY)
            .attr('x2', TIMELINE_ROOT_X).attr('y2', activeY)
    }

    EXTRACTION_STEPS.forEach((_step, stepIndex) => {
        const isCompleted = currentStatus === 'completed'
        const isDone = isCompleted || stepIndex < activeIndex
        const isActive = !isCompleted && stepIndex === activeIndex
        svg.append('circle')
            .attr('class', `extraction-timeline__dot${isDone ? ' extraction-timeline__dot--done' : ''}${isActive ? ' extraction-timeline__dot--active' : ''}`)
            .attr('cx', TIMELINE_ROOT_X)
            .attr('cy', getTimelineStepY(stepIndex))
            .attr('r', 7)

        if (isActive) {
            svg.append('circle')
                .attr('class', 'extraction-timeline__dot-core')
                .attr('cx', TIMELINE_ROOT_X)
                .attr('cy', getTimelineStepY(stepIndex))
                .attr('r', 3.5)
        }
    })
}

function formatStageLabel(stage: string): string {
    // Turns "extractor:palette" → "Extractor • palette", "router" → "Stage 1 — Router", etc.
    const stageMap: Record<string, string> = {
        'router': 'Stage 1 — Scene Assessment & Router',
        'extractors': 'Stage 2 — Parallel Extractors',
        'crops': 'Stage 3 — Source Crop Materialization',
        'synthesis': 'Stage 4 — Dominance-Weighted Synthesis',
        'samples': 'Stage 5 — Sample Generation',
        'persist': 'Stage 6 — Persist + Publish',
    }
    if (stageMap[stage]) return stageMap[stage]
    if (stage.startsWith('extractor:')) return `Extractor • ${stage.slice('extractor:'.length)}`
    if (stage.startsWith('sample:')) return `Sample • ${stage.slice('sample:'.length)}`
    return stage
}

function formatStageDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60_000).toFixed(1)}min`
}

function buildStageTimeline(
    traceEvents: StageTraceEvent[],
    containerEl: HTMLElement,
    currentStatus: string,
): void {
    containerEl.replaceChildren()

    if (traceEvents.length === 0) {
        const statusLabel = currentStatus === 'failed' ? 'Extraction failed' : 'Waiting for the pipeline to start…'
        containerEl.appendChild(html`<p className="extraction-stage-timeline__empty">${statusLabel}</p>` as HTMLElement)
        return
    }

    const listEl = html`<ol className="extraction-stage-timeline"></ol>` as HTMLOListElement
    for (const event of traceEvents) {
        const statusClass = event.status === 'ok'
            ? 'extraction-stage-timeline__row--ok'
            : event.status === 'error'
                ? 'extraction-stage-timeline__row--error'
                : 'extraction-stage-timeline__row--skipped'
        const itemEl = html`<li className=${`extraction-stage-timeline__row ${statusClass}`}>
            <div className="extraction-stage-timeline__header">
                <span className="extraction-stage-timeline__stage">${formatStageLabel(event.stage)}</span>
                <span className="extraction-stage-timeline__model">${event.modelName ?? '—'}</span>
                <span className="extraction-stage-timeline__duration">${formatStageDuration(event.durationMs)}</span>
                <span className=${`extraction-stage-timeline__status extraction-stage-timeline__status--${event.status}`}>${event.status}</span>
            </div>
            <div className="extraction-stage-timeline__summary">${event.outputSummary ?? event.inputSummary ?? ''}</div>
        </li>` as HTMLLIElement
        if (event.errorMessage) {
            itemEl.appendChild(html`<div className="extraction-stage-timeline__error">${event.errorMessage}</div>` as HTMLElement)
        }
        if (event.promptPreview) {
            const detailsEl = html`<details className="extraction-stage-timeline__details">
                <summary>Prompt preview</summary>
                <pre className="extraction-stage-timeline__preview">${event.promptPreview}</pre>
            </details>` as HTMLElement
            itemEl.appendChild(detailsEl)
        }
        listEl.appendChild(itemEl)
    }
    containerEl.appendChild(listEl)
}

function buildStepTimeline(
    currentStatus: string,
    containerEl: HTMLElement,
    stepDetails: ExtractionStepDetails = new Map(),
) {
    const currentIndex = EXTRACTION_STATUS_ORDER.indexOf(currentStatus)
    const normalizedCurrentIndex = currentIndex === -1 ? 0 : currentIndex
    const listEl = html`<ol className="extraction-timeline"></ol>` as HTMLOListElement

    for (const step of EXTRACTION_STEPS) {
        const stepIndex = EXTRACTION_STATUS_ORDER.indexOf(step.key)
        const isDone = currentStatus === 'completed' || normalizedCurrentIndex > stepIndex
        const isActive = step.key === currentStatus && currentStatus !== 'completed'
        const detailText = stepDetails.get(step.key)?.trim() ?? ''
        const itemEl = html`<li className=${`extraction-timeline__item${isDone ? ' extraction-timeline__item--done' : ''}${isActive ? ' extraction-timeline__item--active' : ''}`}>
            <span className="extraction-timeline__content">
                <span className="extraction-timeline__label">${step.label}</span>
                <span className="extraction-timeline__detail">${step.detail}</span>
                <span className="extraction-timeline__live-details">${detailText || 'Waiting for live details.'}</span>
            </span>
        </li>` as HTMLLIElement
        listEl.appendChild(itemEl)
    }
    renderTimelineGuide(listEl, currentStatus)
    containerEl.replaceChildren(listEl)
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
        <div className="extraction-feature-card__eyebrow">Saved Feature</div>
        <div className="extraction-feature-card__header">
            <span className="extraction-feature-card__category-badge">${feature.category}</span>
            <strong className="extraction-feature-card__name">@${feature.name}</strong>
            <span className="extraction-feature-card__scope-chip">${feature.scope ?? 'workspace'}</span>
        </div>
        <p className="extraction-feature-card__summary">${feature.summary}</p>
        <div className="extraction-feature-card__tags"></div>
        <div className="extraction-feature-card__samples"></div>
    </div>` as HTMLElement
    const tagsEl = cardEl.querySelector('.extraction-feature-card__tags') as HTMLElement
    for (const tag of (feature.tags ?? [])) {
        tagsEl.appendChild(html`<span className="extraction-feature-card__tag">${tag}</span>` as HTMLElement)
    }
    const samplesEl = cardEl.querySelector('.extraction-feature-card__samples') as HTMLElement
    for (const sample of (feature.sampleImages ?? [])) {
        const thumbStyle = { width: '100%', aspectRatio: '3 / 2', objectFit: 'contain' as const, borderRadius: '6px' }
        samplesEl.appendChild(html`<img className="extraction-feature-card__sample-thumb" style=${thumbStyle} src=${getFeatureSampleUrl(feature, sample, accessToken, workspaceId)} alt=${sample.subject} />` as HTMLElement)
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

function appendReasoningControls(bodyEl: HTMLElement, initialText = ''): { panelEl: HTMLElement; getText: () => string; openIfClosed: () => void } {
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

    return {
        panelEl: reasoningPanel,
        getText: () => reasoningPanel.textContent ?? '',
        // Auto-opens the panel the first time live reasoning arrives so the user
        // can see streaming tokens without clicking the toggle.
        openIfClosed: () => {
            if (reasoningPanel.style.display !== 'none') return
            applyStyle(reasoningPanel, { display: 'block' })
            reasoningToggle.textContent = '▼ Agent reasoning'
        },
    }
}

async function renderPersistedFeatureCard(featureCard: Record<string, any>, featureCardArea: HTMLElement, workspaceId: string) {
    try {
        const accessToken = await AuthService.getTokenSilently()
        buildFeatureCard(featureCard, featureCardArea, accessToken, workspaceId)
    } catch (error) {
        console.warn('Failed to load auth token for persisted extraction feature card:', error)
        buildFeatureCard(featureCard, featureCardArea, '', workspaceId)
    }
}

function renderPersistedExtractionState(bodyEl: HTMLElement, state: CanvasFeatureExtractionState, workspaceId: string) {
    const { timelineContainer, featureCardArea, assistantContentEl } = createExtractionConversationLayout(
        bodyEl,
        state.userText ?? 'Extract feature',
        state.aiProvider,
    )
    buildStageTimeline(state.traceEvents ?? [], timelineContainer, state.status)
    if (state.featureCard) void renderPersistedFeatureCard(state.featureCard, featureCardArea, workspaceId)
    if (state.error) renderExtractionError(featureCardArea, `Feature extraction failed: ${state.error}`)

    appendReasoningControls(assistantContentEl, state.reasoningText ?? '')
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
    const stepDetails: ExtractionStepDetails = new Map()
    const traceEvents: StageTraceEvent[] = []
    let currentExtractionStatus: CanvasFeatureExtractionState['status'] = 'analyzing'
    let featureCard: Record<string, any> | undefined
    let extractionError: string | undefined
    let reasoningText = ''
    let accessToken = ''
    let persistTimer: ReturnType<typeof setTimeout> | null = null
    const buildPersistedState = (): CanvasFeatureExtractionState => ({
        extractionRunId,
        status: currentExtractionStatus,
        userText,
        aiProvider,
        stepDetails: serializeStepDetails(stepDetails),
        reasoningText,
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
    const renderTimeline = () => buildStageTimeline(traceEvents, timelineContainer, currentExtractionStatus)
    renderTimeline()

    const reasoningControls = appendReasoningControls(assistantContentEl)
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
            traceEvents.push(event)
            if (event.stage === 'persist' && event.status === 'ok') currentExtractionStatus = 'completed'
            renderTimeline()
            schedulePersist()
        }
        if (content.extractionStatus) {
            currentExtractionStatus = normalizeExtractionStatus(content.extractionStatus)
            renderTimeline()
            schedulePersist()
        }
        const explicitStepDetail = getExtractionDetailText(content)
        if (explicitStepDetail) {
            appendStepDetail(stepDetails, currentExtractionStatus, `${explicitStepDetail}\n`)
            schedulePersist()
        }
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
            appendStepDetail(stepDetails, currentExtractionStatus, text)
            reasoningText += text
            reasoningControls.openIfClosed()
            reasoningControls.panelEl.insertAdjacentText('beforeend', text)
            schedulePersist()
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
        accessToken = token
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
