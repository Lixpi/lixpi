import type {
    ImageGenerationTrace,
    ImageGenerationTraceExcludedReference,
    ImageGenerationTraceReference,
} from '@lixpi/constants'

import AuthService from '$src/services/auth-service.ts'
import { html } from '$src/utils/domTemplates.ts'

export const aiCollapsibleBlockNodeType = 'aiCollapsibleBlock'

export const aiCollapsibleBlockNodeSpec = {
    attrs: {
        title: { default: 'Image generation prompt' },
        isOpen: { default: false },
        isStreaming: { default: true },
        imageGenerationTrace: { default: null },
        imageGenerationTraceId: { default: null },
    },
    content: '(paragraph | block)*',
    group: 'block',
    draggable: false,
    parseDOM: [
        {
            tag: 'details.ai-collapsible-block',
            getAttrs(dom: HTMLDetailsElement) {
                const summary = dom.querySelector('summary')
                return {
                    title: summary?.textContent || 'Image generation prompt',
                    isOpen: dom.open,
                    isStreaming: false,
                    imageGenerationTrace: null,
                    imageGenerationTraceId: null,
                }
            },
        },
    ],
    toDOM(node: any) {
        return [
            'details',
            {
                class: `ai-collapsible-block${node.attrs.isStreaming ? ' is-streaming' : ''}`,
                ...(node.attrs.isOpen ? { open: 'true' } : {}),
            },
            ['summary', {}, getSummaryTitle(node.attrs)],
            ['div', { class: 'ai-collapsible-block-body' }, ['div', { class: 'ai-collapsible-block-content' }, 0]],
        ]
    },
}

type AiCollapsibleBlockAttrs = {
    title: string
    isOpen: boolean
    isStreaming: boolean
    imageGenerationTrace?: ImageGenerationTrace | null
    imageGenerationTraceId?: string | null
}

const imageGenerationTraceCache = new Map<string, ImageGenerationTrace>()

export const cacheImageGenerationTrace = (traceId: string, trace: ImageGenerationTrace): void => {
    imageGenerationTraceCache.set(traceId, trace)
}

const getImageGenerationTrace = (attrs: AiCollapsibleBlockAttrs): ImageGenerationTrace | null => {
    if (attrs.imageGenerationTraceId) return imageGenerationTraceCache.get(attrs.imageGenerationTraceId) ?? null
    return attrs.imageGenerationTrace ?? null
}

const getSummaryTitle = (attrs: AiCollapsibleBlockAttrs): string => {
    if (attrs.imageGenerationTrace || attrs.imageGenerationTraceId) return 'Image generation details'
    return attrs.isStreaming ? 'Preparing image generation prompt' : attrs.title
}

const formatRole = (role: string): string => {
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
    const role = formatRole(reference.role)
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

export const aiCollapsibleBlockNodeView = (node: any, view: any, getPos: () => number | undefined) => {
    const wrapper = html`
        <details className="ai-collapsible-block${node.attrs.isStreaming ? ' is-streaming' : ''}">
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
    const contentDom = wrapper.querySelector('.ai-collapsible-block-content')!
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

    const handleSummaryMouseDown = (event: MouseEvent) => {
        // Prevent the parent thread's mousedown focus handler from stealing the interaction.
        event.preventDefault()
        event.stopPropagation()
    }

    const handleSummaryClick = (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()

        const pos = getPos()
        if (pos === undefined) return

        const newOpen = !wrapper.open
        wrapper.open = newOpen
        if (newOpen) renderTrace(node)

        const tr = view.state.tr.setNodeMarkup(pos, undefined, {
            ...view.state.doc.nodeAt(pos)?.attrs,
            isOpen: newOpen,
        })
        view.dispatch(tr)
    }

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

    const renderTrace = (currentNode: any) => {
        const attrs = currentNode.attrs as AiCollapsibleBlockAttrs
        const trace = getImageGenerationTrace(attrs)
        const hasTrace = Boolean(trace)
        const signature = [
            attrs.title,
            attrs.isStreaming ? 'streaming' : 'done',
            currentNode.childCount,
            attrs.imageGenerationTraceId ?? 'inline-trace',
        ].join('|')

        if (signature === renderedSignature && trace === renderedTrace) {
            if (trace && wrapper.open) renderReferenceGrid(trace)
            return
        }

        renderedSignature = signature
        renderedTrace = trace

        summaryTitle.textContent = getSummaryTitle(attrs)
        summaryMeta.textContent = trace
            ? `${trace.referenceImages.length} reference${trace.referenceImages.length === 1 ? '' : 's'}`
            : ''
        wrapper.classList.toggle('has-image-generation-trace', hasTrace)
        toolPromptSection.classList.toggle('has-trace', hasTrace)

        toolPromptFallback.textContent = trace?.toolPrompt ?? ''
        toolPromptFallback.hidden = !trace?.toolPrompt || currentNode.childCount > 0

        const shouldShowFinalPrompt = Boolean(trace?.promptWasChanged && trace.finalPrompt.trim())
        finalPromptSection.hidden = !shouldShowFinalPrompt
        finalPrompt.textContent = shouldShowFinalPrompt ? trace!.finalPrompt : ''

        referenceSection.hidden = !hasTrace
        if (!trace) {
            referenceGrid.replaceChildren()
            renderedReferenceTrace = null
        } else if (wrapper.open) {
            renderReferenceGrid(trace)
        }

        const resolver = trace?.resolver
        const hasExcluded = Boolean(trace?.excludedReferences.length)
        resolverSection.hidden = !resolver && !hasExcluded
        resolverSummary.textContent = resolver
            ? `${formatRole(resolver.operationKind)} | ${formatRole(resolver.mode)} | confidence ${Math.round(resolver.confidence * 100)}%`
            : ''
        resolverRationale.textContent = resolver?.rationale ?? ''
        excludedList.replaceChildren(...(trace?.excludedReferences ?? []).map(createExcludedItem))
        excludedList.hidden = !hasExcluded
    }

    if (node.attrs.isOpen) {
        wrapper.open = true
    }

    renderTrace(node)

    summary.addEventListener('mousedown', handleSummaryMouseDown)
    summary.addEventListener('click', handleSummaryClick)

    return {
        dom: wrapper,
        contentDOM: contentDom,
        stopEvent(event: Event) {
            return event.target === summary || summary.contains(event.target as Node)
        },
        ignoreMutation(mutation: MutationRecord) {
            if (mutation.type === 'attributes'
                && mutation.attributeName === 'open'
                && mutation.target === wrapper) return true

            const target = mutation.target as Node
            return target !== contentDom && !contentDom.contains(target)
        },
        update(updatedNode: any) {
            if (updatedNode.type.name !== aiCollapsibleBlockNodeType) return false

            node = updatedNode
            wrapper.open = !!updatedNode.attrs.isOpen
            renderTrace(updatedNode)

            if (updatedNode.attrs.isStreaming) {
                wrapper.classList.add('is-streaming')
            } else {
                wrapper.classList.remove('is-streaming')
            }

            return true
        },
        destroy() {
            summary.removeEventListener('mousedown', handleSummaryMouseDown)
            summary.removeEventListener('click', handleSummaryClick)
        },
    }
}
