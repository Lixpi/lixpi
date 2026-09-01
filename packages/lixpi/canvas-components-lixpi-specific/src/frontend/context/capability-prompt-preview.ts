import {
    type CapabilityModuleMeta,
} from '@lixpi/constants'
import {
    createContextPreviewPopover,
    type ContextPreviewPopoverContent,
    type ContextPreviewPopoverInstance,
} from '@lixpi/ui-kit/components/preview'
import { atomIcon } from '@lixpi/ui-kit/svg'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    getContextPreviewCanvasPortal,
    CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES,
    type ContextPreviewEnvironment,
    type ContextPreviewTileInstance,
} from './context-preview.ts'

export class CapabilityModulePromiseCache {
    private readonly entries = new Map<string, Promise<CapabilityModuleMeta>>()
    private epoch = 0

    get(moduleId: string, load: () => Promise<CapabilityModuleMeta>): Promise<CapabilityModuleMeta> {
        const existing = this.entries.get(moduleId)
        if (existing) return existing
        const pending = this.load(moduleId, load, this.epoch)
        this.entries.set(moduleId, pending)
        return pending
    }

    private async load(moduleId: string, load: () => Promise<CapabilityModuleMeta>, epoch: number): Promise<CapabilityModuleMeta> {
        try {
            return await load()
        } catch (error) {
            if (epoch === this.epoch) this.entries.delete(moduleId)
            throw error
        }
    }

    clear(): void {
        this.epoch += 1
        this.entries.clear()
    }
}

export type CapabilityPromptPreviewPorts = {
    environment: Pick<ContextPreviewEnvironment, 'document' | 'tooltipHideDelayMs'>
    inlinePopover?: boolean
    preferredPlacement?: 'top' | 'bottom' | 'left' | 'right'
    getCapabilityModule?: (moduleId: string) => Promise<CapabilityModuleMeta>
    capabilityModuleCache?: CapabilityModulePromiseCache
}

class CapabilityPromptReferencePreview implements ContextPreviewTileInstance {
    readonly dom: HTMLElement
    private readonly lifetime = new Lifetime()
    private contentLifetime = new Lifetime()
    private readonly popover: ContextPreviewPopoverInstance
    private readonly cache: CapabilityModulePromiseCache
    private readonly html: ReturnType<typeof createDocumentHtml>
    private readonly accessibleLabel: string
    private status: 'idle' | 'loading' | 'loaded' | 'error' = 'idle'

    constructor(private readonly reference: { moduleId: string; displayName: string }, private readonly ports: CapabilityPromptPreviewPorts, options: { inlinePopover?: boolean; preferredPlacement?: 'top' | 'bottom' | 'left' | 'right' }) {
        this.html = createDocumentHtml(ports.environment.document)
        this.accessibleLabel = `${reference.displayName} capability details`
        this.cache = ports.capabilityModuleCache ?? new CapabilityModulePromiseCache()
        this.lifetime.own(() => this.contentLifetime.destroy())
        const trigger = this.html`<span className="prompt-reference-chip-content">
            <span className="prompt-reference-chip-icon" aria-hidden="true" innerHTML=${atomIcon}></span>
            <span className="prompt-reference-chip-name">${reference.displayName}</span>
        </span>` as HTMLSpanElement
        this.popover = createContextPreviewPopover({
            getPortal: getContextPreviewCanvasPortal,
            contentCssVariableNames: CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES,
            hideDelayMs: ports.environment.tooltipHideDelayMs,
            ...this.content(this.loading()),
            triggerContent: trigger,
            preferredPlacement: options.preferredPlacement ?? ports.preferredPlacement ?? 'top',
            inlinePopover: options.inlinePopover ?? ports.inlinePopover,
            inlineLabelTrigger: true,
            beforeOpen: () => {
                void this.load()
            },
        })
        this.lifetime.own(() => this.popover.destroy())
        this.dom = this.popover.dom
        this.dom.classList.add('prompt-reference-chip', 'prompt-reference-chip-capability-module', 'context-preview-inline-label', 'capability-description-preview')
        this.dom.setAttribute('contenteditable', 'false')
    }

    private content(element: HTMLElement): ContextPreviewPopoverContent {
        return { accessibleLabel: this.accessibleLabel, content: element, contentClassName: 'context-preview-popover capability-description-popover' }
    }

    private loading(): HTMLElement {
        return this.html`<div className="capability-description-status" role="status">Loading ${this.reference.displayName} details…</div>` as HTMLElement
    }

    private async load(): Promise<void> {
        if (this.lifetime.signal.aborted || this.status === 'loading' || this.status === 'loaded') return
        this.status = 'loading'
        this.contentLifetime.destroy()
        this.contentLifetime = new Lifetime()
        this.popover.updateContent(this.content(this.loading()))
        try {
            const meta = await this.cache.get(this.reference.moduleId, async () => {
                if (!this.ports.getCapabilityModule) throw new Error('Capability metadata lookup is unavailable')
                return await this.ports.getCapabilityModule(this.reference.moduleId)
            })
            if (this.lifetime.signal.aborted) return
            this.status = 'loaded'
            this.popover.updateContent(this.content(renderCapabilityDescriptionCard(meta, this.ports.environment.document)))
        } catch {
            if (this.lifetime.signal.aborted) return
            this.status = 'error'
            const retry = this.html`<button type="button" className="capability-description-retry">Retry</button>` as HTMLButtonElement
            const click = () => {
                void this.load()
            }
            retry.addEventListener('click', click)
            this.contentLifetime.own(() => retry.removeEventListener('click', click))
            this.popover.updateContent(this.content(this.html`<div className="capability-description-status" role="alert">
                <p>${this.reference.displayName} details are temporarily unavailable.</p>${retry}
            </div>` as HTMLElement))
        }
    }

    destroy = (): void => {
        this.lifetime.destroy()
    }
}

export function createCapabilityPromptReferencePreview(reference: { moduleId: string; displayName: string }, ports: CapabilityPromptPreviewPorts, options: { inlinePopover?: boolean; preferredPlacement?: 'top' | 'bottom' | 'left' | 'right' } = {}): ContextPreviewTileInstance {
    return new CapabilityPromptReferencePreview(reference, ports, options)
}

export function renderCapabilityDescriptionCard(meta: CapabilityModuleMeta, document: Document): HTMLElement {
    const html = createDocumentHtml(document)
    const inputsId = `capability-inputs-${crypto.randomUUID()}`
    const sheet = meta.descriptionSheet
    return html`<article className="capability-description-card" aria-label=${`${meta.name} capability`}>
        <header>
            <span className="capability-description-kicker">Capability</span>
            <h2>${meta.name}</h2>
            <p>${sheet.purpose}</p>
        </header>
        <section aria-labelledby=${inputsId}>
            <h3 id=${inputsId}>Expected inputs</h3>
            <dl>
                ${
        sheet.expectedInputs.map(input =>
            html`<div>
                    <dt>${input.name} <span>${input.requirement}</span></dt>
                    <dd>${input.description}</dd>
                    <dd className="capability-description-accepts">Accepts: ${input.accepts.join(', ')}</dd>
                </div>`
        )
    }
            </dl>
        </section>
        <section>
            <h3>Best results</h3>
            <ul>${sheet.bestResults.map(item => html`<li>${item}</li>`)}</ul>
        </section>
        <section>
            <h3>Limitations</h3>
            <ul>${sheet.limitations.map(item => html`<li>${item}</li>`)}</ul>
        </section>
        <section>
            <h3>Execution</h3>
            <p>${sheet.executionCharacteristics.summary}</p>
            <p className="capability-description-execution">Cost: ${sheet.executionCharacteristics.cost}. Latency: ${sheet.executionCharacteristics.latency}.</p>
        </section>
    </article>` as HTMLElement
}
