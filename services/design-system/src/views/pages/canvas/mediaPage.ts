// Canvas Components media surfaces: image fitting, corner radius, rendition
// selection by zoom, and native video and audio playback nodes.

import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import { DemoAssets } from '$src/fixtures/demoAssets.ts'
import {
    DemoBoard,
    type DemoBoardConfig,
} from '$src/fixtures/demoBoard.ts'
import {
    ShowcasePage,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import { createCanvasStage } from '$src/views/showcase/canvasStage.ts'

const FIT_NODES: DemoBoardConfig['nodes'] = (['cover', 'contain', 'stretch'] as const).map(
    (fit, index) => ({
        assetId: 'image-dusk',
        fit,
        height: 170,
        kind: 'image',
        nodeId: `fit-${fit}`,
        width: 240,
        x: 30 + index * 280,
        y: 40,
    }),
)

const PLAYBACK_NODES: DemoBoardConfig['nodes'] = [
    {
        assetId: 'video-violet',
        height: 200,
        kind: 'video',
        nodeId: 'video',
        width: 356,
        x: 30,
        y: 30,
    },
    {
        assetId: 'audio-tone',
        height: 80,
        kind: 'audio',
        nodeId: 'audio',
        width: 300,
        x: 430,
        y: 90,
    },
]

export const createCanvasMediaPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/canvas-components/media',
        title: 'Media surfaces',
        description: 'ImageSurface paints engine images with a rounded mask and placeholder. NativePlayback mounts a browser-composited video or audio element; the engine draws its poster.',
    })
    const assets = page.own(
        new DemoAssets(),
    )
    const fits = createCanvasStage({ height: 260 })
    const square = createCanvasStage({ height: 260 })
    const zoomed = createCanvasStage({ height: 220 })
    const playback = createCanvasStage({ height: 280 })
    const error = (failure: unknown): void => void console.error('Canvas media failed', failure)

    page.onMount(() => {
        page.own(
            new DemoBoard({
                assets,
                nodes: FIT_NODES,
                root: fits,
                onError: error,
            }),
        )
        page.own(
            new DemoBoard({
                assets,
                nodes: FIT_NODES,
                radius: 0,
                root: square,
                onError: error,
            }),
        )
        page.own(
            new DemoBoard({
                assets,
                interaction: false,
                nodes: FIT_NODES,
                root: zoomed,
                viewport: {
                    x: 20,
                    y: 20,
                    zoom: 0.3,
                },
                onError: error,
            }),
        )
        page.own(
            new DemoBoard({
                assets,
                nodes: PLAYBACK_NODES,
                root: playback,
                onError: error,
            }),
        )
    })

    page.addSection({
        title: 'Image fitting',
        description: 'The same portrait image in landscape frames, left to right: cover, contain and stretch. Resizing a node refits the image without changing its geometry.',
        content: [
            createShowcaseSpecimen({
                content: fits,
                label: "fit: 'cover' | 'contain' | 'stretch', radius from the Lixpi media preset",
            }),
            createShowcaseSpecimen({
                content: square,
                label: 'radius: 0',
            }),
            createShowcaseSpecimen({
                content: zoomed,
                label: 'viewport { zoom: 0.3 }: the visible footprint selects a smaller rendition',
            }),
        ],
    })
    page.addSection({
        title: 'Native playback',
        description: 'createPlaybackNodeRegistration combines the native element with an engine-drawn poster. Here the host enables the browser controls through onElement; the workspace uses the UI-kit control bar instead.',
        content: createShowcaseSpecimen({
            content: playback,
            label: "kind: 'video' with a poster rendition, and kind: 'audio'",
        }),
    })

    return page
}
