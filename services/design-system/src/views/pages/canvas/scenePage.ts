// The canvas engine with real Canvas Components media nodes: selection,
// marquee, drag, resize, named-port connections, collisions and pan/zoom.

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
    announce,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import { createCanvasStage } from '$src/views/showcase/canvasStage.ts'

const SCENE_NODES: DemoBoardConfig['nodes'] = [
    {
        assetId: 'image-dawn',
        height: 160,
        kind: 'image',
        nodeId: 'dawn',
        width: 240,
        x: 40,
        y: 40,
    },
    {
        assetId: 'image-dusk',
        height: 220,
        kind: 'image',
        nodeId: 'dusk',
        width: 176,
        x: 360,
        y: 20,
    },
    {
        assetId: 'image-sage',
        height: 150,
        kind: 'image',
        nodeId: 'sage',
        width: 150,
        x: 120,
        y: 260,
    },
    {
        assetId: 'video-violet',
        height: 180,
        kind: 'video',
        nodeId: 'clip',
        width: 320,
        x: 620,
        y: 120,
    },
]

const SCENE_EDGES: DemoBoardConfig['edges'] = [
    {
        source: 'dawn',
        target: 'dusk',
    },
    {
        path: 'smoothstep',
        source: 'sage',
        target: 'clip',
    },
    {
        path: 'straight',
        source: 'dusk',
        target: 'clip',
    },
]

export const createCanvasScenePage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/canvas-engine · @lixpi/canvas-components/media',
        title: 'Scene and interaction',
        description: 'A CanvasController renders the scene and reports intents; the page accepts them into its own snapshot, as an application does. Images and video use the Canvas Components registrations, and connector and selection colors use the Lixpi canvas presets.',
    })
    const assets = page.own(
        new DemoAssets(),
    )
    const interactive = createCanvasStage({ height: 480 })
    const readOnly = createCanvasStage({ height: 300 })
    const noCollisions = createCanvasStage({ height: 300 })

    page.onMount(() => {
        page.own(
            new DemoBoard({
                assets,
                edges: SCENE_EDGES,
                nodes: SCENE_NODES,
                root: interactive,
                onError: error => console.error('Canvas scene failed', error),
                onSelectionChange: nodeIds => announce(nodeIds.size ? `Selected ${[...nodeIds].join(', ')}` : 'Selection cleared'),
            }),
        )
        page.own(
            new DemoBoard({
                assets,
                edges: SCENE_EDGES,
                interaction: false,
                nodes: SCENE_NODES,
                root: readOnly,
                viewport: {
                    x: 20,
                    y: 10,
                    zoom: 0.55,
                },
                onError: error => console.error('Canvas scene failed', error),
            }),
        )
        page.own(
            new DemoBoard({
                assets,
                collisions: false,
                nodes: SCENE_NODES.slice(0, 3).map(
                    (node, index) => ({
                        ...node,
                        x: 60 + index * 90,
                        y: 30 + index * 40,
                    }),
                ),
                root: noCollisions,
                onError: error => console.error('Canvas scene failed', error),
            }),
        )
    })

    page.addSection({
        title: 'Interactive scene',
        description: 'Click to select, shift-click to add, drag on empty space for a marquee. Drag nodes, resize from a corner, drag between the side ports to connect, and press Delete to remove. Scroll or pinch to zoom and drag the background to pan. Collision resolution pushes nodes apart when a move commits.',
        content: createShowcaseSpecimen({
            content: interactive,
            label: 'new CanvasController({ collisions: { margin: 24 }, connectors, interaction })',
        }),
    })
    page.addSection({
        title: 'Configurations',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: readOnly,
                label: 'interaction: false, viewport { zoom: 0.55 }',
            }),
            createShowcaseSpecimen({
                content: noCollisions,
                label: 'collisions off: overlapping nodes stay where they are dropped',
            }),
        ],
    })

    return page
}
