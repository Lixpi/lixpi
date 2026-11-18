// ActionPanel - the floating pill that holds a row of icon buttons over the
// canvas, such as the controls beside the prompt input and the side panel
// toggles.
//
// Renderer: TypeScript `html` DOM. The panel is a circle when it holds a single
// button and stretches into a pill when it holds more. The host positions the
// panel through its own class; the component owns the surface, the buttons and
// the registration that lets a canvas glass renderer draw the glass rim around
// every mounted panel.

import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

export type ActionPanelButtonConfig = {
    iconSvg: string
    ariaLabel: string
    className?: string
    onClick: (event: MouseEvent) => void
}

export type ActionPanelConfig = {
    document: Document
    className?: string
    // Buttons and host-owned elements, in display order.
    children?: readonly (ActionPanelButtonConfig | Node)[]
}

export type ActionPanelInstance = {
    element: HTMLDivElement
    createButton: (config: ActionPanelButtonConfig) => HTMLButtonElement
    destroy: () => void
}

export type ActionPanelGlassTarget = {
    id: string
    element: HTMLElement
}

// Every mounted action panel in a document. A glass renderer subscribes here
// and draws the rim for each panel that lies over its canvas.
export class ActionPanelRegistry {
    private static readonly registries = new WeakMap<Document, ActionPanelRegistry>()
    private readonly targets = new Map<string, ActionPanelGlassTarget>()
    private readonly listeners = new Set<() => void>()

    static for(document: Document): ActionPanelRegistry {
        let registry = ActionPanelRegistry.registries.get(document)

        if (!registry) {
            registry = new ActionPanelRegistry()
            ActionPanelRegistry.registries.set(document, registry)
        }

        return registry
    }

    list(): ActionPanelGlassTarget[] {
        return [...this.targets.values()]
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener)

        return () => void this.listeners.delete(listener)
    }

    add(target: ActionPanelGlassTarget): void {
        this.targets.set(target.id, target)
        this.notify()
    }

    remove(id: string): void {
        if (this.targets.delete(id))
            this.notify()
    }

    private notify(): void {
        for (const listener of [...this.listeners])
            listener()
    }
}

const isButtonConfig = (child: ActionPanelButtonConfig | Node): child is ActionPanelButtonConfig =>
    typeof (child as ActionPanelButtonConfig).iconSvg === 'string'

class ActionPanel implements ActionPanelInstance {
    readonly element: HTMLDivElement
    private readonly html: ReturnType<typeof createDocumentHtml>
    private readonly id = `action-panel-${crypto.randomUUID()}`
    private readonly registry: ActionPanelRegistry
    private destroyed = false

    constructor(config: ActionPanelConfig) {
        this.html = createDocumentHtml(config.document)
        this.element = this.html`
            <div className=${`action-panel${config.className ? ` ${config.className}` : ''}`}></div>
        ` as HTMLDivElement

        for (const child of config.children ?? [])
            this.element.append(isButtonConfig(child) ? this.createButton(child) : child)

        this.registry = ActionPanelRegistry.for(config.document)
        this.registry.add({
            id: this.id,
            element: this.element,
        })
    }

    createButton = (config: ActionPanelButtonConfig): HTMLButtonElement =>
        this.html`
            <button
                type="button"
                className=${`action-panel-button${config.className ? ` ${config.className}` : ''}`}
                aria-label=${config.ariaLabel}
                data-help-tooltip="aria-label"
                onclick=${config.onClick}
                innerHTML=${config.iconSvg}
            ></button>
        ` as HTMLButtonElement

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.registry.remove(this.id)
        this.element.remove()
    }
}

export const createActionPanel = (config: ActionPanelConfig): ActionPanelInstance => new ActionPanel(config)
