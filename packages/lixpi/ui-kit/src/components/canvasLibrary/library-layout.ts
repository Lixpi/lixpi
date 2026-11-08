import { lixpiLightTheme } from '@lixpi/themes'

import {
    aiChatPanelCollapseIcon,
    navigationSidePanelToggleIcon,
} from '../../svg/svgIcons.ts'
import {
    uiKitSettings,
    type UiKitSidePanelPlacement,
} from '../../runtime-settings.ts'

import {
    type SidePanelConfig,
    type SidePanelInstance,
} from '../sidePanel/sidePanel.ts'

export type CanvasLibraryPanel = 'navigation' | 'parameters' | 'theme'

export type CanvasLibraryLayoutOptions = {
    // Per-panel placement. Omitted panels use `uiKitSettings.sidePanel.placement`.
    placements?: {
        [Panel in CanvasLibraryPanel]?: UiKitSidePanelPlacement
    }
}

type PanelHandlers = {
    onToggle: () => void
    onResize: (width: number) => void
    getMaxWidth: () => number
}

const {
    navigation,
    rightPanel,
    sidePanel,
} = lixpiLightTheme.components
const libraryGeometry = rightPanel.libraryGeometry

const panelLayouts = {
    navigation: {
        side: 'left' as const,
        widthProperty: '--canvas-library-sidebar-width',
        dockedClass: 'canvas-library-navigating',
        placementKey: 'navigationPlacement',
        width: navigation.geometry.defaultWidth,
        minimumWidth: navigation.geometry.minWidth,
        toggle: {
            iconSvg: navigationSidePanelToggleIcon,
            motion: 'fixed' as const,
            openAriaLabel: 'Close navigation',
            closedAriaLabel: 'Open navigation',
            className: 'navigation-side-panel-toggle',
            ...navigation.geometry.toggle,
        },
    },
    parameters: {
        side: 'right' as const,
        widthProperty: '--canvas-library-params-width',
        dockedClass: 'canvas-library-inspecting',
        placementKey: 'parametersPlacement',
        width: libraryGeometry.parametersDefaultWidth,
        minimumWidth: libraryGeometry.parametersMinWidth,
        toggle: {
            iconSvg: aiChatPanelCollapseIcon,
            motion: 'fixed' as const,
            openAriaLabel: 'Close parameters',
            closedAriaLabel: 'Open parameters',
            openOffset: `calc(var(--canvas-library-theme-open-width) + var(--canvas-library-params-open-width) + ${libraryGeometry.toggleGap})`,
            top: rightPanel.geometry.toggle.top,
            size: rightPanel.geometry.toggle.size,
        },
    },
    theme: {
        side: 'right' as const,
        widthProperty: '--canvas-library-theme-width',
        dockedClass: 'canvas-library-theming',
        placementKey: 'themePlacement',
        width: libraryGeometry.themeDefaultWidth,
        minimumWidth: libraryGeometry.themeMinWidth,
        toggle: {
            iconSvg: aiChatPanelCollapseIcon,
            motion: 'fixed' as const,
            openAriaLabel: 'Close canvas theme',
            closedAriaLabel: 'Open canvas theme',
            openOffset: `calc(var(--canvas-library-theme-open-width) + ${libraryGeometry.toggleGap})`,
            top: libraryGeometry.themeToggleTop,
            size: rightPanel.geometry.toggle.size,
        },
    },
}

export const canvasLibraryInspectorTabsGeometry = {
    x: 0,
    y: 0,
    width: libraryGeometry.parametersDefaultWidth - 2 * rightPanel.geometry.contentInset,
    height: rightPanel.geometry.modeSwitchHeight,
}

export const canvasLibraryTextRows = {
    theme: 12,
    array: 3,
}

export const canvasLibraryToggleGeometry = (controlHeight: number) => {
    const height = controlHeight * 0.5
    const width = height * 1.8

    return {
        control: {
            x: 1,
            y: 2,
            width,
            height,
        },
        host: {
            width: width + 2,
            height: height + 4,
        },
    }
}

export class CanvasLibraryLayout {
    // Bumped on every open or close so a superseded close does not undock a
    // panel the user reopened while it was still sliding out.
    private readonly motionVersions = new Map<CanvasLibraryPanel, number>()

    constructor(
        private readonly root: HTMLElement,
        options: CanvasLibraryLayoutOptions = {},
    ) {
        for (const [name, layout] of Object.entries(panelLayouts) as Array<[CanvasLibraryPanel, typeof panelLayouts[CanvasLibraryPanel]]>) {
            root.style.setProperty(layout.widthProperty, `${layout.width}px`)
            root.dataset[layout.placementKey] = options.placements?.[name] ?? uiKitSettings.sidePanel.placement
        }
    }

    placement(name: CanvasLibraryPanel): UiKitSidePanelPlacement {
        return this.root.dataset[panelLayouts[name].placementKey] as UiKitSidePanelPlacement
    }

    panel(
        name: CanvasLibraryPanel,
        handlers: PanelHandlers,
    ): SidePanelConfig {
        const layout = panelLayouts[name]

        return {
            root: this.root,
            side: layout.side,
            toggle: {
                ...layout.toggle,
                onToggle: handlers.onToggle,
            },
            ...sidePanel.resizeHandle,
            minWidth: layout.minimumWidth,
            defaultWidth: layout.width,
            getMaxWidth: handlers.getMaxWidth,
            onResize: handlers.onResize,
        }
    }

    mountPanel(
        name: CanvasLibraryPanel,
        element: HTMLElement,
        panel: SidePanelInstance,
    ): void {
        panel.backdropElement.dataset.canvasLibraryPanel = name
        panel.backdropElement.style.setProperty('--side-panel-backdrop-width', `var(${panelLayouts[name].widthProperty})`)
        this.root.insertBefore(panel.backdropElement, element)
        element.append(panel.element)
    }

    // Initial docked state with no slide, used when the library first mounts.
    mountOpen(
        name: CanvasLibraryPanel,
        element: HTMLElement,
        panel: SidePanelInstance,
    ): void {
        this.nextMotionVersion(name)
        this.dock(
            name,
            element,
            true,
        )
        this.mountPanel(
            name,
            element,
            panel,
        )
        panel.mountOpen(element)
    }

    // Open marks the panel open first so a pushed panel slides into its own
    // space. Close slides the panel out first and only then releases it, so
    // pushed content does not jump before the panel has left.
    async setOpen(
        name: CanvasLibraryPanel,
        element: HTMLElement,
        panel: SidePanelInstance,
        open: boolean,
    ): Promise<void> {
        const version = this.nextMotionVersion(name)

        if (open) {
            this.dock(
                name,
                element,
                true,
            )
            this.mountPanel(
                name,
                element,
                panel,
            )
            await panel.playOpen(element)

            return
        }

        await panel.playClose()

        if (this.motionVersions.get(name) === version)
            this.dock(
                name,
                element,
                false,
            )
    }

    private nextMotionVersion(name: CanvasLibraryPanel): number {
        const version = (this.motionVersions.get(name) ?? 0) + 1
        this.motionVersions.set(name, version)

        return version
    }

    private dock(
        name: CanvasLibraryPanel,
        element: HTMLElement,
        docked: boolean,
    ): void {
        element.hidden = !docked
        this.root.classList.toggle(panelLayouts[name].dockedClass, docked)
    }

    minimumWidth(name: CanvasLibraryPanel): number {
        return panelLayouts[name].minimumWidth
    }

    setWidth(
        name: CanvasLibraryPanel,
        width: number,
    ): void {
        this.root.style.setProperty(panelLayouts[name].widthProperty, `${width}px`)
    }

    stageMinimumWidth(parametersOpen: boolean): number {
        return parametersOpen ? libraryGeometry.stageMinWidthWithParameters : libraryGeometry.stageMinWidth
    }

    inspectorTabs(host: SVGSVGElement) {
        const bounds = host.getBoundingClientRect()

        return {
            ...canvasLibraryInspectorTabsGeometry,
            width: bounds.width || canvasLibraryInspectorTabsGeometry.width,
            height: bounds.height || canvasLibraryInspectorTabsGeometry.height,
        }
    }
}
