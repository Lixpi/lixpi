import {
    type PortIdentity,
} from '../../shared/connectors/geometry-types.ts'

export const portElementData = (
    ownerId: string,
    port: PortIdentity,
): Record<string, string> => ({
    canvasOwnerId: ownerId,
    canvasNodeId: port.nodeId,
    canvasPortId: port.id ?? '',
    canvasPortRole: port.type,
    canvasPortDirection: port.position,
})

export const readPortElement = (
    element: HTMLElement,
    pane: HTMLElement,
    ownerId: string,
): PortIdentity | null => {
    const data = element.dataset

    if (
        !pane.contains(element)
        || data.canvasOwnerId !== ownerId
        || !data.canvasNodeId
        || !['source', 'target'].includes(data.canvasPortRole ?? '')
        || !['left', 'right', 'top', 'bottom'].includes(data.canvasPortDirection ?? '')
    )
        return null

    return {
        nodeId: data.canvasNodeId,
        id: data.canvasPortId || null,
        type: data.canvasPortRole as PortIdentity['type'],
        position: data.canvasPortDirection as PortIdentity['position'],
    }
}
