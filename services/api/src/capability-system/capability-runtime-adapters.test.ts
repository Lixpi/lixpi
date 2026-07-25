import { beforeEach, describe, expect, it, vi } from 'vitest'

import { STREAM_STATUS, type CapabilityRunEvent } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    publish: vi.fn(),
    publishEvent: vi.fn(),
}))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: () => ({ publish: mocks.publish }),
    },
}))

vi.mock('../llm/graph/pipeline-event-log.ts', () => ({
    PipelineEventLog: class {
        publishEvent = mocks.publishEvent
    },
}))

import { mirrorCapabilityRunEventToChat } from './capability-runtime-adapters.ts'

describe('mirrorCapabilityRunEventToChat', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.publishEvent.mockResolvedValue({ streamSequence: 11 })
    })

    it('mirrors attached output geometry through the existing live canvas event', async () => {
        const event: CapabilityRunEvent = {
            runId: 'run-1',
            sequence: 4,
            eventType: 'STEP_COMPLETED',
            timestamp: 1,
            runStatus: 'running',
            stepId: 'persist-output',
            stepStatus: 'completed',
            outputAssetIds: ['asset-1'],
            canvasGeometry: {
                generationRequestId: 'request-1',
                layoutRevision: 5,
                nodes: [{
                    nodeId: 'asset-node-1',
                    position: { x: 10, y: 20 },
                    dimensions: { width: 100, height: 100 },
                }],
            },
        }

        await mirrorCapabilityRunEventToChat({
            event,
            workspaceId: 'workspace-1',
            organizationId: 'organization-1',
            conversationAssetId: 'conversation-1',
        })

        expect(mocks.publishEvent).toHaveBeenCalledTimes(2)
        expect(mocks.publishEvent.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
            eventId: 'capability:run-1:4:canvas',
            payload: expect.objectContaining({
                content: expect.objectContaining({
                    status: STREAM_STATUS.CANVAS_GEOMETRY_RESOLVED,
                    canvasGeometry: event.canvasGeometry,
                }),
            }),
        }))
        expect(mocks.publish).toHaveBeenCalledTimes(2)
    })
})
