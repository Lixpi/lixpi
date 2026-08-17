import type { CapabilityModuleMeta } from '@lixpi/constants'

import {
    createContextPreviewPopover,
    type ContextPreviewPopoverInstance,
} from '$src/components/contextPreview/index.ts'
import { html } from '$src/utils/domTemplates.ts'
import { atomIcon } from '@lixpi/ui-kit/svg'

import type { PromptReferencePreviewInstance, PromptReferencePreviewRenderer } from './promptReferenceNodeView.ts'

export class CapabilityModulePromiseCache {
    private readonly entries = new Map<string, Promise<CapabilityModuleMeta>>()

    get(moduleId: string, load: () => Promise<CapabilityModuleMeta>): Promise<CapabilityModuleMeta> {
        const existing = this.entries.get(moduleId)
        if (existing) return existing
        const pending = this.load(moduleId, load)
        this.entries.set(moduleId, pending)
        return pending
    }

    private async load(moduleId: string, load: () => Promise<CapabilityModuleMeta>): Promise<CapabilityModuleMeta> {
        try {
            return await load()
        } catch (error) {
            this.entries.delete(moduleId)
            throw error
        }
    }
}

export function createCapabilityPromptReferencePreview(
    reference: { moduleId: string; displayName: string },
    previewRenderer: PromptReferencePreviewRenderer,
    options: { inlinePopover?: boolean; preferredPlacement?: 'top' | 'bottom' | 'left' | 'right' } = {},
): PromptReferencePreviewInstance {
    const accessibleLabel = `${reference.displayName} capability details`
    const triggerContent = html`<span className="prompt-reference-chip-content">
        <span className="prompt-reference-chip-icon" aria-hidden="true" innerHTML=${atomIcon}></span>
        <span className="prompt-reference-chip-name">${reference.displayName}</span>
    </span>` as HTMLSpanElement
    const contentClassName = 'workspace-ai-chat-panel-context-preview-popover capability-description-popover'
    const cache = previewRenderer.capabilityModuleCache ?? new CapabilityModulePromiseCache()
    let status: 'idle' | 'loading' | 'loaded' | 'error' = 'idle'
    let destroyed = false
    let previewPopover: ContextPreviewPopoverInstance

    const load = async (): Promise<void> => {
        if (status === 'loading' || status === 'loaded') return
        status = 'loading'
        previewPopover.updateContent({
            accessibleLabel,
            content: renderLoading(reference.displayName),
            contentClassName,
        })
        try {
            const meta = await cache.get(reference.moduleId, async () => {
                if (!previewRenderer.getCapabilityModule) throw new Error('Capability metadata lookup is unavailable')
                return await previewRenderer.getCapabilityModule(reference.moduleId)
            })
            if (destroyed) return
            status = 'loaded'
            previewPopover.updateContent({
                accessibleLabel,
                content: renderCapabilityDescriptionCard(meta),
                contentClassName,
            })
        } catch {
            if (destroyed) return
            status = 'error'
            const retry = html`<button type="button" className="capability-description-retry">Retry</button>` as HTMLButtonElement
            retry.addEventListener('click', () => {
                status = 'idle'
                void load()
            })
            previewPopover.updateContent({
                accessibleLabel,
                content: renderUnavailable(reference.displayName, retry),
                contentClassName,
            })
        }
    }
    previewPopover = createContextPreviewPopover({
        accessibleLabel,
        triggerContent,
        content: renderLoading(reference.displayName),
        contentClassName,
        preferredPlacement: options.preferredPlacement ?? previewRenderer.preferredPlacement ?? 'top',
        inlinePopover: options.inlinePopover ?? previewRenderer.inlinePopover,
        inlineLabelTrigger: true,
        beforeOpen: () => {
            void load()
        },
    })
    previewPopover.dom.classList.add(
        'prompt-reference-chip',
        'prompt-reference-chip-capability-module',
        'context-preview-inline-label',
        'capability-description-preview',
    )
    previewPopover.dom.setAttribute('contenteditable', 'false')

    return {
        dom: previewPopover.dom,
        destroy: () => {
            destroyed = true
            previewPopover.destroy()
        },
    }
}

export function renderCapabilityDescriptionCard(meta: CapabilityModuleMeta): HTMLElement {
    const sheet = meta.descriptionSheet
    return html`<article className="capability-description-card" aria-label=${`${meta.name} capability`}>
        <header>
            <span className="capability-description-kicker">Capability</span>
            <h2>${meta.name}</h2>
            <p>${sheet.purpose}</p>
        </header>
        <section aria-labelledby=${`${meta.moduleId}-inputs`}>
            <h3 id=${`${meta.moduleId}-inputs`}>Expected inputs</h3>
            <dl>
                ${sheet.expectedInputs.map(input => html`<div>
                    <dt>${input.name} <span>${input.requirement}</span></dt>
                    <dd>${input.description}</dd>
                    <dd className="capability-description-accepts">Accepts: ${input.accepts.join(', ')}</dd>
                </div>`)}
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

const renderLoading = (displayName: string): HTMLElement => html`<div className="capability-description-status" role="status">
    Loading ${displayName} details…
</div>` as HTMLElement

const renderUnavailable = (displayName: string, retry: HTMLButtonElement): HTMLElement => html`<div className="capability-description-status" role="alert">
    <p>${displayName} details are temporarily unavailable.</p>
    ${retry}
</div>` as HTMLElement
