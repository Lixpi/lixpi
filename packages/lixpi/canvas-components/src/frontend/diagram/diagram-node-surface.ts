import {
    type CanvasEngineRect,
    type NodeGeometryPolicy,
} from '@lixpi/canvas-engine/shared'
import {
    type CanvasDrawingSurface,
} from '@lixpi/canvas-engine/frontend/rendering'

export type DiagramNodePaint = {
    fill: string
    stroke: string
    strokeWidth?: number
}

export type DiagramNodeAppearance = DiagramNodePaint & {
    shape?: 'rounded-rectangle' | 'circle'
    cornerRadius?: number
    selected?: boolean
    selectedStyle?: Partial<DiagramNodePaint>
}

export type DiagramNodeSurfaceOptions = {
    surface: CanvasDrawingSurface
    bounds: CanvasEngineRect
    appearance: DiagramNodeAppearance
}

const roundedRectangle = (
    width: number,
    height: number,
    radius: number,
): string => {
    const r = Math.max(
        0,
        Math.min(
            radius,
            width / 2,
            height / 2,
        ),
    )

    return `M${r} 0 H${width - r} Q${width} 0 ${width} ${r} V${height - r} Q${width} ${height} ${width - r} ${height} H${r} Q0 ${height} 0 ${height - r} V${r} Q0 0 ${r} 0 Z`
}

const circle = (
    width: number,
    height: number,
): string => {
    const radius = Math.min(width, height) / 2
    const x = width / 2
    const y = height / 2

    return `M${x - radius} ${y} A${radius} ${radius} 0 1 0 ${x + radius} ${y} A${radius} ${radius} 0 1 0 ${x - radius} ${y} Z`
}

// Fixed diagrams share their measured footprints but never commit geometry edits.
export const createFixedDiagramNodeGeometry = <Data>(): NodeGeometryPolicy<Data> => ({
    measure: node => {
        const bounds = {
            ...node.position,
            ...node.dimensions,
        }

        return {
            visualBounds: bounds,
            hitBounds: bounds,
            selectionBounds: bounds,
            collisionBounds: bounds,
            connectorBounds: bounds,
        }
    },
    resize: {
        min: {
            width: 1,
            height: 1,
        },
        preserveAspectRatio: true,
    },
    movable: false,
})

// The drawing scope owns the backing allocations. This surface owns only its group.
export class DiagramNodeSurface {
    private readonly group
    private readonly path
    private bounds: CanvasEngineRect
    private appearance: DiagramNodeAppearance
    private selected = false
    private destroyed = false

    constructor(private readonly options: DiagramNodeSurfaceOptions) {
        this.bounds = { ...options.bounds }
        this.appearance = options.appearance
        this.group = options.surface.resources.createGroup({
            space: 'world',
            layer: options.surface.layers.media,
        })

        try {
            this.path = options.surface.resources.createPath(this.group, [])
            this.paint()
        } catch (error) {
            options.surface.resources.release(this.group)

            throw error
        }
    }

    setBounds(bounds: CanvasEngineRect): void {
        if (this.destroyed)
            return

        this.bounds = { ...bounds }
        this.paint()
    }

    setAppearance(appearance: DiagramNodeAppearance): void {
        if (this.destroyed)
            return

        this.appearance = appearance
        this.paint()
    }

    setSelected(selected: boolean): void {
        if (this.destroyed)
            return

        this.selected = selected
        this.paint()
    }

    setVisible(visible: boolean): void {
        if (!this.destroyed)
            this.options.surface.resources.setVisible(this.group, visible)
    }

    private paint(): void {
        const {
            x,
            y,
            width,
            height,
        } = this.bounds
        const appearance = this.selected
            || this.appearance.selected
            ? {
                ...this.appearance,
                ...this.appearance.selectedStyle,
            }
            : this.appearance
        this.options.surface.resources.updateGroup(
            this.group,
            { position: {
                x,
                y,
            } },
        )
        this.options.surface.resources.updatePath(
            this.path,
            [{
                path: appearance.shape === 'circle'
                    ? circle(width, height)
                    : roundedRectangle(
                        width,
                        height,
                        appearance.cornerRadius ?? 12,
                    ),
                fill: { color: appearance.fill },
                stroke: {
                    color: appearance.stroke,
                    width: appearance.strokeWidth ?? 1,
                },
            }],
        )
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.options.surface.resources.release(this.group)
    }
}
