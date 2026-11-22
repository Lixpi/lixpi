import {
    type ExampleFrame,
} from '../examples/example-frame.ts'
import { workspaceExamples } from '../examples/workspace/catalog.ts'

import { componentCoverage } from './coverage.ts'
import {
    canvasNodeExamples,
    canvasNodePages,
} from './nodes.ts'
import { uiExamples } from './ui-examples.ts'
import { html } from '@lixpi/ui-primitives/dom'

export type DocumentationExample = {
    id: string
    title: string
    group: string
    summary: string
    source: string
    components?: readonly string[]
    nodes?: readonly string[]
}

const coreExamples: readonly DocumentationExample[] = [
    {
        id: 'nested-list',
        title: 'Nested list navigation',
        group: 'ProseMirror',
        summary: 'The shared ProseMirror nested-list editor with plain and custom items, tags, protected content, drag movement, and Save and Cancel in an in-memory fixture.',
        source: '@lixpi/prosemirror/frontend/nested-list',
    },
    {
        id: "icons",
        title: "Icons",
        group: 'UI kit',
        summary: 'Search the actual public UI-kit SVG icons by export name.',
        source: "@lixpi/ui-kit/svg",
    },
    {
        id: 'engine-connector-matrix',
        title: 'Connector types and styles',
        group: 'Engine',
        summary: 'All five path types with solid and dashed lines, every marker mode, source and target anchors, curvature, corner radius, explicit waypoints, lane routing and zoom-aware stroke settings.',
        source: '@lixpi/canvas-engine/frontend/connectors',
    },
    {
        id: 'engine-proximity',
        title: 'Proximity connections',
        group: 'Engine',
        summary: 'Drag a source toward allowed targets to preview and commit a connection through the generic proximity policy. Adjust distance, disable the policy and inspect rejected candidates.',
        source: '@lixpi/canvas-engine/frontend/connectors',
    },
    {
        id: 'engine-collisions',
        title: 'Collision solver',
        group: 'Engine',
        summary: 'Interactive resolveCollisions and resolveRigidCanvasNodeGroupCollisions with margins, overlap thresholds, iteration limits, fixed anchors, excluded pairs and preserved group geometry.',
        source: '@lixpi/canvas-engine/shared',
    },
    {
        id: 'engine-tidy-tree',
        title: 'Tidy tree layout',
        group: 'Engine',
        summary: 'The shared left-to-right layoutTree algorithm with variable node geometry, depth and sibling gaps, per-branch fanout spacing, input sibling order and host-owned tree ancestry.',
        source: '@lixpi/canvas-engine/shared',
    },
    {
        id: 'engine-parenting',
        title: 'Parents, groups and collisions',
        group: 'Engine',
        summary: 'Parent-relative nodes, descendant movement, collision resolution and grouped geometry updates. Drag the parent, its children or the separate collision target.',
        source: '@lixpi/canvas-engine/shared',
    },
    {
        id: 'engine-routing',
        title: 'Connections and routing',
        group: 'Engine',
        summary: 'Named input/output ports on all four sides, orthogonal and Bezier routes, obstacle avoidance, connection creation, reconnection and deletion.',
        source: '@lixpi/canvas-engine/frontend/connectors',
    },
    {
        id: 'engine-multiple',
        title: 'Independent canvases',
        group: 'Engine',
        summary: 'Two separate controllers, scenes, selections, viewports, gesture owners and renderer lifetimes. Removing one canvas leaves the other active.',
        source: '@lixpi/canvas-engine/frontend/runtime',
    },
    {
        id: 'engine-large-scene',
        title: 'Large scene stress test',
        group: 'Stress testing',
        summary: 'Generate 1000 nodes by default, enter larger scene counts, and inspect real viewport culling, bounded prefetch and retained scene data. Every valid count regenerates the full scene; pan and zoom to visit off-screen nodes.',
        source: '@lixpi/canvas-engine/frontend/runtime',
    },
    {
        id: 'engine-validation',
        title: 'Scene validation and diagnostics',
        group: 'Engine',
        summary: 'Invalid geometry is rejected before replacing the active scene. An unregistered node produces the engine diagnostic shell and a diagnostic event.',
        source: '@lixpi/canvas-engine/shared',
    },
    {
        id: 'effects-glass',
        title: 'Glass borders and materials',
        group: 'Effects and loading',
        summary: 'GlassBorder, DomGlassBorder, ClosedGlassStripMaterial and CircularGlassMaterial: explicit and DOM-measured refraction targets, capture exclusion, resize measurement and scoped resource disposal.',
        source: '@lixpi/canvas-components/effects/glass',
    },
    {
        id: 'effects-outline',
        title: 'Traveling outlines',
        group: 'Effects and loading',
        summary: 'TravelingOutline uses shared material pixels and engine mesh resources. Clockwise and counterclockwise targets follow committed geometry and pause while hidden.',
        source: '@lixpi/canvas-components/effects/outline',
    },
    {
        id: 'loading-overlay',
        title: 'Loading overlay',
        group: 'Effects and loading',
        summary: 'LoadingOverlay renders the shared glass outline without waiting for a GPU renderer. Exercise visible, hidden, failed and retry states.',
        source: '@lixpi/canvas-components/loading',
    },
    {
        id: 'loading-layer',
        title: 'Concurrent loading requests',
        group: 'Effects and loading',
        summary: 'LoadingLayer owns one overlay for independent leases. Complete requests separately and retry an error while other requests remain active.',
        source: '@lixpi/canvas-components/loading/layer',
    },
]

export const documentationExamples: readonly DocumentationExample[] = [...coreExamples.map(
    example => ({
        ...example,
        components: componentCoverage[example.id],
    }),
), ...workspaceExamples, ...canvasNodeExamples, ...uiExamples]

export type DocumentationExampleInstance = {
    frames: readonly ExampleFrame[]
    destroy: () => void
}

export type ExampleOwner = {
    frame: ExampleFrame
    destroy: () => void
}

// Every UI package example module exports one factory that mounts the
// example registered under the given ID.
type ExampleModule = {
    createExample: (
        host: HTMLElement,
        id: string,
    ) => ExampleOwner
}

const themeExamples = (): Promise<ExampleModule> => import('../examples/themes/theme-examples.ts')
const controlExamples = (): Promise<ExampleModule> => import('../examples/ui-kit/control-examples.ts')
const menuExamples = (): Promise<ExampleModule> => import('../examples/ui-kit/menu-examples.ts')
const overlayExamples = (): Promise<ExampleModule> => import('../examples/ui-kit/overlay-examples.ts')
const surfaceExamples = (): Promise<ExampleModule> => import('../examples/ui-kit/surface-examples.ts')
const statusExamples = (): Promise<ExampleModule> => import('../examples/ui-kit/status-examples.ts')
const primitiveExamples = (): Promise<ExampleModule> => import('../examples/ui-primitives/primitive-examples.ts')
const documentExamples = (): Promise<ExampleModule> => import('../examples/prosemirror/document-examples.ts')
const codeThemeExamples = (): Promise<ExampleModule> => import('../examples/prosemirror-themes/code-theme-examples.ts')
const webClientExamples = (): Promise<ExampleModule> => import('../examples/web-client/web-client-examples.ts')

const uiExampleModules: Readonly<Record<string, () => Promise<ExampleModule>>> = {
    'themes-presets': themeExamples,
    'themes-scope': themeExamples,
    'themes-binding': themeExamples,
    'ui-kit-button': controlExamples,
    'ui-kit-text-input': controlExamples,
    'ui-kit-toggle-switch': controlExamples,
    'ui-kit-sliding-switch': controlExamples,
    'ui-kit-sliding-tabs-switch': controlExamples,
    'ui-kit-slider': controlExamples,
    'ui-kit-sliding-dropdown': controlExamples,
    'ui-kit-tag-pill': controlExamples,
    'ui-kit-action-panel': menuExamples,
    'ui-kit-dropdown': menuExamples,
    'ui-kit-bubble-menu': menuExamples,
    'ui-kit-bubble-menu-dropdown': menuExamples,
    'ui-kit-help-tooltip': overlayExamples,
    'ui-kit-info-bubble': overlayExamples,
    'ui-kit-context-preview': overlayExamples,
    'ui-kit-interactive-preview': overlayExamples,
    'ui-kit-application-panel': surfaceExamples,
    'ui-kit-auth-panel': surfaceExamples,
    'ui-kit-block-card-tiles': surfaceExamples,
    'ui-kit-typography': surfaceExamples,
    'ui-kit-progress-timeline': statusExamples,
    'ui-kit-progress-ripple': statusExamples,
    'ui-kit-canvas-node-footer': statusExamples,
    'ui-kit-error-placeholder': statusExamples,
    'ui-kit-video-controls': statusExamples,
    'ui-kit-media-model-badge': statusExamples,
    'ui-kit-animated-icons': statusExamples,
    'primitives-dom': primitiveExamples,
    'primitives-svg-icons': primitiveExamples,
    'primitives-svg-paths': primitiveExamples,
    'primitives-easing': primitiveExamples,
    'primitives-shifting-gradient': primitiveExamples,
    'primitives-color': primitiveExamples,
    'primitives-scrollbars': primitiveExamples,
    'prosemirror-rich-text': documentExamples,
    'prosemirror-code-block': documentExamples,
    'prosemirror-document-view': documentExamples,
    'prosemirror-themes-gallery': codeThemeExamples,
    'web-client-router': webClientExamples,
    'web-client-route-views': webClientExamples,
    'web-client-stores': webClientExamples,
    'web-client-application': webClientExamples,
}

const ownExample = (example: ExampleOwner): DocumentationExampleInstance => ({
    frames: [example.frame],
    destroy: () => example.destroy(),
})

class IndependentCanvases {
    readonly frames: ExampleFrame[] = []
    private readonly el = html`<div className="canvas-example-split"></div>` as HTMLDivElement
    private readonly owners: Array<{ destroy: () => void }> = []

    async mount(host: HTMLElement): Promise<void> {
        host.append(this.el)
        const { EngineExample } = await import('../examples/engine-example.ts')

        for (let index = 0; index < 2; index += 1) {
            const pane = html`<div className="canvas-example-independent"></div>` as HTMLDivElement
            this.el.append(pane)
            const example = new EngineExample(pane, 'engine-playground')
            this.owners.push(example)
            this.frames.push(example.frame)
            example.frame.inspector.prepend(html`<h3>Canvas ${index + 1}</h3>` as HTMLHeadingElement)
            example.frame.button('Dispose this canvas', () => {
                example.destroy()
                pane.textContent = 'This canvas is disposed. The other canvas remains interactive.'
            })

            if (!(await example.canvas.ready))
                throw new Error('Canvas renderer failed to initialize')
        }
    }

    destroy(): void {
        for (const owner of this.owners)
            owner.destroy()

        this.el.remove()
    }
}

export const mountDocumentationExample = async (
    host: HTMLElement,
    id: string,
): Promise<DocumentationExampleInstance> => {
    const uiExampleModule = uiExampleModules[id]

    if (uiExampleModule) {
        const { createExample } = await uiExampleModule()

        return ownExample(
            createExample(host, id),
        )
    }

    if (id === 'nested-list') {
        const { NestedListExample } = await import('../examples/nested-list-example.ts')

        return ownExample(
            new NestedListExample(host),
        )
    }

    if (id === 'icons') {
        const { IconsExample } = await import('../examples/icons-example.ts')

        return ownExample(
            new IconsExample(host),
        )
    }

    if (id === 'node-shell') {
        const { mountMetadataShellExample } = await import('../examples/node-example-variants.ts')

        return mountMetadataShellExample(host)
    }

    const nodePage = canvasNodePages.find(page => page.id === id)

    if (nodePage) {
        const { mountNodeExample } = await import('../examples/node-example-variants.ts')

        return mountNodeExample(host, nodePage)
    }

    if (['engine-connector-matrix', 'engine-proximity', 'engine-collisions', 'engine-tidy-tree'].includes(id)) {
        let example: {
            frame: ExampleFrame
            board: { canvas: { ready: Promise<boolean> } }
            destroy: () => void
        }

        if (id === 'engine-connector-matrix') {
            const { ConnectorMatrixExample } = await import('../examples/connector-matrix-example.ts')
            example = new ConnectorMatrixExample(host)
        } else if (id === 'engine-proximity') {
            const { ProximityExample } = await import('../examples/proximity-example.ts')
            example = new ProximityExample(host)
        } else if (id === 'engine-collisions') {
            const { CollisionExample } = await import('../examples/collision-example.ts')
            example = new CollisionExample(host)
        } else {
            const { TidyTreeExample } = await import('../examples/tidy-tree-example.ts')
            example = new TidyTreeExample(host)
        }

        if (!(await example.board.canvas.ready)) {
            example.destroy()

            throw new Error('Canvas renderer failed to initialize')
        }

        return ownExample(example)
    }

    if (!documentationExamples.some(example => example.id === id))
        throw new Error(`Unknown documentation example: ${id}`)

    if (id.startsWith('workspace-')) {
        const { mountWorkspaceExample } = await import('../examples/workspace/index.ts')

        return ownExample(await mountWorkspaceExample(host, id))
    }

    if (id === 'engine-multiple') {
        const example = new IndependentCanvases()

        try {
            await example.mount(host)

            return example
        } catch (error) {
            example.destroy()

            throw error
        }
    }

    if (
        id.startsWith('loading-')
        || id.startsWith('effects-')
    ) {
        const {
            LoadingExample,
            EffectsExample,
        } = await import('../examples/effects-example.ts')

        if (id.startsWith('loading-'))
            return ownExample(
                new LoadingExample(host, id),
            )

        const example = new EffectsExample(host, id)

        if (!(await example.board.canvas.ready)) {
            example.destroy()

            throw new Error('Canvas renderer failed to initialize')
        }

        return ownExample({
            frame: example.board.frame,
            destroy: () => example.destroy(),
        })
    }

    const { EngineExample } = await import('../examples/engine-example.ts')
    const example = new EngineExample(host, id)

    if (!(await example.canvas.ready)) {
        example.destroy()

        throw new Error('Canvas renderer failed to initialize')
    }

    return ownExample(example)
}
