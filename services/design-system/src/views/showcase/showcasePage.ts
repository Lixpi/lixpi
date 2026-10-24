// One design-system page: a Gentelella page header followed by cards, one per
// component or rendering option. The page owns every component instance it
// shows, so leaving the route destroys them in reverse creation order.
// Renderer: TypeScript `html` DOM composed from Gentelella components.

import { createGentelellaCard } from '@lixpi/ui-kit-gentelella/components/card'
import {
    createGentelellaGrid,
    type GentelellaGridColumns,
} from '@lixpi/ui-kit-gentelella/components/foundation'
import { createGentelellaPage } from '@lixpi/ui-kit-gentelella/components/page'
import { createGentelellaPageHeader } from '@lixpi/ui-kit-gentelella/components/page-header'
import { showGentelellaToast } from '@lixpi/ui-kit-gentelella/components/overlay'
import {
    type GentelellaContent,
} from '@lixpi/ui-kit-gentelella/content'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import '$src/views/showcase/showcase.scss'

export type ShowcaseDisposable = {
    destroy: () => void
}

export type ShowcasePageConfig = {
    description: string
    packageName: string
    title: string
}

export type ShowcaseSectionConfig = {
    columns?: GentelellaGridColumns
    content: GentelellaContent
    description?: string
    title: string
}

export type ShowcaseSpecimenConfig = {
    content: GentelellaContent
    label: string
    surface?: 'dark' | 'plain'
}

export class ShowcasePage implements WebClientView {
    readonly el: HTMLElement

    private readonly disposables: ShowcaseDisposable[] = []
    private readonly mountCallbacks: Array<() => void> = []
    private mounted = false

    constructor(config: ShowcasePageConfig) {
        const page = this.own(
            createGentelellaPage({ className: 'design-system-page' }),
        )
        const header = this.own(
            createGentelellaPageHeader({
                pretitle: config.packageName,
                title: config.title,
            }),
        )
        page.appendContent([
            header.el,
            html`<p className="design-system-page-description">${config.description}</p>`,
        ])
        this.el = page.el
    }

    own<Instance extends ShowcaseDisposable>(instance: Instance): Instance {
        this.disposables.push(instance)

        return instance
    }

    // Some components measure or query their mounted DOM, and several Gentelella
    // runtimes scan the document. Both have to wait until the route view is in it.
    onMount(callback: () => void): void {
        if (this.mounted)
            callback()
        else
            this.mountCallbacks.push(callback)
    }

    addSection(config: ShowcaseSectionConfig): void {
        const content = config.columns
            ? this.own(
                createGentelellaGrid({
                    children: config.content,
                    className: 'design-system-specimen-grid',
                    columns: config.columns,
                }),
            ).el
            : config.content
        const card = this.own(
            createGentelellaCard({
                className: 'design-system-section',
                content: [
                    config.description
                        ? html`<p className="design-system-section-description">${config.description}</p>`
                        : null,
                    content,
                ],
                title: config.title,
            }),
        )
        this.el.append(card.el)
    }

    mount(): void {
        this.mounted = true

        for (const callback of this.mountCallbacks.splice(0))
            callback()
    }

    destroy(): void {
        for (const disposable of this.disposables.splice(0).reverse())
            disposable.destroy()

        this.mountCallbacks.length = 0
        this.el.remove()
    }
}

// A labelled frame around one rendering option of a component.
export const createShowcaseSpecimen = (config: ShowcaseSpecimenConfig): HTMLElement =>
    html`
        <figure className="design-system-specimen">
            <div className=${`design-system-specimen-stage design-system-specimen-stage-${config.surface ?? 'plain'}`}>
                ${config.content}
            </div>
            <figcaption className="design-system-specimen-label">${config.label}</figcaption>
        </figure>
    ` as HTMLElement

// A horizontal run of items that keeps its children at their natural size.
export const createShowcaseRow = (content: GentelellaContent): HTMLElement =>
    html`
        <div className="design-system-row">${content}</div>
    ` as HTMLElement

// Callbacks on the pages report user changes through the Gentelella toast.
export const announce = (message: string): void =>
    void showGentelellaToast(
        message,
        {
            duration: 1800,
            variant: 'info',
        },
    )
