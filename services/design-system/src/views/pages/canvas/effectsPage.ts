// Canvas Components effects: traveling outlines around engine content, a glass
// border that refracts the canvas behind DOM controls, and the material bakers
// that both effects and the Lixpi model circles use.

import {
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import {
    type CanvasExtension,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    TravelingOutline,
    type TravelingOutlineDatum,
} from '@lixpi/canvas-components/effects/outline'
import {
    CircularGlassMaterial,
    ClosedGlassStripMaterial,
    DomGlassBorder,
    TravelingSnakeGlassMaterial,
    type GlassBorderStyle,
    type GlassPixels,
} from '@lixpi/canvas-components/effects/glass'
import { getWorkspaceLoadingPresentation } from '@lixpi/canvas-components-lixpi-specific/frontend/loading'
import { createLixpiCanvasSettings } from '@lixpi/canvas-components-lixpi-specific/frontend/settings'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { html } from '@lixpi/ui-primitives/dom'
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
import '$src/views/pages/canvas/canvas-pages.scss'

const OUTLINED_NODES: DemoBoardConfig['nodes'] = [
    {
        assetId: 'image-dawn',
        height: 160,
        kind: 'image',
        nodeId: 'clockwise',
        width: 240,
        x: 50,
        y: 60,
    },
    {
        assetId: 'image-sage',
        height: 170,
        kind: 'image',
        nodeId: 'counterclockwise',
        width: 170,
        x: 360,
        y: 50,
    },
    {
        assetId: 'image-dusk',
        height: 200,
        kind: 'image',
        nodeId: 'slow',
        width: 160,
        x: 620,
        y: 40,
    },
]

const DATUM_OPTIONS: Record<string, Partial<TravelingOutlineDatum>> = {
    clockwise: { direction: 'clockwise' },
    counterclockwise: { direction: 'counterclockwise' },
    slow: {
        durationMs: 4000,
        snakeLengthFraction: 0.35,
    },
}

// Outlines follow the scene: each snapshot re-syncs one datum per node.
const createOutlineExtension = (radius: number): CanvasExtension => ({
    id: 'design-system-outlines',
    mount: context => {
        const outline = new TravelingOutline({
            ...getWorkspaceLoadingPresentation(
                createLixpiCanvasSettings(),
            ).outline,
            surface: context,
        })

        return context.subscribeScene(
            scene => outline.sync(
                scene.nodes.map(
                    (node: EngineNode) => ({
                        ...node.position,
                        ...node.dimensions,
                        id: node.nodeId,
                        radius,
                        visible: true,
                        ...DATUM_OPTIONS[node.nodeId],
                    }),
                ),
            ),
        )
    },
})

class GlassDemo {
    readonly element: HTMLElement

    private glass: DomGlassBorder | null = null
    private board: DemoBoard | null = null
    private readonly targets: HTMLElement[]
    private readonly glassStyle: GlassBorderStyle
    private readonly glassTexture: GlassPixels

    constructor(private readonly assets: DemoAssets) {
        const settings = createLixpiCanvasSettings()
        this.targets = ['Toolbar', 'Composer'].map(
            label => createGentelellaButton({
                className: `design-system-glass-target design-system-glass-target-${label.toLowerCase()}`,
                label,
                variant: 'ghost',
            }).el,
        )
        this.element = createCanvasStage({ height: 320 })
        this.element.append(...this.targets)
        this.glassStyle = {
            ...settings.canvasChrome.glassBorder,
            edgeFeatherFraction: settings.canvasChrome.glassBorder.glassMaterial.edgeFeatherFraction,
        }
        this.glassTexture = new ClosedGlassStripMaterial(
            settings.canvasChrome.glassBorder.materialColors,
            settings.canvasChrome.glassBorder.materialTailAlpha,
            settings.canvasChrome.glassBorder.glassMaterial,
        ).bake()
    }

    mount(): void {
        this.board = new DemoBoard({
            assets: this.assets,
            extensions: [{
                id: 'design-system-glass',
                mount: context => {
                    this.glass = new DomGlassBorder({
                        root: this.element,
                        style: this.glassStyle,
                        surface: context,
                        texture: this.glassTexture,
                    })
                    this.glass.setTargets(
                        this.targets.map(
                            (element, index) => ({
                                element,
                                id: `target-${index}`,
                            }),
                        ),
                    )

                    return () => this.glass?.destroy()
                },
            }],
            nodes: OUTLINED_NODES.map(
                (node, index) => ({
                    ...node,
                    x: 60 + index * 260,
                    y: 70,
                }),
            ),
            renderer: { beforeRender: () => this.glass?.refresh() },
            root: this.element,
            onError: error => console.error('Glass border failed', error),
        })
    }

    destroy(): void {
        this.board?.destroy()
        this.board = null
        this.glass = null
        this.element.remove()
    }
}

const pixelsToCanvas = (pixels: GlassPixels): HTMLCanvasElement => {
    const canvas = html`
        <canvas
            className="design-system-material-preview"
            width=${pixels.size.width}
            height=${pixels.size.height}
        ></canvas>
    ` as HTMLCanvasElement
    canvas.getContext('2d')?.putImageData(
        new ImageData(
            new Uint8ClampedArray(pixels.rgba),
            pixels.size.width,
            pixels.size.height,
        ),
        0,
        0,
    )

    return canvas
}

export const createCanvasEffectsPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/canvas-components/effects',
        title: 'Outlines and glass',
        description: 'Effects compose the engine drawing API. The outline style and glass material come from the Lixpi canvas presets, so these match the workspace.',
    })
    const assets = page.own(
        new DemoAssets(),
    )
    const settings = createLixpiCanvasSettings()
    const outlines = createCanvasStage({ height: 320 })
    const glass = page.own(
        new GlassDemo(assets),
    )

    page.onMount(() => {
        page.own(
            new DemoBoard({
                assets,
                extensions: [createOutlineExtension(settings.mediaNode.styles.borderRadius)],
                nodes: OUTLINED_NODES,
                root: outlines,
                onError: error => console.error('Traveling outline failed', error),
            }),
        )
        glass.mount()
    })

    page.addSection({
        title: 'Traveling outline',
        description: 'The generating-media outline. Left to right: clockwise, counterclockwise, and a slower lap with a shorter trail. Drag a node and its outline follows.',
        content: createShowcaseSpecimen({
            content: outlines,
            label: 'new TravelingOutline({ style, texture: TravelingSnakeGlassMaterial.bake() })',
        }),
    })
    page.addSection({
        title: 'Glass border',
        description: 'DomGlassBorder measures the two DOM controls and refracts the engine content behind their edges. It samples only engine-drawn pixels, so drag an image under a control to see the refraction.',
        content: createShowcaseSpecimen({
            content: glass.element,
            label: 'new DomGlassBorder({ root, style: canvasChrome.glassBorder, texture: ClosedGlassStripMaterial })',
        }),
    })

    const outlineAnimation = settings.mediaNode.inProgressOutlineAnimation
    const circle = settings.mediaBranchLineage.mediaModelCircle.glass
    const circles = [circle.fallbackColors, ['#d97757', '#f6c7b3', '#a55324'], ['#4285f4', '#c3dedd', '#3d649c']].map(
        colors => new CircularGlassMaterial(
            colors,
            0,
            circle.material,
            {
                discStyle: circle.discMaterial,
                rimFeatherFraction: circle.rimFeatherFraction,
                size: circle.textureSize,
                translucency: circle.translucency,
            },
        ).bakeDataUrl(),
    )
    page.addSection({
        title: 'Glass materials',
        description: 'bake() returns RGBA pixels for an engine texture. The circular material also bakes a data URL for DOM backgrounds, which the branch-marker model circles use.',
        columns: 3,
        content: [
            createShowcaseSpecimen({
                content: pixelsToCanvas(
                    new TravelingSnakeGlassMaterial(
                        outlineAnimation.styles.snakeColors,
                        outlineAnimation.styles.snakeTailAlpha,
                        outlineAnimation.styles.glassMaterial,
                    ).bake(),
                ),
                label: 'TravelingSnakeGlassMaterial',
                surface: 'dark',
            }),
            createShowcaseSpecimen({
                content: pixelsToCanvas(
                    new ClosedGlassStripMaterial(
                        settings.canvasChrome.glassBorder.materialColors,
                        settings.canvasChrome.glassBorder.materialTailAlpha,
                        settings.canvasChrome.glassBorder.glassMaterial,
                    ).bake(),
                ),
                label: 'ClosedGlassStripMaterial',
                surface: 'dark',
            }),
            createShowcaseSpecimen({
                content: circles.map(url => {
                    const disc = html`<span className="design-system-glass-disc"></span>` as HTMLElement
                    disc.style.backgroundImage = url ? `url(${url})` : ''

                    return disc
                }),
                label: 'CircularGlassMaterial.bakeDataUrl()',
            }),
        ],
    })

    return page
}
