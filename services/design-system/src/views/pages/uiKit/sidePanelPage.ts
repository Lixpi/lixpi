// The resizable drawer from @lixpi/ui-kit/components/side-panel. Each demo pane
// hosts one SidePanel the way the workspace right panel does: the component
// owns width, resizing, the toggle, backdrop, overlay and slide motion, and the
// host mounts its panel content and reflects the reported width.

import {
    createSidePanel,
    type SidePanelConfig,
    type SidePanelInstance,
} from '@lixpi/ui-kit/components/side-panel'
import {
    aiChatPanelCollapseIcon,
    navigationSidePanelToggleIcon,
} from '@lixpi/ui-kit/svg'
import { createGentelellaCard } from '@lixpi/ui-kit-gentelella/components/card'
import { createGentelellaListGroup } from '@lixpi/ui-kit-gentelella/components/foundation'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/uiKit/side-panel.scss'

type SidePanelDemoConfig = Pick<SidePanelConfig, 'animation' | 'drag' | 'overlay' | 'side'> & {
    defaultWidth: number
    open: boolean
    toggleMotion: 'fixed' | 'slide'
}

class SidePanelDemo {
    readonly pane: HTMLElement

    private readonly panel: HTMLElement
    private readonly sidePanel: SidePanelInstance
    private open = false
    private readonly content: { destroy: () => void }

    constructor(private readonly config: SidePanelDemoConfig) {
        this.pane = html`
            <div className="design-system-side-panel-pane">
                <p className="design-system-side-panel-hint">Use the toggle, drag the panel edge to resize${config.drag?.enabled ? ', or swipe the panel toward its edge' : ''}.</p>
            </div>
        ` as HTMLElement
        const card = createGentelellaCard({
            content: createGentelellaListGroup({
                items: ['Capabilities', 'Artifacts', 'Media', 'AI threads'].map(
                    label => ({
                        content: label,
                        value: label,
                    }),
                ),
            }).el,
            subtitle: `side: '${config.side}'`,
            title: 'Panel content',
        })
        this.content = card
        this.panel = html`
            <div className=${`design-system-side-panel design-system-side-panel-${config.side}`}>${card.el}</div>
        ` as HTMLElement
        this.sidePanel = createSidePanel({
            animation: config.animation,
            defaultWidth: config.defaultWidth,
            drag: config.drag,
            grabWidth: 12,
            minWidth: 200,
            offset: 0,
            overlay: config.overlay,
            root: this.pane,
            side: config.side,
            toggle: {
                closedAriaLabel: 'Open panel',
                iconSvg: config.side === 'right' ? aiChatPanelCollapseIcon : navigationSidePanelToggleIcon,
                motion: config.toggleMotion,
                openAriaLabel: 'Close panel',
                size: '28px',
                top: '12px',
                onToggle: () => void this.setOpen(!this.open),
            },
            getMaxWidth: () => this.pane.getBoundingClientRect().width - 80,
            measureWidth: () => this.panel.getBoundingClientRect().width || config.defaultWidth,
            onOpenChange: open => void this.setOpen(open),
            onResize: width => this.reflectWidth(width),
            onResizeEnd: width => announce(`Panel width ${Math.round(width)}px`),
        })

        if (this.sidePanel.toggleElement)
            this.pane.append(this.sidePanel.toggleElement)

        this.reflectWidth(
            this.sidePanel.getWidth(),
        )
        this.panel.append(this.sidePanel.element)

        if (config.open)
            this.mountOpen()
        else
            this.sidePanel.setOpen(false)
    }

    private reflectWidth(width: number): void {
        this.panel.style.width = `${width}px`
        this.pane.style.setProperty('--side-panel-backdrop-width', `${width}px`)
    }

    private attach(): void {
        if (this.sidePanel.overlayElement)
            this.pane.append(this.sidePanel.overlayElement)

        this.pane.append(this.sidePanel.backdropElement, this.panel)
        this.panel.append(this.sidePanel.element)
    }

    private mountOpen(): void {
        this.open = true
        this.sidePanel.mountOpen(this.panel)
        this.attach()
        this.sidePanel.setOpen(true)
    }

    private async setOpen(open: boolean): Promise<void> {
        if (open === this.open)
            return

        this.open = open
        this.sidePanel.setOpen(open)

        if (open) {
            this.sidePanel.prepareOpen(this.panel)
            this.attach()
            await this.sidePanel.playOpen(this.panel)
        } else {
            await this.sidePanel.playClose()

            if (!this.open) {
                this.sidePanel.detachPanel()
                this.panel.remove()
            }
        }
    }

    destroy(): void {
        this.sidePanel.destroy()
        this.content.destroy()
        this.pane.remove()
    }
}

const VARIANTS: Array<SidePanelDemoConfig & { label: string }> = [
    {
        defaultWidth: 280,
        label: "side: 'right', open, sliding toggle",
        open: true,
        side: 'right',
        toggleMotion: 'slide',
    },
    {
        defaultWidth: 260,
        label: "side: 'left', closed, fixed toggle",
        open: false,
        side: 'left',
        toggleMotion: 'fixed',
    },
    {
        defaultWidth: 300,
        label: 'Overlay with outside close and swipe to close',
        open: false,
        overlay: {
            closeOnPointerDown: true,
            enabled: true,
        },
        drag: { enabled: true },
        side: 'right',
        toggleMotion: 'slide',
    },
    {
        animation: {
            closeEasing: 'cubic-bezier(0.85, 0, 0.15, 1)',
            durationMs: 700,
            openEasing: 'cubic-bezier(0.319, 1, 0.01, 1)',
        },
        defaultWidth: 280,
        label: 'animation: 700 ms with separate open and close easing',
        open: false,
        side: 'right',
        toggleMotion: 'slide',
    },
]

export const createSidePanelPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit/components/side-panel',
        title: 'Side panel',
        description: 'The workspace right panel uses this component. The host only appends the returned elements and reflects the width it reports.',
    })
    page.addSection({
        title: 'Configurations',
        columns: 2,
        content: VARIANTS.map(
            variant => createShowcaseSpecimen({
                content: page.own(
                    new SidePanelDemo(variant),
                ).pane,
                label: variant.label,
            }),
        ),
    })

    return page
}
