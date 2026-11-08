import {
    type CanvasState,
} from '@lixpi/constants'
import {
    type CanvasPersistenceController,
    type WorkspaceCanvasSnapshot,
} from './canvas-persistence-controller.ts'

export type CanvasMembershipTransportRequest = {
    workspaceId: string
    assetId: string
    nodeId: string
    workspaceMutation: {
        expectedCanvasStateUpdatedAt: number
        canvasStateUpdatedAt: number
        canvasState: CanvasState
    }
}

export type WorkspaceCanvasMembershipPorts = {
    attach: (request: CanvasMembershipTransportRequest) => Promise<unknown>
    detach: (request: CanvasMembershipTransportRequest) => Promise<unknown>
    now: () => number
}

export type WorkspaceCanvasMembershipRequest = {
    assetId: string
    nodeId: string
    prepare: (snapshot: WorkspaceCanvasSnapshot) => CanvasState
}

const responseRecord = (response: unknown): Record<string, unknown> => {
    if (
        !response
        || typeof response !== 'object'
    )
        throw new Error('INVALID_CANVAS_MEMBERSHIP_RESPONSE')

    const record = response as Record<string, unknown>

    if (record.error !== undefined)
        throw new Error(typeof record.error === 'string'
            && record.error
            ? record.error
            : 'INVALID_CANVAS_MEMBERSHIP_RESPONSE')

    return record
}

export class WorkspaceCanvasMembership {
    constructor(
        private readonly persistence: CanvasPersistenceController,
        private readonly ports: WorkspaceCanvasMembershipPorts,
    ) {}

    async attach(request: WorkspaceCanvasMembershipRequest): Promise<CanvasState> {
        return await this.mutate('attach', request)
    }

    async detach(request: WorkspaceCanvasMembershipRequest): Promise<CanvasState> {
        return await this.mutate('detach', request)
    }

    private async mutate(
        kind: 'attach' | 'detach',
        request: WorkspaceCanvasMembershipRequest,
    ): Promise<CanvasState> {
        return await this.persistence.runMembershipMutation(async () => {
            const snapshot = this.persistence.readCurrent()
            const expectedCanvasStateUpdatedAt = snapshot?.version.canvasStateUpdatedAt

            if (
                !snapshot
                || !Number.isFinite(expectedCanvasStateUpdatedAt)
            )
                throw new Error('CANVAS_REVISION_REQUIRED')

            const canvasState = structuredClone(
                request.prepare(snapshot),
            )
            const canvasStateUpdatedAt = Math.max(
                this.ports.now(),
                expectedCanvasStateUpdatedAt! + 1,
            )
            const transport = {
                workspaceId: this.persistence.workspaceId,
                assetId: request.assetId,
                nodeId: request.nodeId,
                workspaceMutation: {
                    expectedCanvasStateUpdatedAt: expectedCanvasStateUpdatedAt!,
                    canvasStateUpdatedAt,
                    canvasState,
                },
            }
            const response = responseRecord(await this.ports[kind](transport))

            if (
                kind === 'attach'
                && (response.assetId !== request.assetId || !Array.isArray(response.nodeIds) || !response.nodeIds.includes(request.nodeId))
            )
                throw new Error('INVALID_ASSET_ATTACH_RESPONSE')

            if (
                kind === 'detach'
                && response.success !== true
            )
                throw new Error('INVALID_ASSET_DETACH_RESPONSE')

            const adopted = this.persistence.adoptAuthoritative({
                canvasState,
                version: {
                    updatedAt: canvasStateUpdatedAt,
                    canvasStateUpdatedAt,
                },
            })

            return adopted ? canvasState : this.persistence.readCurrent()?.canvasState ?? canvasState
        })
    }
}
