import {
    type CanvasEnginePoint,
} from '../geometry/index.ts'
import {
    type PortIdentity,
    type ResolvedPort,
} from './geometry-types.ts'

export const selectPortCandidate = (
    ports: readonly ResolvedPort[],
    start: ResolvedPort,
    pointer: CanvasEnginePoint,
    radius: number,
    direct: PortIdentity | null,
): ResolvedPort | null => {
    let target: ResolvedPort | null = null
    let distance = radius

    for (const port of ports) {
        if (
            port.type === start.type
            || port.nodeId === start.nodeId
        )
            continue

        const nextDistance = Math.hypot(port.x - pointer.x, port.y - pointer.y)

        if (nextDistance <= distance) {
            target = port
            distance = nextDistance
        }
    }

    // Direct hits remain candidates even if policy rejects them; rejection is not empty space.
    if (direct)
        return ports.find(port => port.nodeId === direct.nodeId && port.id === direct.id && port.type !== start.type) ?? target

    return target
}
