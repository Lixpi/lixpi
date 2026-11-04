import {
    createDiagramCanvas,
    type DiagramCanvasInstance,
} from '@lixpi/canvas-components/diagram'
import {
    arrowRightMarkerBodyLengthFraction,
    createArrowRightMarker,
} from '@lixpi/ui-kit/svg'
import {
    layoutWorkspaceDiagram,
    type WorkspaceDiagram,
    type WorkspaceDiagramEdge,
    type WorkspaceDiagramNode,
} from '../../shared/diagram/workspace-diagram.ts'
import { createLixpiCanvasSettings } from '../settings/canvas-settings.ts'
import { applyWorkspaceCanvasTheme } from '../settings/canvas-theme.ts'
import { getBranchConnectionTargetMarker } from '../connectors/branch-connection-policy.ts'
import { createWorkspaceDiagramNodeRegistration } from './workspace-diagram-node-view.ts'

export type WorkspaceDiagramCanvasOptions = {
    ariaLabel: string
    sceneKey: string
    onError: (error: unknown) => void
}

export type WorkspaceDiagramCanvasInstance = Omit<DiagramCanvasInstance, 'setScene'> & {
    setDiagram: (diagram: WorkspaceDiagram) => void
}

export class WorkspaceDiagramCanvas implements WorkspaceDiagramCanvasInstance {
    readonly el: HTMLDivElement
    private readonly canvas: DiagramCanvasInstance
    private destroyed = false

    constructor(private readonly options: WorkspaceDiagramCanvasOptions) {
        const settings = createLixpiCanvasSettings()
        this.canvas = createDiagramCanvas({
            ...options,
            className: 'workspace-diagram',
            registerNodes: registry => registry.register(
                createWorkspaceDiagramNodeRegistration(),
            ),
            connectionSettings: settings.connector,
            connectionMarker: {
                ...createArrowRightMarker(),
                bodyLengthFraction: arrowRightMarkerBodyLengthFraction,
            },
            connectionPolicy: {
                isCentered: () => true,
                defaultTargetHandle: () => 'left',
                targetMarker: (
                    node,
                    selected,
                    edge,
                ) => getBranchConnectionTargetMarker(
                    (node?.data as WorkspaceDiagramNode | undefined)?.role,
                    selected,
                    (edge.data as WorkspaceDiagramEdge | undefined)?.kind,
                ),
            },
            maxFitZoom: 1,
        })
        this.el = this.canvas.el
        applyWorkspaceCanvasTheme(this.el, settings)
    }

    mount(): void {
        this.canvas.mount()
    }

    setDiagram(diagram: WorkspaceDiagram): void {
        if (this.destroyed)
            return

        const layout = layoutWorkspaceDiagram(diagram, this.options.sceneKey)
        this.canvas.setScene(
            layout.scene,
            {
                size: layout.size,
                fitKey: diagram.revision,
            },
        )
    }

    setLoading(loading: boolean): void {
        this.canvas.setLoading(loading)
    }

    setError(message: string | null): void {
        this.canvas.setError(message)
    }

    refit(): void {
        this.canvas.refit()
    }

    refresh(): void {
        this.canvas.refresh()
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.canvas.destroy()
    }
}

export const createWorkspaceDiagramCanvas = (options: WorkspaceDiagramCanvasOptions): WorkspaceDiagramCanvasInstance =>
    new WorkspaceDiagramCanvas(options)
