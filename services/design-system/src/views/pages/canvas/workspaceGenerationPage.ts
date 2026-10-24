// Media-generation progress as the workspace shows it inside branch markers
// and the output details panel, plus the details sidebar frame.

import {
    createDefaultMediaGenerationRunProgress,
    type ExecutionTrace,
    type MediaGenerationProgressState,
    type MediaGenerationRunStatus,
    type OperationProgressItem,
} from '@lixpi/constants'
import { createMediaGenerationProgress } from '@lixpi/canvas-components-lixpi-specific/frontend/progress'
import { createGeneratedOutputDetailsSidebar } from '@lixpi/canvas-components-lixpi-specific/frontend/review'
import { applyWorkspaceCanvasTheme } from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import { createMediaModelBadge } from '@lixpi/ui-kit/components/media-model-badge'
import { geminiColorIcon } from '@lixpi/ui-kit/svg'
import {
    createGentelellaCode,
    createGentelellaDivider,
} from '@lixpi/ui-kit-gentelella/components/foundation'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import { createWorkspaceAppearance } from '$src/fixtures/workspaceAppearance.ts'
import {
    ShowcasePage,
    announce,
    createShowcaseRow,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/canvas/canvas-pages.scss'

const TRACE: ExecutionTrace = {
    facts: [{
        label: 'Seed',
        value: '271828',
    }],
    handles: [{
        displayName: 'Dawn study',
        id: 'image-dawn',
        kind: 'media',
        mediaKind: 'image',
        role: 'message-reference',
    }],
    modelCalls: [{
        id: 'call-1',
        modelId: 'gemini-3-pro-image',
        params: [{
            name: 'aspectRatio',
            value: '16:9',
        }],
        prompt: 'A dawn key frame of the hero on the ridge',
        provider: 'Google',
        role: 'media',
    }],
    reasoning: 'Chose a wide framing to leave room for the title.',
    traceVersion: 'execution-trace-v1',
}

const itemsAt = (step: number): OperationProgressItem[] => {
    const status = (index: number): OperationProgressItem['status'] => index < step
        ? 'completed'
        : index === step
            ? 'running'
            : 'pending'

    return [
        {
            id: 'resolve',
            status: status(0),
            summary: 'Resolved one image reference.',
            title: 'Resolve references',
        },
        {
            id: 'render',
            meta: '2 of 3',
            status: status(1),
            summary: 'Rendering three variants.',
            title: 'Render',
            trace: TRACE,
            children: [1, 2, 3].map(
                variant => ({
                    id: `variant-${variant}`,
                    status: step > 1
                        || variant < 3
                        ? status(1)
                        : 'pending',
                    title: `Variant ${variant}`,
                }),
            ),
        },
        {
            id: 'assess',
            status: status(2),
            summary: 'Checking the outputs against the prompt.',
            title: 'Assess',
        },
    ]
}

const state = (
    status: MediaGenerationRunStatus,
    message: string,
    items?: OperationProgressItem[],
): MediaGenerationProgressState => ({
    generationRequestId: 'request',
    message,
    progress: items
        ? {
            completedSteps: items.filter(item => item.status === 'completed').length,
            items,
            message,
            phase: 'rendering',
            totalSteps: items.length,
        }
        : createDefaultMediaGenerationRunProgress(status, message),
    status,
    updatedAt: Date.now(),
})

const renderTrace = (detail: unknown) => {
    const code = createGentelellaCode({ code: JSON.stringify(
        detail,
        null,
        2,
    ) })

    return {
        destroy: () => code.destroy(),
        element: code.el,
    }
}

export const createWorkspaceGenerationPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/canvas-components-lixpi-specific/frontend/progress · /review',
        title: 'Generation progress',
        description: 'createMediaGenerationProgress projects API progress items onto the UI-kit timeline. The host renders execution traces; here they are shown as JSON.',
    })
    const appearance = createWorkspaceAppearance()
    const themed = (element: HTMLElement): HTMLElement => {
        applyWorkspaceCanvasTheme(element, appearance)

        return element
    }

    let step = 0
    const live = page.own(
        createMediaGenerationProgress({
            id: 'live',
            renderItemDetail: renderTrace,
            showSummaryWhenCollapsedItemIds: ['render'],
            state: state(
                'running',
                'Rendering',
                itemsAt(step),
            ),
        }),
    )
    const timer = setInterval(
        () => {
            step = (step + 1) % 4
            live.update(
                state(
                    step === 3 ? 'completed' : 'running',
                    step === 3 ? 'Done' : 'Rendering',
                    itemsAt(step),
                ),
            )
        },
        2500,
    )
    page.own({ destroy: () => clearInterval(timer) })
    page.addSection({
        title: 'Live progress',
        description: 'update() streams new progress into the same view. The header toggles between the focused and full views.',
        content: createShowcaseSpecimen({
            content: themed(html`<div className="design-system-progress-host">${live.element}</div>`),
            label: "createMediaGenerationProgress({ state: 'running' }) updated every few seconds",
        }),
    })

    const statuses: Array<[MediaGenerationRunStatus, string]> = [
        ['pending', 'Queued'],
        ['awaiting-provider-verification', 'Waiting for provider verification'],
        ['failed', 'The provider rejected the prompt'],
        ['cancelled', 'Stopped by the user'],
    ]
    page.addSection({
        title: 'Run statuses',
        description: 'Without explicit items the view shows the default steps for the run status. A failed run marks a running step as failed.',
        columns: 2,
        content: statuses.map(
            ([status, message]) => createShowcaseSpecimen({
                content: themed(
                    html`
                        <div className="design-system-progress-host">${page.own(
                            createMediaGenerationProgress({
                                id: status,
                                state: state(status, message),
                            }),
                        ).element}</div>
                    `,
                ),
                label: `status: '${status}'`,
            }),
        ),
    })

    page.addSection({
        title: 'Read-only provenance',
        description: 'defaultExpanded opens every step, the way sealed history reopens in the details panel.',
        content: themed(
            html`
                <div className="design-system-progress-host">${page.own(
                    createMediaGenerationProgress({
                        defaultExpanded: true,
                        id: 'sealed',
                        renderItemDetail: renderTrace,
                        state: state(
                            'completed',
                            'Done',
                            itemsAt(3),
                        ),
                    }),
                ).element}</div>
            `,
        ),
    })

    const sidebarHost = themed(html`<div className="design-system-details-host"></div>` as HTMLElement)
    let sidebar: ReturnType<typeof createGeneratedOutputDetailsSidebar> | null = null
    const openSidebar = (): void => {
        sidebar?.destroy()
        sidebar = createGeneratedOutputDetailsSidebar({
            renderContent: body => {
                const progress = createMediaGenerationProgress({
                    defaultExpanded: true,
                    id: 'details',
                    renderItemDetail: renderTrace,
                    state: state(
                        'completed',
                        'Done',
                        itemsAt(3),
                    ),
                })
                body.append(
                    createMediaModelBadge({
                        icon: geminiColorIcon,
                        modelTitle: 'Nano Banana Pro',
                        providerTitle: 'Google',
                    }) ?? '',
                    createGentelellaDivider().el,
                    progress.element,
                )

                return { destroy: () => progress.destroy() }
            },
            onClose: () => {
                sidebar?.destroy()
                sidebar = null
                announce('Details closed')
            },
        })
        sidebarHost.replaceChildren(sidebar.element)
    }
    page.own({ destroy: () => sidebar?.destroy() })
    page.onMount(openSidebar)
    page.addSection({
        title: 'Output details frame',
        description: 'createGeneratedOutputDetailsSidebar owns the frame, close action and single scroll body. The caller mounts the content and returns its disposer.',
        content: [
            createShowcaseRow([
                page.own(
                    createGentelellaButton({
                        label: 'Open details',
                        size: 'small',
                        variant: 'outline',
                        onClick: openSidebar,
                    }),
                ).el,
            ]),
            sidebarHost,
        ],
    })

    return page
}
