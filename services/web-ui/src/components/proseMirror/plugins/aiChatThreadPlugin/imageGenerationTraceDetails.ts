import type {
    ImageGenerationTrace,
    ImageGenerationTraceExcludedReference,
    ImageGenerationTraceReference,
    VideoGenerationTrace,
} from '@lixpi/constants'

import AuthService from '$src/services/auth-service.ts'
import { html } from '$src/utils/domTemplates.ts'

// Image and video generation traces share an identical reference/excluded/
// resolver/prompt shape, so this renderer is reused verbatim for both media
// kinds — only the summary title differs. The video trace carries the extra
// aspectRatio/resolution/durationSeconds fields, which this renderer ignores.
export type GenerationTrace = ImageGenerationTrace | VideoGenerationTrace

export type ImageGenerationTraceDetailsAttrs = {
    title: string
    isOpen: boolean
    isStreaming: boolean
    imageGenerationTrace?: ImageGenerationTrace | null
    imageGenerationTraceId?: string | null
    videoGenerationTrace?: VideoGenerationTrace | null
    // The reasoning model that produced this generation prompt. Shown in the
    // collapsible summary (even while collapsed) so each run is attributable to
    // its model without a separate pill beside the avatar.
    reasoningModelId?: string | null
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
    getAdditionalReferenceImageSources?: (reference: ImageGenerationTraceReference) => string[]
}

export type ImageGenerationTraceDetails = {
    dom: HTMLDetailsElement
    summary: HTMLElement
    contentDom: HTMLElement
    render: (params: RenderImageGenerationTraceDetailsParams) => void
    renderReferenceGrid: (trace: GenerationTrace) => void
}

const imageGenerationTraceCache = new Map<string, ImageGenerationTrace>()

export const cacheImageGenerationTrace = (traceId: string, trace: ImageGenerationTrace): void => {
    imageGenerationTraceCache.set(traceId, trace)
}

export const getImageGenerationTrace = (attrs: ImageGenerationTraceDetailsAttrs): GenerationTrace | null => {
    if (attrs.imageGenerationTraceId) return imageGenerationTraceCache.get(attrs.imageGenerationTraceId) ?? null
    return attrs.imageGenerationTrace ?? attrs.videoGenerationTrace ?? null
}

export const getImageGenerationSummaryTitle = (attrs: ImageGenerationTraceDetailsAttrs): string => {
    if (attrs.videoGenerationTrace) return 'Video generation details'
    if (attrs.imageGenerationTrace || attrs.imageGenerationTraceId) return 'Image generation details'
    return attrs.isStreaming ? 'Preparing image generation prompt' : attrs.title
}

export const formatImageGenerationTraceRole = (role: string): string => {
    return role.split(/[-_]/).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ')
}

// Reasoning model ids arrive as `Provider:model` (e.g. `Anthropic:claude-sonnet-4-6`);
// the summary shows just the model segment.
export const formatTraceModelLabel = (modelId?: string | null): string => {
    if (!modelId) return ''
    const parts = String(modelId).split(':')
    return parts[1] || parts[0] || ''
}

const appendAuthenticatedToken = async (imageUrl: string): Promise<string> => {
    const token = await AuthService.getTokenSilently()
    if (!token) return imageUrl
    const isAbsoluteUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(imageUrl)

    try {
        const url = isAbsoluteUrl ? new URL(imageUrl) : new URL(imageUrl, window.location.origin)
        url.searchParams.set('token', token)
        if (isAbsoluteUrl) return url.toString()
        return `${url.pathname}${url.search}${url.hash}`
    } catch {
        const separator = imageUrl.includes('?') ? '&' : '?'
        return `${imageUrl}${separator}token=${encodeURIComponent(token)}`
    }
}

const buildAuthenticatedImageUrl = async (path: string): Promise<string> => {
    const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
    const sourceUrl = path.startsWith('http') || !apiBaseUrl ? path : `${apiBaseUrl}${path}`
    return appendAuthenticatedToken(sourceUrl)
}

const getReferenceWorkspaceImagePath = (reference: ImageGenerationTraceReference): string | null => {
    if (reference.fileId && reference.workspaceId) {
        return `/api/images/${encodeURIComponent(reference.workspaceId)}/${encodeURIComponent(reference.fileId)}`
    }
    return null
}

const getNatsWorkspaceImagePath = (imageUrl: string): string | null => {
    const match = /^nats-obj:\/\/workspace-(.+)-files\/(.+)$/.exec(imageUrl)
    if (!match) return null

    const [, workspaceId, objectKey] = match
    if (!workspaceId || !objectKey || objectKey.includes('/')) return null
    return `/api/images/${encodeURIComponent(workspaceId)}/${encodeURIComponent(objectKey)}`
}

const isApiHttpUrl = (imageUrl: string): boolean => {
    try {
        return new URL(imageUrl).pathname.startsWith('/api/')
    } catch {
        return imageUrl.includes('/api/')
    }
}

const uniqueImageSources = (sources: string[]): string[] => {
    const seen = new Set<string>()
    return sources.filter((source) => {
        if (!source || seen.has(source)) return false
        seen.add(source)
        return true
    })
}

const getReferenceImageSources = (
    reference: ImageGenerationTraceReference,
    options: ImageGenerationTraceDetailsOptions,
): string[] => {
    return uniqueImageSources([
        (reference.imageUrl ?? '').trim(),
        getReferenceWorkspaceImagePath(reference) ?? '',
        ...(options.getAdditionalReferenceImageSources?.(reference) ?? []),
    ])
}

const resolveReferenceImageSrc = async (imageUrl: string): Promise<string> => {
    if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) return imageUrl
    if (imageUrl.startsWith('/api/')) return buildAuthenticatedImageUrl(imageUrl)
    if (imageUrl.startsWith('http') && isApiHttpUrl(imageUrl)) {
        return appendAuthenticatedToken(imageUrl)
    }
    if (imageUrl.startsWith('http')) return imageUrl
    if (imageUrl.startsWith('nats-obj://')) {
        const path = getNatsWorkspaceImagePath(imageUrl)
        return path ? buildAuthenticatedImageUrl(path) : ''
    }
    return imageUrl
}

const resolveReferenceImageSources = async (
    reference: ImageGenerationTraceReference,
    options: ImageGenerationTraceDetailsOptions,
): Promise<string[]> => {
    const resolvedSources: string[] = []
    for (const source of getReferenceImageSources(reference, options)) {
        const resolvedSource = await resolveReferenceImageSrc(source)
        if (resolvedSource) resolvedSources.push(resolvedSource)
    }
    return uniqueImageSources(resolvedSources)
}

const createReferenceTile = (
    reference: ImageGenerationTraceReference,
    options: ImageGenerationTraceDetailsOptions,
): HTMLElement => {
    const role = formatImageGenerationTraceRole(reference.role)
    // The tile starts hidden and reveals itself in `onload` (so the multi-source
    // retry chain never flashes a broken image). `loading="lazy"` must NOT be used
    // here: a hidden image is `display:none`, never intersects the viewport, so a
    // lazy image would never load — `onload` would never fire and the tile would
    // stay blank. Eager loading loads regardless of visibility.
    const image = html`<img className="ai-image-generation-reference-image" alt=${reference.label} />` as HTMLImageElement
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

    image.hidden = true
    unavailable.hidden = true
    let sourceIndex = 0
    let resolvedSourcesPromise: Promise<string[]> | null = null

    const getResolvedSources = (): Promise<string[]> => {
        resolvedSourcesPromise ??= resolveReferenceImageSources(reference, options)
        return resolvedSourcesPromise
    }

    const showUnavailable = () => {
        image.hidden = true
        unavailable.hidden = false
        tile.classList.add('is-unavailable')
    }

    image.onload = () => {
        image.hidden = false
        unavailable.hidden = true
        tile.classList.remove('is-unavailable')
    }
    image.onerror = () => {
        const retryNextSource = async () => {
            sourceIndex += 1
            const sources = await getResolvedSources()
            const nextSource = sources[sourceIndex]
            if (nextSource) {
                image.src = nextSource
                return
            }
            showUnavailable()
        }
        retryNextSource().catch(showUnavailable)
    }
    const loadImage = async () => {
        try {
            const sources = await getResolvedSources()
            const src = sources[sourceIndex]
            if (!src) {
                showUnavailable()
                return
            }
            image.src = src
        } catch {
            showUnavailable()
        }
    }

    const resetImage = () => {
        sourceIndex = 0
        image.hidden = true
        unavailable.hidden = true
        tile.classList.remove('is-unavailable')
    }

    resetImage()
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
                    <div className="ai-image-generation-section-label">Final prompt sent to the model</div>
                    <pre className="ai-image-generation-final-prompt"></pre>
                </section>
                <section className="ai-image-generation-reference-section">
                    <div className="ai-image-generation-section-label">Reference images sent to the model</div>
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
    let renderedTrace: GenerationTrace | null = null
    let renderedReferenceTrace: GenerationTrace | null = null

    const renderReferenceGrid = (trace: GenerationTrace) => {
        if (renderedReferenceTrace === trace) return

        if (trace.referenceImages.length > 0) {
            referenceGrid.replaceChildren(...trace.referenceImages.map((reference) => createReferenceTile(reference, options)))
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
        const modelLabel = formatTraceModelLabel(attrs.reasoningModelId)
        const referenceMeta = trace
            ? `${trace.referenceImages.length} reference${trace.referenceImages.length === 1 ? '' : 's'}`
            : ''
        summaryMeta.textContent = [modelLabel, referenceMeta].filter(Boolean).join(' · ')
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
