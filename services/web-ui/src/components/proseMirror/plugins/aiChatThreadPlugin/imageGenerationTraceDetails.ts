import type {
    ImageGenerationTrace,
    ImageGenerationTraceExcludedReference,
    ImageGenerationTraceReference,
} from '@lixpi/constants'

import AuthService from '$src/services/auth-service.ts'
import { html } from '$src/utils/domTemplates.ts'

export type ImageGenerationTraceDetailsAttrs = {
    title: string
    isOpen: boolean
    isStreaming: boolean
    imageGenerationTrace?: ImageGenerationTrace | null
    imageGenerationTraceId?: string | null
}

type RenderImageGenerationTraceDetailsParams = {
    attrs: ImageGenerationTraceDetailsAttrs
    childCount: number
    forceToolPromptFallback?: boolean
    toolPromptFallbackText?: string
}

type ImageGenerationTraceDetailsOptions = {
    className?: string
    renderReferencesWhenClosed?: boolean
}

export type ImageGenerationTraceDetails = {
    dom: HTMLDetailsElement
    summary: HTMLElement
    contentDom: HTMLElement
    render: (params: RenderImageGenerationTraceDetailsParams) => void
    renderReferenceGrid: (trace: ImageGenerationTrace) => void
}

const imageGenerationTraceCache = new Map<string, ImageGenerationTrace>()

export const cacheImageGenerationTrace = (traceId: string, trace: ImageGenerationTrace): void => {
    imageGenerationTraceCache.set(traceId, trace)
}

export const getImageGenerationTrace = (attrs: ImageGenerationTraceDetailsAttrs): ImageGenerationTrace | null => {
    if (attrs.imageGenerationTraceId) return imageGenerationTraceCache.get(attrs.imageGenerationTraceId) ?? null
    return attrs.imageGenerationTrace ?? null
}

export const getImageGenerationSummaryTitle = (attrs: ImageGenerationTraceDetailsAttrs): string => {
    if (attrs.imageGenerationTrace || attrs.imageGenerationTraceId) return 'Image generation details'
    return attrs.isStreaming ? 'Preparing image generation prompt' : attrs.title
}

export const formatImageGenerationTraceRole = (role: string): string => {
    return role.split(/[-_]/).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ')
}

const buildAuthenticatedImageUrl = async (path: string): Promise<string> => {
    const token = await AuthService.getTokenSilently()
    const API_BASE_URL = import.meta.env.VITE_API_URL || ''
    const separator = path.includes('?') ? '&' : '?'
    return `${API_BASE_URL}${path}${token ? `${separator}token=${encodeURIComponent(token)}` : ''}`
}

const getNatsWorkspaceImagePath = (imageUrl: string, reference: ImageGenerationTraceReference): string | null => {
    if (reference.fileId && reference.workspaceId) {
        return `/api/images/${encodeURIComponent(reference.workspaceId)}/${encodeURIComponent(reference.fileId)}`
    }

    const match = /^nats-obj:\/\/workspace-(.+)-files\/(.+)$/.exec(imageUrl)
    if (!match) return null

    const [, workspaceId, objectKey] = match
    if (!workspaceId || !objectKey || objectKey.includes('/')) return null
    return `/api/images/${encodeURIComponent(workspaceId)}/${encodeURIComponent(objectKey)}`
}

const resolveReferenceImageSrc = async (reference: ImageGenerationTraceReference): Promise<string> => {
    const imageUrl = reference.imageUrl
    if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) return imageUrl
    if (imageUrl.startsWith('/api/')) return buildAuthenticatedImageUrl(imageUrl)
    if (imageUrl.startsWith('http') && imageUrl.includes('/api/images/')) {
        const stripped = imageUrl.replace(/[?&]token=[^&]+/, '')
        const token = await AuthService.getTokenSilently()
        return `${stripped}${token ? `?token=${encodeURIComponent(token)}` : ''}`
    }
    if (imageUrl.startsWith('http')) return imageUrl
    if (imageUrl.startsWith('nats-obj://')) {
        const path = getNatsWorkspaceImagePath(imageUrl, reference)
        return path ? buildAuthenticatedImageUrl(path) : ''
    }
    return imageUrl
}

const createReferenceTile = (reference: ImageGenerationTraceReference): HTMLElement => {
    const role = formatImageGenerationTraceRole(reference.role)
    const image = html`<img className="ai-image-generation-reference-image" alt=${reference.label} loading="lazy" />` as HTMLImageElement
    const unavailable = html`<span className="ai-image-generation-reference-unavailable">Unavailable</span>` as HTMLSpanElement
    const tile = html`
        <figure className="ai-image-generation-reference" data=${{ source: reference.source, role: reference.role }}>
            <div className="ai-image-generation-reference-thumb">
                ${image}
                ${unavailable}
            </div>
            <figcaption>
                <span className="ai-image-generation-reference-label">${reference.label}</span>
                <span className="ai-image-generation-reference-role">${role}</span>
            </figcaption>
        </figure>
    ` as HTMLElement

    unavailable.hidden = true
    image.onerror = () => {
        image.hidden = true
        unavailable.hidden = false
        tile.classList.add('is-unavailable')
    }
    const loadImage = async () => {
        try {
            const src = await resolveReferenceImageSrc(reference)
            if (!src) {
                image.hidden = true
                unavailable.hidden = false
                tile.classList.add('is-unavailable')
                return
            }
            image.src = src
        } catch {
            image.hidden = true
            unavailable.hidden = false
            tile.classList.add('is-unavailable')
        }
    }

    void loadImage()

    return tile
}

const createExcludedItem = (reference: ImageGenerationTraceExcludedReference): HTMLElement => {
    return html`
        <li className="ai-image-generation-excluded-reference">
            <span className="ai-image-generation-excluded-label">${reference.label}</span>
            <span className="ai-image-generation-excluded-node">${reference.nodeId}</span>
            <span className="ai-image-generation-excluded-reason">${reference.reason}</span>
        </li>
    ` as HTMLElement
}

export function createImageGenerationTraceDetails(options: ImageGenerationTraceDetailsOptions = {}): ImageGenerationTraceDetails {
    const className = ['ai-collapsible-block', options.className].filter(Boolean).join(' ')
    const wrapper = html`
        <details className=${className}>
            <summary>
                <span className="ai-collapsible-block-summary-title"></span>
                <span className="ai-collapsible-block-summary-meta"></span>
            </summary>
            <div className="ai-collapsible-block-body">
                <section className="ai-image-generation-tool-prompt-section">
                    <div className="ai-image-generation-section-label">Prompt written by chat model</div>
                    <div className="ai-collapsible-block-content"></div>
                    <pre className="ai-image-generation-tool-prompt-fallback"></pre>
                </section>
                <section className="ai-image-generation-final-prompt-section">
                    <div className="ai-image-generation-section-label">Final prompt sent to image model</div>
                    <pre className="ai-image-generation-final-prompt"></pre>
                </section>
                <section className="ai-image-generation-reference-section">
                    <div className="ai-image-generation-section-label">Reference images sent to image model</div>
                    <div className="ai-image-generation-reference-grid"></div>
                </section>
                <section className="ai-image-generation-resolver-section">
                    <div className="ai-image-generation-section-label">Resolver audit</div>
                    <div className="ai-image-generation-resolver-summary"></div>
                    <div className="ai-image-generation-resolver-rationale"></div>
                    <ul className="ai-image-generation-excluded-list"></ul>
                </section>
            </div>
        </details>
    ` as HTMLDetailsElement

    const summary = wrapper.querySelector('summary')!
    const summaryTitle = wrapper.querySelector('.ai-collapsible-block-summary-title') as HTMLElement
    const summaryMeta = wrapper.querySelector('.ai-collapsible-block-summary-meta') as HTMLElement
    const contentDom = wrapper.querySelector('.ai-collapsible-block-content') as HTMLElement
    const toolPromptSection = wrapper.querySelector('.ai-image-generation-tool-prompt-section') as HTMLElement
    const toolPromptFallback = wrapper.querySelector('.ai-image-generation-tool-prompt-fallback') as HTMLElement
    const finalPromptSection = wrapper.querySelector('.ai-image-generation-final-prompt-section') as HTMLElement
    const finalPrompt = wrapper.querySelector('.ai-image-generation-final-prompt') as HTMLElement
    const referenceSection = wrapper.querySelector('.ai-image-generation-reference-section') as HTMLElement
    const referenceGrid = wrapper.querySelector('.ai-image-generation-reference-grid') as HTMLElement
    const resolverSection = wrapper.querySelector('.ai-image-generation-resolver-section') as HTMLElement
    const resolverSummary = wrapper.querySelector('.ai-image-generation-resolver-summary') as HTMLElement
    const resolverRationale = wrapper.querySelector('.ai-image-generation-resolver-rationale') as HTMLElement
    const excludedList = wrapper.querySelector('.ai-image-generation-excluded-list') as HTMLElement

    let renderedSignature = ''
    let renderedTrace: ImageGenerationTrace | null = null
    let renderedReferenceTrace: ImageGenerationTrace | null = null

    const renderReferenceGrid = (trace: ImageGenerationTrace) => {
        if (renderedReferenceTrace === trace) return

        if (trace.referenceImages.length > 0) {
            referenceGrid.replaceChildren(...trace.referenceImages.map(createReferenceTile))
        } else {
            referenceGrid.replaceChildren(html`
                <div className="ai-image-generation-empty-references">No reference images were sent.</div>
            `)
        }
        renderedReferenceTrace = trace
    }

    const render = ({
        attrs,
        childCount,
        forceToolPromptFallback = false,
        toolPromptFallbackText,
    }: RenderImageGenerationTraceDetailsParams) => {
        const trace = getImageGenerationTrace(attrs)
        const hasTrace = Boolean(trace)
        const fallbackText = toolPromptFallbackText ?? trace?.toolPrompt ?? ''
        const signature = [
            attrs.title,
            attrs.isStreaming ? 'streaming' : 'done',
            childCount,
            attrs.imageGenerationTraceId ?? 'inline-trace',
            forceToolPromptFallback ? 'force-fallback' : 'content-fallback',
            fallbackText,
        ].join('|')

        if (signature === renderedSignature && trace === renderedTrace) {
            if (trace && (wrapper.open || options.renderReferencesWhenClosed)) renderReferenceGrid(trace)
            return
        }

        renderedSignature = signature
        renderedTrace = trace

        summaryTitle.textContent = getImageGenerationSummaryTitle(attrs)
        summaryMeta.textContent = trace
            ? `${trace.referenceImages.length} reference${trace.referenceImages.length === 1 ? '' : 's'}`
            : ''
        wrapper.classList.toggle('has-image-generation-trace', hasTrace)
        wrapper.classList.toggle('is-streaming', attrs.isStreaming)
        toolPromptSection.classList.toggle('has-trace', hasTrace)

        const shouldShowFallback = Boolean(fallbackText && (forceToolPromptFallback || childCount === 0))
        toolPromptFallback.textContent = shouldShowFallback ? fallbackText : ''
        toolPromptFallback.hidden = !shouldShowFallback

        const shouldShowFinalPrompt = Boolean(trace?.promptWasChanged && trace.finalPrompt.trim())
        finalPromptSection.hidden = !shouldShowFinalPrompt
        finalPrompt.textContent = shouldShowFinalPrompt ? trace!.finalPrompt : ''

        referenceSection.hidden = !hasTrace
        if (!trace) {
            referenceGrid.replaceChildren()
            renderedReferenceTrace = null
        } else if (wrapper.open || options.renderReferencesWhenClosed) {
            renderReferenceGrid(trace)
        }

        const resolver = trace?.resolver
        const hasExcluded = Boolean(trace?.excludedReferences.length)
        resolverSection.hidden = !resolver && !hasExcluded
        resolverSummary.textContent = resolver
            ? `${formatImageGenerationTraceRole(resolver.operationKind)} | ${formatImageGenerationTraceRole(resolver.mode)} | confidence ${Math.round(resolver.confidence * 100)}%`
            : ''
        resolverRationale.textContent = resolver?.rationale ?? ''
        excludedList.replaceChildren(...(trace?.excludedReferences ?? []).map(createExcludedItem))
        excludedList.hidden = !hasExcluded
    }

    return {
        dom: wrapper,
        summary,
        contentDom,
        render,
        renderReferenceGrid,
    }
}
