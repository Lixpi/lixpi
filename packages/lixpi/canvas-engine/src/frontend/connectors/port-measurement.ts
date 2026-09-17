import {
    type LocalPort,
} from '../../shared/connectors/geometry-types.ts'
import {
    type NodeMeasurement,
} from '../../shared/connectors/node-projection.ts'
import { readPortElement } from './port-elements.ts'

// Reads fallback DOM geometry only when dimensions change. Explicit ports bypass this adapter.
export class PortMeasurement {
    constructor(
        private readonly pane: HTMLElement,
        private readonly ownerId: string,
    ) {}

    read(
        nodeId: string,
        root: HTMLElement,
        zoom: number,
        previous: {
            width: number
            height: number
        },
    ): NodeMeasurement | null {
        const dimensions = {
            width: root.offsetWidth,
            height: root.offsetHeight,
        }

        if (
            !dimensions.width
            || !dimensions.height
            || (dimensions.width === previous.width && dimensions.height === previous.height)
        )
            return null

        if (
            !Number.isFinite(zoom)
            || zoom <= 0
        )
            throw new Error('Port measurement requires positive finite zoom')

        const bounds = root.getBoundingClientRect()
        const ports: LocalPort[] = []

        for (const element of root.querySelectorAll<HTMLElement>('.canvas-port')) {
            const identity = readPortElement(
                element,
                this.pane,
                this.ownerId,
            )

            if (
                !identity
                || identity.nodeId !== nodeId
            )
                continue

            const rect = element.getBoundingClientRect()
            ports.push({
                ...identity,
                x: (rect.left - bounds.left) / zoom,
                y: (rect.top - bounds.top) / zoom,
                width: element.offsetWidth,
                height: element.offsetHeight,
            })
        }

        return {
            dimensions,
            ports,
        }
    }
}
