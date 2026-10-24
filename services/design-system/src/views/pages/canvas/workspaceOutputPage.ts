// Chrome that the workspace mounts around generated output: the title and
// footer strip with review actions, and the video control row below video nodes.

import {
    type VideoCanvasNode,
} from '@lixpi/constants'
import {
    GeneratedOutputNodeChrome,
    WorkspaceVideoChrome,
    type GeneratedOutputChromeState,
} from '@lixpi/canvas-components-lixpi-specific/frontend/media'
import { applyWorkspaceCanvasTheme } from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import { createMediaModelBadge } from '@lixpi/ui-kit/components/media-model-badge'
import {
    gptAvatarIcon,
    geminiColorIcon,
} from '@lixpi/ui-kit/svg'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import { DemoAssets } from '$src/fixtures/demoAssets.ts'
import { settleRecordedVideoDuration } from '$src/fixtures/demoMedia.ts'
import { createWorkspaceAppearance } from '$src/fixtures/workspaceAppearance.ts'
import {
    ShowcasePage,
    announce,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/canvas/canvas-pages.scss'

const NODE_BOUNDS = {
    height: 180,
    width: 280,
    x: 24,
    y: 40,
}
const VIEWPORT = {
    x: 0,
    y: 0,
    zoom: 1,
}

const BASE_STATE: GeneratedOutputChromeState = {
    accepted: false,
    analyzing: false,
    generated: true,
    hasAsset: true,
    pendingBeforeFrame: false,
    progressActive: false,
    rejectable: true,
    reviewReady: true,
    selected: false,
    superseded: false,
}

const VARIANTS: Array<{
    kind: 'artifact' | 'media'
    label: string
    state: Partial<GeneratedOutputChromeState>
}> = [
    {
        kind: 'media',
        label: 'Candidate ready for review',
        state: {},
    },
    {
        kind: 'media',
        label: 'Generating, before the first frame',
        state: {
            pendingBeforeFrame: true,
            progressActive: true,
        },
    },
    {
        kind: 'media',
        label: 'History still sealing',
        state: { reviewReady: false },
    },
    {
        kind: 'media',
        label: 'Accepted and selected',
        state: {
            accepted: true,
            selected: true,
        },
    },
    {
        kind: 'media',
        label: 'Analyzing the description',
        state: {
            accepted: true,
            analyzing: true,
        },
    },
    {
        kind: 'artifact',
        label: "kind: 'artifact'",
        state: {},
    },
]

class OutputChromeDemo {
    readonly element: HTMLElement

    private readonly chrome: GeneratedOutputNodeChrome

    constructor(
        assets: DemoAssets,
        variant: typeof VARIANTS[number],
        index: number,
    ) {
        const appearance = createWorkspaceAppearance()
        const preview = html`
            <img
                className="design-system-output-node"
                alt=""
            />
        ` as HTMLImageElement
        void this.loadPreview(
            assets,
            preview,
            index,
        )
        this.element = html`<div className="design-system-output-stage">${preview}</div>` as HTMLElement
        applyWorkspaceCanvasTheme(this.element, appearance)
        this.chrome = new GeneratedOutputNodeChrome({
            document,
            kind: variant.kind,
            modelBadge: createMediaModelBadge({
                icon: index % 2 === 0 ? geminiColorIcon : gptAvatarIcon,
                modelTitle: index % 2 === 0 ? 'Nano Banana Pro' : 'GPT Image 1',
                providerTitle: index % 2 === 0 ? 'Google' : 'OpenAI',
                separator: appearance.mediaNode.generatedMediaChrome.modelBadgeSeparator,
            }),
            nodeId: `output-${index}`,
            settings: appearance.mediaNode.generatedMediaChrome,
            state: {
                ...BASE_STATE,
                ...variant.state,
            },
            mountTitle: host => {
                const title = html`<span>Variant ${index + 1}</span>`
                host.append(title)

                return () => title.remove()
            },
            onAccept: () => announce('Accept'),
            onOpenDetails: () => announce('Open details'),
            onRegenerate: () => announce('Regenerate'),
            onReject: () => announce('Reject'),
        })
        this.element.append(this.chrome.element)
        this.chrome.setGeometry(NODE_BOUNDS, VIEWPORT)
    }

    private async loadPreview(
        assets: DemoAssets,
        image: HTMLImageElement,
        index: number,
    ): Promise<void> {
        await assets.ready
        image.src = assets.url(['image-dawn', 'image-sage', 'image-dusk'][index % 3], 'original')
    }

    destroy(): void {
        this.chrome.destroy()
        this.element.remove()
    }
}

class VideoChromeDemo {
    readonly element: HTMLElement

    private readonly chrome: WorkspaceVideoChrome
    private readonly video: HTMLVideoElement
    private readonly node: VideoCanvasNode = {
        assetId: 'video-violet',
        dimensions: {
            height: 220,
            width: 392,
        },
        nodeId: 'video-node',
        position: {
            x: 24,
            y: 24,
        },
        type: 'video',
    }
    private zoom = 1

    constructor(private readonly assets: DemoAssets) {
        const appearance = createWorkspaceAppearance()
        this.video = html`
            <video
                loop
                playsinline
            ></video>
        ` as HTMLVideoElement
        this.video.muted = true
        this.chrome = new WorkspaceVideoChrome({
            document,
            getBounds: node => ({
                ...node.position,
                ...node.dimensions,
            }),
            getResizeSettings: () => ({
                ...appearance.mediaNode.resizeHandle,
                useZoomCompensatedScaling: appearance.mediaNode.useZoomCompensatedResizeHandleScaling,
            }),
            getVideo: () => this.video,
            getViewport: () => ({
                ...VIEWPORT,
                zoom: this.zoom,
            }),
            settings: appearance.videoControls,
            startDrag: () => announce('Drag the video node'),
            startResize: (
                _event,
                _nodeId,
                corner,
            ) => announce(`Resize from ${corner}`),
            togglePlayback: () => void (this.video.paused ? this.video.play() : this.video.pause()),
        })
        this.element = html`<div className="design-system-video-chrome-stage">${this.chrome.element}</div>` as HTMLElement
        applyWorkspaceCanvasTheme(this.element, appearance)
    }

    async load(): Promise<void> {
        await this.assets.ready
        this.video.src = this.assets.url('video-violet', 'original')
        settleRecordedVideoDuration(this.video)
        this.chrome.sync([this.node])
    }

    setZoom(zoom: number): void {
        this.zoom = zoom
        this.chrome.update(
            this.node.nodeId,
            {
                ...this.node.position,
                ...this.node.dimensions,
            },
            {
                ...VIEWPORT,
                zoom,
            },
        )
    }

    destroy(): void {
        this.chrome.destroy()
        this.element.remove()
    }
}

export const createWorkspaceOutputPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/canvas-components-lixpi-specific/frontend/media',
        title: 'Output chrome',
        description: 'The strip around generated output composes the UI-kit node footer with a model badge, title editor and review actions. The images stand in for engine-rendered nodes.',
    })
    const assets = page.own(
        new DemoAssets(),
    )

    page.addSection({
        title: 'Generated output chrome',
        description: 'Accept, reject and regenerate appear only while a candidate can be reviewed. setGeometry places the strip below its node in screen coordinates.',
        columns: 3,
        content: VARIANTS.map(
            (variant, index) => createShowcaseSpecimen({
                content: page.own(
                    new OutputChromeDemo(
                        assets,
                        variant,
                        index,
                    ),
                ).element,
                label: variant.label,
            }),
        ),
    })

    const video = page.own(
        new VideoChromeDemo(assets),
    )
    page.onMount(() => void video.load())
    page.addSection({
        title: 'Video chrome',
        description: 'WorkspaceVideoChrome borrows the native video element and mounts the UI-kit controls below it with canvas spacing. Double-click the video to toggle playback. The control row scales with zoom within its bounds.',
        content: createShowcaseSpecimen({
            content: [
                video.element,
                ...[0.6, 1, 1.6].map(
                    zoom => page.own(
                        createGentelellaButton({
                            label: `zoom ${zoom}`,
                            size: 'small',
                            variant: 'outline',
                            onClick: () => video.setZoom(zoom),
                        }),
                    ).el,
                ),
            ],
            label: 'new WorkspaceVideoChrome({ settings: videoControls }).sync([videoNode])',
        }),
    })

    return page
}
