import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

import {
    combineGentelellaClassNames,
    gentelellaClasses,
} from '../../classNames.ts'
import {
    appendGentelellaContent,
    type GentelellaContent,
} from '../../content.ts'

export type GentelellaCardConfig = {
    bodyClassName?: string
    className?: string
    collapsible?: boolean
    content?: GentelellaContent
    document?: Document
    footer?: GentelellaContent
    headerClassName?: string
    headerTrailing?: GentelellaContent
    subtitle?: string
    title?: string
}

export type GentelellaCardInstance = {
    readonly bodyEl: HTMLDivElement
    readonly el: HTMLDivElement
    readonly headerEl: HTMLDivElement | null
    appendContent: (content: GentelellaContent) => void
    destroy: () => void
    setCollapsed: (collapsed: boolean) => void
}

class GentelellaCard implements GentelellaCardInstance {
    readonly bodyEl: HTMLDivElement
    readonly el: HTMLDivElement
    readonly headerEl: HTMLDivElement | null

    constructor(config: GentelellaCardConfig) {
        const html = createDocumentHtml(config.document ?? globalThis.document)
        const hasHeader = Boolean(
            config.title
            || config.subtitle
            || config.headerTrailing,
        )
        this.headerEl = hasHeader
            ? html`
                <div className=${combineGentelellaClassNames(gentelellaClasses.card.header, config.headerClassName)}>
                    <div>
                        ${config.title ? html`<div className=${gentelellaClasses.card.title}>${config.title}</div>` : null}
                        ${config.subtitle ? html`<div className=${gentelellaClasses.card.subtitle}>${config.subtitle}</div>` : null}
                    </div>
                </div>
            ` as HTMLDivElement
            : null

        if (this.headerEl) {
            appendGentelellaContent(this.headerEl, config.headerTrailing)

            if (config.collapsible) {
                const collapseButton = html`
                    <button
                        className=${gentelellaClasses.card.optionButton}
                        type="button"
                        aria-expanded="true"
                        aria-label="Toggle card content"
                        onclick=${() => this.setCollapsed(!this.bodyEl.hidden)}
                    >⌃</button>
                ` as HTMLButtonElement
                this.headerEl.append(collapseButton)
            }
        }

        this.bodyEl = html`
            <div className=${combineGentelellaClassNames(gentelellaClasses.card.body, config.bodyClassName)}></div>
        ` as HTMLDivElement

        this.el = html`
            <div className=${combineGentelellaClassNames(gentelellaClasses.card.base, config.className)}>
                ${this.headerEl}
                ${this.bodyEl}
            </div>
        ` as HTMLDivElement

        if (config.footer) {
            const footer = html`<div className=${gentelellaClasses.card.footer}></div>` as HTMLDivElement
            appendGentelellaContent(footer, config.footer)
            this.el.append(footer)
        }

        this.appendContent(config.content)
    }

    appendContent(content: GentelellaContent): void {
        appendGentelellaContent(this.bodyEl, content)
    }

    setCollapsed(collapsed: boolean): void {
        this.bodyEl.hidden = collapsed
        this.headerEl?.querySelector<HTMLButtonElement>('[aria-label="Toggle card content"]')
            ?.setAttribute(
                'aria-expanded',
                String(!collapsed),
            )
    }

    destroy(): void {
        this.el.remove()
    }
}

export const createGentelellaCard = (config: GentelellaCardConfig = {}): GentelellaCardInstance => new GentelellaCard(config)
