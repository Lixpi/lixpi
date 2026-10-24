// The workspace right panel and the libraries it hosts. The panel owns the
// mode switch, resizing and drawer motion; each mode mounts its content into
// the supplied host. Library data comes from demo ports instead of the API.

import {
    type CanvasAiChatPanelState,
    type CanvasRightSidePanelMode,
} from '@lixpi/constants'
import {
    type CapabilityCatalogItem,
    type CapabilityDetails,
} from '@lixpi/capability-system/frontend'
import {
    createCapabilityLibraryPanel,
    createMediaLibraryPanel,
    formatMediaFileSize,
    stripMediaFileExtension,
} from '@lixpi/canvas-components-lixpi-specific/frontend/library'
import {
    WorkspaceRightPanel,
    applyWorkspaceCanvasTheme,
    getWorkspaceRightPanelCssProperties,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import { createGentelellaEmptyState } from '@lixpi/ui-kit-gentelella/components/empty-state'
import { createGentelellaCode } from '@lixpi/ui-kit-gentelella/components/foundation'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    DEMO_USER_ID,
    DEMO_WORKSPACE_ID,
    DemoAssets,
} from '$src/fixtures/demoAssets.ts'
import { createWorkspaceAppearance } from '$src/fixtures/workspaceAppearance.ts'
import {
    ShowcasePage,
    announce,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/canvas/canvas-pages.scss'

const CAPABILITIES: Array<Pick<CapabilityCatalogItem, 'capabilityId' | 'kind' | 'name' | 'summary'>> = [
    {
        capabilityId: 'character-sheet',
        kind: 'tool',
        name: 'Character sheet',
        summary: 'Builds a turnaround sheet from a reference image.',
    },
    {
        capabilityId: 'shot-list',
        kind: 'tool',
        name: 'Shot list',
        summary: 'Breaks a brief into framed shots.',
    },
    {
        capabilityId: 'pose-reference',
        kind: 'skill',
        name: 'Pose reference',
        summary: 'Selects pose references for a character.',
    },
]

const catalogItem = (capability: typeof CAPABILITIES[number]): CapabilityCatalogItem => ({
    ...capability,
    catalogExposure: 'standalone',
    manifestBlobHash: `hash-${capability.capabilityId}`,
    normalizedName: capability.name.toLocaleLowerCase(),
    scope: 'global',
    scopeAndOwner: 'global#system',
    scopeOwnerId: 'system',
    searchKey: `${capability.kind}#${capability.name}`,
    status: 'active',
    tags: [capability.kind],
    updatedAt: 1,
})

const capabilityDetails = (capabilityId: string): CapabilityDetails => {
    const capability = CAPABILITIES.find(candidate => candidate.capabilityId === capabilityId) ?? CAPABILITIES[0]
    const item = catalogItem(capability)

    return {
        ...item,
        grants: [],
        inputSchema: {
            properties: { prompt: { type: 'string' } },
            required: ['prompt'],
            type: 'object',
        },
        manifest: {
            capabilityId: item.capabilityId,
            description: item.summary,
            kind: 'tool',
            name: item.name,
            references: [],
            resources: [],
            schemaVersion: 1,
            tool: {
                executionPolicy: 'model-choice',
                inputSchema: { resourceId: 'input-schema' },
                outputSchema: { resourceId: 'output-schema' },
                workflow: { nodes: [] },
            },
        },
        permissions: {
            canDelete: false,
            canEdit: false,
            canSetStatus: false,
            canShare: false,
        },
        record: {
            capabilityId: item.capabilityId,
            catalogExposure: 'standalone',
            createdAt: 1,
            kind: 'tool',
            manifestBlobHash: item.manifestBlobHash,
            ownerUserId: 'system',
            scope: 'global',
            scopeOwnerId: 'system',
            status: 'active',
            storageOwnerId: 'system',
            updatedAt: 1,
        },
        references: [],
    }
}

class RightPanelDemo {
    readonly element: HTMLElement

    private readonly panel: WorkspaceRightPanel
    private state: CanvasAiChatPanelState = {
        contextChips: [],
        isOpen: true,
        topLevelMode: 'media',
    }

    constructor(private readonly assets: DemoAssets) {
        const appearance = createWorkspaceAppearance()
        const pane = html`<div className="design-system-right-panel-pane workspace-pane"></div>` as HTMLElement
        this.element = html`<div className="design-system-right-panel-host">${pane}</div>` as HTMLElement
        applyWorkspaceCanvasTheme(pane, appearance)
        this.panel = new WorkspaceRightPanel({
            acquirePanLock: () => () => {},
            cancelFrame: handle => cancelAnimationFrame(handle),
            clearTimer: handle => clearTimeout(handle),
            cssProperties: getWorkspaceRightPanelCssProperties(appearance),
            getState: () => this.state,
            mountContent: (
                host,
                mode,
                signal,
            ) => this.mountContent(
                host,
                mode,
                signal,
            ),
            pane,
            requestFrame: callback => requestAnimationFrame(callback),
            setTimer: (callback, delay) => window.setTimeout(callback, delay),
            settings: appearance.rightSidePanel,
            switchSettings: appearance.aiChatThread.panelSwitch,
            widthHost: this.element,
            onError: error => console.error('Right panel failed', error),
            onModeChange: topLevelMode => {
                this.state = {
                    ...this.state,
                    topLevelMode,
                }
            },
            onOpenChange: open => void this.setOpen(open),
            onWidthChange: width => {
                this.state = {
                    ...this.state,
                    width,
                }
            },
        })
    }

    mount(): void {
        this.panel.render({ animateOpen: false })
    }

    private async setOpen(open: boolean): Promise<void> {
        this.state = {
            ...this.state,
            isOpen: open,
        }

        if (open) {
            this.panel.syncState()
            this.panel.render()
        } else
            await this.panel.close()
    }

    private mountContent(
        host: HTMLElement,
        mode: CanvasRightSidePanelMode,
        signal: AbortSignal,
    ): () => void {
        if (mode === 'media') {
            const library = createMediaLibraryPanel({
                assets: {
                    changeScope: async assetId => this.assets.get(assetId) ?? { error: 'Missing Asset' },
                    get: async assetId => this.assets.get(assetId) ?? { error: 'Missing Asset' },
                    getDocument: () => undefined,
                    list: async () => {
                        await this.assets.ready

                        return { items: this.assets.meta() }
                    },
                    refresh: async assetId => this.assets.get(assetId) ?? { error: 'Missing Asset' },
                    resumeDocument: async () => {},
                    updateMetadata: async assetId => this.assets.get(assetId) ?? { error: 'Missing Asset' },
                },
                attestSubjectIdentity: async assetId => this.assets.get(assetId) ?? { error: 'Missing Asset' },
                document,
                mountEditor: () => ({ destroy: () => {} }),
                mountHistory: () => ({ destroy: () => {} }),
                prepareRenditionUrls: async () => {
                    await this.assets.ready

                    return (assetId, rendition) => this.assets.url(assetId, rendition)
                },
                removeFromLibrary: async assetId => {
                    announce(`Remove ${assetId} from the library`)

                    return {}
                },
                tooltipHideDelayMs: 80,
                userId: DEMO_USER_ID,
                workspaceId: DEMO_WORKSPACE_ID,
                onError: error => console.error('Media library failed', error),
                onInsertAsset: async item => {
                    announce(`Insert ${item.title}`)

                    return true
                },
            })
            library.mountInto(host)

            return () => library.destroy()
        }

        if (mode === 'capabilities') {
            const library = createCapabilityLibraryPanel({
                client: {
                    get: async capabilityId => capabilityDetails(capabilityId),
                    invalidate: () => {},
                    list: async () => ({ items: CAPABILITIES.map(catalogItem) }),
                },
                document,
                onAttach: reference => announce(`Attach ${reference.displayName}`),
            })
            host.append(library.element)
            void library.load()

            return () => library.destroy()
        }

        const empty = createGentelellaEmptyState({
            description: mode === 'artifacts'
                ? 'Artifact libraries list Capability Artifacts, which need installed Capability modules and an API.'
                : 'Conversations are Asset documents edited with the web-ui ProseMirror editor.',
            title: mode === 'artifacts' ? 'No Artifacts in this demo' : 'No conversations in this demo',
        })
        host.append(empty.el)
        signal.addEventListener(
            'abort',
            () => empty.destroy(),
            { once: true },
        )

        return () => empty.destroy()
    }

    destroy(): void {
        this.panel.destroy()
        this.element.remove()
    }
}

export const createWorkspacePanelsPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/canvas-components-lixpi-specific/frontend/workspace · /library',
        title: 'Libraries and panels',
        description: 'Switch modes with the panel switch, resize from the panel edge and collapse it with the toggle. The media library lists the demo Assets; select one to inspect it.',
    })
    const assets = page.own(
        new DemoAssets(),
    )
    const panel = page.own(
        new RightPanelDemo(assets),
    )
    page.onMount(() => panel.mount())

    page.addSection({
        title: 'Right panel',
        content: createShowcaseSpecimen({
            content: panel.element,
            label: "new WorkspaceRightPanel({ mountContent }) in 'media' mode",
        }),
    })
    page.addSection({
        title: 'Library formatting helpers',
        content: page.own(
            createGentelellaCode({
                code: [
                    `formatMediaFileSize(240000) = ${formatMediaFileSize(240000)}`,
                    `formatMediaFileSize(5368709120) = ${formatMediaFileSize(5368709120)}`,
                    `stripMediaFileExtension('Campaign brief.pdf') = ${stripMediaFileExtension('Campaign brief.pdf')}`,
                ].join('\n'),
            }),
        ).el,
    })

    return page
}
