// Root workspace shell: the navigation side panel plus the main pane that swaps
// between the workspace canvas and the intro splash based on the active route.
// Renderer: TypeScript `html` DOM, no framework runtime.

import { html } from '@lixpi/ui-primitives/dom'
import { createNavigationSidePanel } from '$src/components/navigationSidePanel/index.ts'
import '$src/components/navigationSidePanel/navigation-side-panel.scss'
import {
    createIntroPage,
    type IntroPageInstance,
} from '$src/components/introPage/introPage.ts'
import {
    createWorkspaceCanvasView,
    type WorkspaceCanvasViewInstance,
} from '$src/components/workspaceCanvasView/workspaceCanvasView.ts'

import { routerStore } from '$src/stores/routerStore.ts'
import { settings } from '$src/settings.ts'
import '$src/views/layouts/layout.scss'

const WORKSPACE_ROUTE_PATH = '/workspace/:workspaceId'

type Mode = 'intro' | 'workspace'

export type LayoutInstance = {
    el: HTMLElement
    destroy: () => void
}

export const createLayout = (): LayoutInstance => {
    const contentEl = html`<div className="workspace-main-content"></div>` as HTMLDivElement
    const navigationSidePanelPaneEl = html`<div className="navigation-side-panel-pane"></div>` as HTMLDivElement
    const el = html`
        <div className="layout-root">
            ${navigationSidePanelPaneEl}
            <div className="workspace-main-pane">${contentEl}</div>
        </div>
    ` as HTMLElement

    const previousHoverTransitionDuration = document.documentElement.style.getPropertyValue('--default-hover-transition-duration')
    document.documentElement.style.setProperty('--default-hover-transition-duration', `${settings.hover.transitionDurationMs}ms`)

    const navigationSidePanel = createNavigationSidePanel({ paneEl: navigationSidePanelPaneEl })

    let mode: Mode | null = null
    let introPage: IntroPageInstance | null = null
    let workspaceCanvasView: WorkspaceCanvasViewInstance | null = null

    const renderMode = (nextMode: Mode): void => {
        if (nextMode === mode)
            return

        mode = nextMode

        introPage?.destroy()
        introPage = null
        workspaceCanvasView?.destroy()
        workspaceCanvasView = null

        if (nextMode === 'workspace') {
            workspaceCanvasView = createWorkspaceCanvasView()
            contentEl.append(workspaceCanvasView.el)
        } else {
            introPage = createIntroPage()
            contentEl.append(introPage.el)
        }
    }

    const unsubscribeRouter = routerStore.subscribe(
        ({ data }) => void renderMode(data.currentRoute.path === WORKSPACE_ROUTE_PATH ? 'workspace' : 'intro'),
    )

    return {
        el,
        destroy: () => {
            unsubscribeRouter()
            navigationSidePanel.destroy()
            introPage?.destroy()
            workspaceCanvasView?.destroy()

            if (previousHoverTransitionDuration)
                document.documentElement.style.setProperty('--default-hover-transition-duration', previousHoverTransitionDuration)
            else
                document.documentElement.style.removeProperty('--default-hover-transition-duration')

            el.remove()
        },
    }
}
