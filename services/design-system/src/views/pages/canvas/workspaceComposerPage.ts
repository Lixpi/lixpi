// The bottom-center prompt composer and the context previews that show what
// a prompt refers to. The composer hosts an editor supplied by the
// application; web-ui mounts its ProseMirror prompt editor there, and this page
// mounts the Gentelella rich-text control in its place.

import {
    type CanvasNode,
} from '@lixpi/constants'
import {
    WorkspacePromptComposer,
    createAiPromptComposer,
    type PromptComposerEditorRequest,
} from '@lixpi/canvas-components-lixpi-specific/frontend/composer'
import {
    WorkspaceContextTrays,
    createContextPreviewTile,
    createMediaPromptReferencePreview,
    type ContextPreviewEnvironment,
    type PromptReferencePreviewRenderer,
} from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import {
    applyWorkspaceCanvasTheme,
    getWorkspaceRightPanelCssProperties,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import { createGentelellaRichText } from '@lixpi/ui-kit-gentelella/components/form-controls'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    DEMO_WORKSPACE_ID,
    DemoAssets,
} from '$src/fixtures/demoAssets.ts'
import { createWorkspaceAppearance } from '$src/fixtures/workspaceAppearance.ts'
import {
    ShowcasePage,
    announce,
    createShowcaseRow,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/canvas/canvas-pages.scss'

const node = (
    nodeId: string,
    type: 'audio' | 'image' | 'mediaDocument' | 'video',
    assetId: string,
): CanvasNode => ({
    assetId,
    dimensions: {
        height: 200,
        width: 300,
    },
    nodeId,
    position: {
        x: 0,
        y: 0,
    },
    type,
})

const NODES = new Map<string, CanvasNode>([
    ['dawn', node(
        'dawn',
        'image',
        'image-dawn',
    )],
    ['clip', node(
        'clip',
        'video',
        'video-violet',
    )],
    ['tone', node(
        'tone',
        'audio',
        'audio-tone',
    )],
    ['brief', node(
        'brief',
        'mediaDocument',
        'document-brief',
    )],
])

// The editor port: the composer gives a host and expects an editor back.
const mountDemoEditor = (request: PromptComposerEditorRequest) => {
    const editor = createGentelellaRichText({ html: '<p>Describe the next shot…</p>' })
    request.host.append(editor.el)

    return {
        destroy: () => editor.destroy(),
        editorView: null,
        restoreContent: () => {},
    }
}

export const createWorkspaceComposerPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/canvas-components-lixpi-specific/frontend/composer · /context',
        title: 'Composer and context',
        description: 'The composer snapshots only explicit context chips and inline prompt references. Context previews resolve Asset renditions through the host environment.',
    })
    const appearance = createWorkspaceAppearance()
    const assets = page.own(
        new DemoAssets(),
    )
    const draft = new Map<string, string>()
    let contextIds = ['dawn', 'clip', 'brief']
    const environment: ContextPreviewEnvironment = {
        document,
        extractDocumentText: content => typeof content === 'string' ? content : '',
        getArtifactIcon: () => '',
        getAsset: assetId => assets.get(assetId),
        getDocuments: () => [],
        getThreads: () => [],
        initialRenditionUrl: (assetId, rendition) => assets.url(assetId, rendition),
        resolveRenditionUrl: async (assetId, rendition) => {
            await assets.ready

            return assets.url(assetId, rendition)
        },
        tooltipHideDelayMs: appearance.helpTooltip.interactiveHideDelayMs,
        onError: error => console.error('Context preview failed', error),
    }
    const themed = (element: HTMLElement): HTMLElement => {
        applyWorkspaceCanvasTheme(element, appearance)

        for (const [name, value] of Object.entries(
            getWorkspaceRightPanelCssProperties(appearance),
        ))
            element.style.setProperty(name, value)

        return element
    }

    const trays = page.own(
        new WorkspaceContextTrays({
            cancelFrame: id => cancelAnimationFrame(id),
            document,
            getContextNodeIds: () => contextIds,
            getEnvironment: () => environment,
            getNode: id => NODES.get(id),
            onRemove: id => {
                contextIds = contextIds.filter(candidate => candidate !== id)
                trays.refresh()
                announce(`Removed ${id} from context`)
            },
            requestFrame: callback => requestAnimationFrame(callback),
        }),
    )
    const composer = page.own(
        new WorkspacePromptComposer({
            appearance: {
                gradientColors: appearance.gradient.styles.shiftingColors,
                popoverBoxShadow: appearance.dropdown.styles.popoverBoxShadow,
                useShiftingGradientBackground: appearance.aiPromptInput.useShiftingGradientBackground,
            },
            document,
            mountContextTray: () => {
                const element = trays.create('canvas')

                return {
                    destroy: () => trays.release(element),
                    element,
                }
            },
            mountEditor: mountDemoEditor,
            storage: {
                getItem: key => draft.get(key) ?? null,
                setItem: (key, value) => void draft.set(key, value),
            },
            workspaceId: DEMO_WORKSPACE_ID,
            onSubmit: () => announce('Prompt submitted'),
        }),
    )
    page.onMount(() => trays.refresh())
    page.addSection({
        title: 'Workspace prompt composer',
        description: 'The context tray above the input lists the explicit chips. Remove a chip to see the tray refresh; the composer keeps its draft in the supplied storage.',
        content: createShowcaseSpecimen({
            content: themed(html`<div className="design-system-composer-host">${composer.element}</div>`),
            label: 'new WorkspacePromptComposer({ mountContextTray: trays.create, mountEditor })',
        }),
    })

    const plain = page.own(
        createAiPromptComposer({
            appearance: {
                gradientColors: appearance.gradient.styles.shiftingColors,
                popoverBoxShadow: appearance.dropdown.styles.popoverBoxShadow,
                useShiftingGradientBackground: false,
            },
            document,
            mountEditor: mountDemoEditor,
            useGradient: false,
            onSubmit: () => announce('Prompt submitted'),
        }),
    )
    const gradient = page.own(
        createAiPromptComposer({
            appearance: {
                gradientColors: appearance.gradient.styles.shiftingColors,
                popoverBoxShadow: appearance.dropdown.styles.popoverBoxShadow,
                useShiftingGradientBackground: true,
            },
            document,
            mountEditor: mountDemoEditor,
            onSubmit: () => {
                gradient.triggerGradientAnimation()
                announce('Prompt submitted')
            },
        }),
    )
    page.addSection({
        title: 'Prompt composer',
        description: 'createAiPromptComposer alone, with and without the shifting gradient. Submitting advances the gradient phase.',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: themed(html`<div className="design-system-composer-host">${plain.element}</div>`),
                label: 'useGradient: false',
            }),
            createShowcaseSpecimen({
                content: themed(html`<div className="design-system-composer-host">${gradient.element}</div>`),
                label: 'useShiftingGradientBackground: true',
            }),
        ],
    })

    page.addSection({
        title: 'Context preview tiles',
        description: 'Hover or focus a tile for its preview. Video, audio and document tiles use their poster or kind treatment.',
        content: themed(
            createShowcaseRow(
                [...NODES.values()].map(
                    canvasNode => page.own(
                        createContextPreviewTile({
                            environment,
                            node: canvasNode,
                            preferredPlacement: 'top',
                        }),
                    ).dom,
                ),
            ),
        ),
    })

    const previewRenderer: PromptReferencePreviewRenderer = {
        environment,
        getNode: reference => [...NODES.values()].find(candidate => 'assetId' in candidate && candidate.assetId === reference.assetId),
    }
    const references = [
        ['image-dawn', 'image', 'Dawn study'],
        ['video-violet', 'video', 'Violet loop'],
        ['document-brief', 'document', 'Campaign brief'],
    ] as const
    page.addSection({
        title: 'Prompt reference previews',
        description: 'The same references as inline chips and as thumbnails. The workspace shows these inside prompts, branch markers and execution traces.',
        columns: 2,
        content: (['inline', 'thumbnail'] as const).map(
            variant => createShowcaseSpecimen({
                content: themed(
                    createShowcaseRow(
                        references.map(([assetId, mediaKind, displayName]) => {
                            const preview = createMediaPromptReferencePreview(
                                {
                                    assetId,
                                    displayName,
                                    mediaKind,
                                    referenceType: 'media',
                                },
                                previewRenderer,
                                {
                                    preferredPlacement: 'top',
                                    variant,
                                },
                            )

                            return preview ? page.own(preview).dom : null
                        }),
                    ),
                ),
                label: `variant: '${variant}'`,
            }),
        ),
    })

    return page
}
