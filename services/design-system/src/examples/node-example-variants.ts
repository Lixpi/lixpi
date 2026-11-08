import { html } from '@lixpi/ui-primitives/dom'
import {
    createPureDropdown,
    type DropdownOption,
    type PureDropdownInstance,
} from '@lixpi/ui-kit/components/dropdown'
import {
    type CanvasExampleInstance,
} from '../catalog/catalog.ts'
import {
    type CanvasNodePage,
} from '../catalog/nodes.ts'
import {
    type FullWorkspaceExampleOptions,
} from './workspace/canvas-examples.ts'
import { ExampleFrame } from './example-frame.ts'

type Variant = {
    id: string
    title: string
    mount: (host: HTMLElement) => Promise<CanvasExampleInstance>
}
type VariantOption = DropdownOption & { value: string }

const ownFrame = (owner: {
    frame: ExampleFrame
    destroy(): void
}): CanvasExampleInstance => ({
    frames: [owner.frame],
    destroy: () => owner.destroy(),
})

class NodeExampleVariants implements CanvasExampleInstance {
    private readonly selector: PureDropdownInstance<VariantOption>
    private readonly parameter: HTMLElement
    private readonly inspectorMarker = html`<span hidden></span>` as HTMLSpanElement
    private current: CanvasExampleInstance | null = null
    private activeVariant: string | null = null
    private generation = 0
    private destroyed = false

    constructor(
        private readonly host: HTMLElement,
        private readonly variants: readonly Variant[],
    ) {
        this.selector = createPureDropdown<VariantOption>({
            id: `node-variant-${crypto.randomUUID()}`,
            triggerLabel: 'Node variant',
            selectedValue: {
                title: variants[0].title,
                value: variants[0].id,
            },
            options: variants.map(
                variant => ({
                    title: variant.title,
                    value: variant.id,
                }),
            ),
            renderIconForOptions: false,
            renderIconForSelectedValue: false,
            mountToBody: true,
            popoverClassName: 'canvas-library-dropdown-popover',
            onSelect: option => void this.select(option.value),
        })
        this.parameter = html`<label className="canvas-example-parameter"><span>Variant</span>${this.selector.dom}</label>` as HTMLLabelElement
    }

    get frames(): readonly ExampleFrame[] {
        return this.current?.frames ?? []
    }

    async mount(): Promise<void> {
        await this.select(this.variants[0].id)
    }

    private showVariant(variant: Variant): void {
        this.activeVariant = variant.id
        this.selector.update({
            title: variant.title,
            value: variant.id,
        })
    }

    private async select(id: string): Promise<void> {
        const variant = this.variants.find(candidate => candidate.id === id)

        if (
            !variant
            || this.destroyed
            || (this.activeVariant === id && this.current)
        )
            return

        const generation = ++this.generation
        const previousInspector = this.current?.frames[0]?.inspector
        this.parameter.remove()

        if (previousInspector?.parentNode)
            previousInspector.replaceWith(this.inspectorMarker)

        this.current?.destroy()
        this.current = null
        this.activeVariant = null

        let owner: CanvasExampleInstance

        try {
            owner = await variant.mount(this.host)
        } catch (error) {
            if (
                this.destroyed
                || generation !== this.generation
            )
                return

            const frame = new ExampleFrame(this.host, '')
            frame.inspector.querySelector('.canvas-example-instructions')?.remove()
            frame.error(error)
            owner = ownFrame({
                frame,
                destroy: () => frame.destroy(),
            })
        }

        if (
            this.destroyed
            || generation !== this.generation
        ) {
            owner.destroy()

            return
        }

        this.current = owner
        this.showVariant(variant)
        const frame = owner.frames[0]
        frame.parameters.prepend(this.parameter)

        if (this.inspectorMarker.parentNode)
            this.inspectorMarker.replaceWith(frame.inspector)
    }

    destroy = (): void => {
        this.destroyed = true
        this.generation += 1
        this.parameter.remove()
        this.selector.destroy()
        this.current?.destroy()
        this.current = null
        this.activeVariant = null
        this.inspectorMarker.remove()
    }
}

const canvasNodeVariant = (page: CanvasNodePage): Variant => ({
    id: 'canvas-node',
    title: 'Canvas node',
    mount: async host => {
        if (['engine-playground', 'media-images', 'media-playback'].includes(page.mode)) {
            const { EngineExample } = await import('./engine-example.ts')
            const example = new EngineExample(
                host,
                page.mode,
                {
                    nodeType: page.nodeType,
                },
            )

            if (!(await example.canvas.ready)) {
                example.destroy()

                throw new Error('Canvas renderer failed to initialize')
            }

            return ownFrame(example)
        }

        if (page.mode === 'workspace-diagram') {
            const { mountWorkspaceExample } = await import('./workspace/index.ts')

            return ownFrame(await mountWorkspaceExample(host, page.mode))
        }

        const { FullWorkspaceExample } = await import('./workspace/canvas-examples.ts')

        return ownFrame(
            new FullWorkspaceExample(
                host,
                {
                    nodeType: page.nodeType as FullWorkspaceExampleOptions['nodeType'],
                    nodeTypes: page.nodeTypes,
                },
            ),
        )
    },
})

const nodeVariants = (page: CanvasNodePage): Variant[] => {
    const variants = [canvasNodeVariant(page)]

    if (page.id === 'node-diagram')
        variants.push({
            id: 'embedded-diagram',
            title: 'Embedded diagram adapter',
            mount: async host => {
                const { DiagramExample } = await import('./diagram-example.ts')

                return ownFrame(
                    new DiagramExample(host),
                )
            },
        })
    else if (page.id === 'node-lixpi-document')
        variants.push({
            id: 'editor-states',
            title: 'Editor lease, loading and retry',
            mount: async host => {
                const { DocumentNodesExample } = await import('./workspace/canvas-examples.ts')

                return ownFrame(
                    new DocumentNodesExample(host),
                )
            },
        })
    else if (page.id === 'node-lixpi-artifact')
        variants.push({
            id: 'artifact-modules',
            title: 'Artifact modules and editor lease',
            mount: async host => {
                const { ArtifactNodesExample } = await import('./workspace/canvas-examples.ts')

                return ownFrame(
                    new ArtifactNodesExample(host),
                )
            },
        })
    else if (
        page.id === 'node-lixpi-operation'
        || page.id === 'node-lixpi-branches'
    )
        variants.push({
            id: page.id === 'node-lixpi-operation' ? 'operation-states' : 'branch-actions',
            title: page.id === 'node-lixpi-operation' ? 'Operation states and actions' : 'Reference resolution and review',
            mount: async host => {
                const { OperationNodesExample } = await import('./workspace/canvas-examples.ts')

                return ownFrame(
                    new OperationNodesExample(host, page.id === 'node-lixpi-operation' ? 'operations' : 'branches'),
                )
            },
        })

    return variants
}

export const mountMetadataShellExample = async (host: HTMLElement): Promise<CanvasExampleInstance> => {
    const { EngineExample } = await import('./engine-example.ts')
    const example = new EngineExample(
        host,
        'node-shell',
        { metadata: true },
    )

    try {
        if (!(await example.canvas.ready))
            throw new Error('Canvas renderer failed to initialize')

        example.frame.toggle(
            'Show shell',
            true,
            enabled => example.setMetadata(enabled),
        )
        const description = html`
            <section className="canvas-example-instructions">
                <p>Compare the empty shell with the shells around the diagram, image, video and audio. Turn off <strong>Show shell</strong> to see the underlying nodes. A playing video keeps its position when you turn the shell back on.</p>
                <p><code>withNodeShell</code> takes an existing node registration. The registered view still draws its content and handles resizing or playback. <code>CanvasNodeShell</code> places a title above that content and two slots below it for metadata and actions. These slots follow the node when you pan or zoom. On a video or audio node, the footer sits below the player controls.</p>
                <p>The host decides what to mount in each slot. Here the title is plain text, the metadata shows dimensions and media version where available, and the footer offers Select and Delete. The empty example leaves the content area vacant so you can inspect those slots on their own.</p>
                <p>In the Lixpi workspace, the title slot can host a ProseMirror editor. The editor integration handles document changes and persistence. The shell passes updates to the mounted slots and releases them with the child view when the node is removed.</p>
            </section>
        ` as HTMLElement
        example.frame.setInstructions(description)

        example.fit()

        return ownFrame(example)
    } catch (error) {
        example.destroy()

        throw error
    }
}

export const mountNodeExample = async (
    host: HTMLElement,
    page: CanvasNodePage,
): Promise<CanvasExampleInstance> => {
    const variants = nodeVariants(page)

    if (variants.length === 1)
        return variants[0].mount(host)

    const example = new NodeExampleVariants(host, variants)

    try {
        await example.mount()

        return example
    } catch (error) {
        example.destroy()

        throw error
    }
}
