// The loading surface from @lixpi/canvas-components/loading and the Lixpi
// workspace presets that web-ui and the user portal build their loading layer
// from. The overlay bakes the traveling outline into a small bitmap, so it
// paints before any GPU backend or module download is ready.

import {
    LoadingLayer,
    LoadingOverlay,
    type LoadingLease,
} from '@lixpi/canvas-components/loading'
import {
    createWorkspaceLoadingLayer,
    createWorkspaceLoadingOutline,
    getWorkspaceLoadingPresentation,
    type WorkspaceLoadingOutlineInstance,
} from '@lixpi/canvas-components-lixpi-specific/frontend/loading'
import { createLixpiCanvasSettings } from '@lixpi/canvas-components-lixpi-specific/frontend/settings'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
    createShowcaseRow,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/canvas/canvas-pages.scss'

const APPLICATION_LAYER_MS = 2500

export const createCanvasLoadingPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/canvas-components/loading · @lixpi/canvas-components-lixpi-specific/frontend/loading',
        title: 'Loading surface',
        description: 'One loading layer serves every pending request in an application. Each lease shows or fails independently, and retry goes to the lease that failed.',
    })
    const settings = createLixpiCanvasSettings()
    const presentation = getWorkspaceLoadingPresentation(settings)
    const button = (
        label: string,
        onClick: () => void,
        variant: 'ghost' | 'outline' | 'primary' = 'outline',
    ): HTMLElement =>
        page.own(
            createGentelellaButton({
                label,
                size: 'small',
                variant,
                onClick,
            }),
        ).el

    const overlayStage = html`<div className="design-system-loading-stage"></div>` as HTMLElement
    const overlay = page.own(
        new LoadingOverlay({
            ...presentation,
            root: overlayStage,
            onError: error => console.error('Loading overlay failed', error),
            onRetry: () => {
                overlay.setErrorMessage(null)
                overlay.setVisible(true)
                announce('Retry requested')
            },
        }),
    )
    overlay.setVisible(true)
    const customOverlayStage = html`<div className="design-system-loading-stage"></div>` as HTMLElement
    const customOverlay = page.own(
        new LoadingOverlay({
            errorTitle: 'Document failed to load',
            outline: {
                ...presentation.outline,
                durationMs: 1800,
                size: 64,
                snakeLengthFraction: 0.3,
            },
            retryLabel: 'Try again',
            root: customOverlayStage,
            onError: error => console.error('Loading overlay failed', error),
        }),
    )
    customOverlay.setVisible(true)
    page.addSection({
        title: 'Loading overlay',
        description: 'setVisible pauses and resumes the lap without resetting it. setErrorMessage replaces the outline with the error title, message and retry action.',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: [
                    overlayStage,
                    createShowcaseRow([
                        button('setVisible(true)', () => overlay.setVisible(true)),
                        button('setVisible(false)', () => overlay.setVisible(false)),
                        button(
                            'setErrorMessage',
                            () => overlay.setErrorMessage('The workspace could not be reached.'),
                            'primary',
                        ),
                    ]),
                ],
                label: 'getWorkspaceLoadingPresentation(createLixpiCanvasSettings())',
            }),
            createShowcaseSpecimen({
                content: customOverlayStage,
                label: 'outline { size: 64, durationMs: 1800, snakeLengthFraction: 0.3 }',
            }),
        ],
    })

    const layerStage = html`<div className="design-system-loading-stage"></div>` as HTMLElement
    const layer = page.own(
        new LoadingLayer({
            ...presentation,
            root: layerStage,
            onError: error => console.error('Loading layer failed', error),
        }),
    )
    const leases: LoadingLease[] = []
    page.own({ destroy: () => leases.splice(0).forEach(lease => lease.destroy()) })
    const acquire = (): void => {
        const lease = layer.acquire({
            label: `Request ${leases.length + 1}`,
            visible: true,
            onRetry: () => {
                lease.setVisible(true)
                announce('Retrying the failed lease')
            },
        })
        leases.push(lease)
        announce(`${leases.length} active lease(s)`)
    }
    page.addSection({
        title: 'Loading layer and leases',
        description: 'Acquire several leases, fail one, then release them in any order. The layer stays visible while any lease is pending.',
        content: [
            layerStage,
            createShowcaseRow([
                button(
                    'acquire()',
                    acquire,
                    'primary',
                ),
                button('Fail the newest lease', () => leases.at(-1)?.setErrorMessage('Request failed')),
                button('Release the oldest lease', () => {
                    leases.shift()?.destroy()
                    announce(`${leases.length} active lease(s)`)
                }),
            ]),
        ],
    })

    const outlines: WorkspaceLoadingOutlineInstance[] = []
    const applicationLayer = page.own(
        createWorkspaceLoadingLayer({
            paneEl: page.el,
            settings,
        }),
    )
    page.own({ destroy: () => outlines.splice(0).forEach(outline => outline.destroy()) })
    page.addSection({
        title: 'Application loading layer',
        description: `createWorkspaceLoadingLayer mounts a full-window layer on the document body, as web-ui does during startup. These buttons show it for ${APPLICATION_LAYER_MS / 1000} seconds.`,
        content: createShowcaseRow([
            button(
                'createWorkspaceLoadingLayer().acquire()',
                () => {
                    const lease = applicationLayer.acquire({
                        label: 'Loading workspace',
                        visible: true,
                    })
                    setTimeout(() => lease.destroy(), APPLICATION_LAYER_MS)
                },
                'primary',
            ),
            button('createWorkspaceLoadingOutline()', () => {
                const outline = createWorkspaceLoadingOutline({
                    layer: applicationLayer,
                    paneEl: page.el,
                    settings,
                })
                outline.setVisible(true)
                outlines.push(outline)
                setTimeout(() => {
                    outline.destroy()
                    outlines.splice(
                        outlines.indexOf(outline),
                        1,
                    )
                }, APPLICATION_LAYER_MS)
            }),
        ]),
    })

    return page
}
