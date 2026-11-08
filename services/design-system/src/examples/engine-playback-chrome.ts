import {
    type CanvasThemeSource,
    type CanvasTheme,
} from '@lixpi/canvas-components/theme'
import {
    Lifetime,
    type CanvasController,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    computeDragPlan,
    type CanvasEngineRect,
    type CanvasViewport,
    type EngineNode,
    type NodeGeometryPolicy,
    type ResizeHandle,
} from '@lixpi/canvas-engine/shared'
import { createViewportBridge } from '@lixpi/canvas-engine/frontend/viewport'
import { PlaybackChrome } from '@lixpi/canvas-components/media'
import { createLixpiUiSettings } from '@lixpi/canvas-components/workspace/settings'
import { resolveWorkspaceCanvasTheme } from '@lixpi/canvas-components/workspace'
import '@lixpi/canvas-components/styles/playback-controls'

type PlaybackSceneNode = Pick<EngineNode, 'nodeId' | 'position' | 'dimensions'> & {
    type: 'video' | 'audio'
}

type PlaybackElements = ReadonlyMap<string, HTMLVideoElement | HTMLAudioElement>
type PlaybackChromeOptions = {
    root: HTMLElement
    canvas: CanvasController
    theme: CanvasThemeSource
    geometry: Pick<NodeGeometryPolicy, "movable" | "resize">
    elements: PlaybackElements
    commit: (bounds: ReadonlyMap<string, CanvasEngineRect>) => void
    onError: (error: unknown) => void
}

export class EnginePlaybackChrome {
    private readonly lifetime = new Lifetime()
    private settings: ReturnType<typeof createLixpiUiSettings>
    private chrome: PlaybackChrome<PlaybackSceneNode> | null = null
    private signature = ''
    private destroyed = false

    constructor(private readonly options: PlaybackChromeOptions) {
        this.settings = resolveWorkspaceCanvasTheme(
            options.theme.value,
            createLixpiUiSettings(),
        )
        this.lifetime.own(() => this.chrome?.destroy())
        this.lifetime.own(
            options.theme.subscribe(this.refreshTheme),
        )
        this.lifetime.own(
            options.canvas.scene.subscribeScene(this.sync),
        )
        this.lifetime.own(
            options.canvas.scene.subscribeView(this.sync),
        )
        this.refreshTheme(options.theme.value)
    }

    getFooterOffsetScreen(
        nodeId: string,
        viewport: CanvasViewport,
    ): number {
        return this.chrome?.outsideOffsetScreen(nodeId, viewport) ?? 0
    }

    getControlHeight(): number {
        return this.settings.videoControls.height
    }

    private refreshTheme = (theme: CanvasTheme): void => {
        if (this.destroyed)
            return

        this.settings = resolveWorkspaceCanvasTheme(
            theme,
            createLixpiUiSettings(),
        )

        const signature = JSON.stringify(this.settings.videoControls)

        if (signature !== this.signature) {
            this.signature = signature
            this.chrome?.destroy()
            this.chrome = new PlaybackChrome<PlaybackSceneNode>({
                document: this.options.root.ownerDocument,
                settings: this.settings.videoControls,
                getVideo: nodeId => {
                    const element = this.options.elements.get(nodeId)

                    return element instanceof HTMLVideoElement ? element : null
                },
                getAudio: nodeId => {
                    const element = this.options.elements.get(nodeId)

                    return element instanceof HTMLAudioElement ? element : null
                },
                getBounds: node => this.options.canvas.scene.getNodeGeometry(node.nodeId)?.worldBounds ?? {
                    ...node.position,
                    ...node.dimensions,
                },
                getViewport: () => this.options.canvas.scene.viewport,
                getResizeSettings: () => ({
                    ...this.settings.mediaNode.resizeHandle,
                    useZoomCompensatedScaling: true,
                }),
                startDrag: this.startDrag,
                startResize: this.startResize,
                togglePlayback: nodeId => {
                    const element = this.options.elements.get(nodeId)

                    if (!element)
                        return

                    if (element.paused)
                        void this.play(element)
                    else
                        element.pause()
                },
            })
            this.options.root.append(this.chrome.element)
        }

        this.sync()
    }

    private async play(element: HTMLMediaElement): Promise<void> {
        try {
            await element.play()
        } catch (error) {
            if (!this.destroyed)
                this.options.onError(error)
        }
    }

    sync = (): void => {
        if (
            this.destroyed
            || !this.chrome
        )
            return

        const canvas = this.options.canvas
        const nodes: PlaybackSceneNode[] = canvas.scene.scene.nodes.flatMap(
            node => node.type === 'video'
                || node.type === 'audio'
                ? [{
                    nodeId: node.nodeId,
                    type: node.type,
                    position: node.position,
                    dimensions: node.dimensions,
                }]
                : [],
        )
        createViewportBridge({ viewportEl: this.chrome.element }).applyViewport(canvas.scene.viewport)
        this.chrome.sync(nodes)
    }

    private startDrag = (
        event: MouseEvent,
        nodeId: string,
    ): void => {
        event.preventDefault()
        event.stopPropagation()
        const canvas = this.options.canvas
        const plan = computeDragPlan({
            nodes: canvas.scene.scene.nodes,
            primaryNodeId: nodeId,
            selectedNodeIds: canvas.selection.nodeIds,
            canDrag: () => this.options.geometry.movable ?? false,
        })
        canvas.startNodeDrag({
            event,
            targets: plan.draggedNodeIds.map(
                id => ({
                    nodeId: id,
                    bounds: canvas.scene.getNodeGeometry(id)!.worldBounds,
                }),
            ),
            threshold: 3,
            onStart: () => {
                if (!canvas.selection.has(nodeId))
                    canvas.setSelected([nodeId])
            },
            onChange: this.sync,
            onEnd: (
                _event,
                bounds,
                moved,
            ) => {
                if (moved)
                    this.options.commit(bounds)
                else
                    canvas.setSelected([nodeId])

                this.sync()
            },
            onCancel: this.sync,
        })
    }

    private startResize = (
        event: MouseEvent,
        nodeId: string,
        handle: ResizeHandle,
    ): void => {
        event.preventDefault()
        event.stopPropagation()
        const canvas = this.options.canvas
        canvas.setSelected([nodeId])
        canvas.startNodeResize({
            event,
            target: {
                nodeId,
                bounds: canvas.scene.getNodeGeometry(nodeId)!.worldBounds,
            },
            handle,
            constraints: structuredClone(this.options.geometry.resize),
            onChange: this.sync,
            onEnd: (
                _event,
                bounds,
                moved,
            ) => {
                if (moved)
                    this.options.commit(bounds)

                this.sync()
            },
            onCancel: this.sync,
        })
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.lifetime.destroy()
    }
}
