import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    STREAM_STATUS,
    type CapabilityRunEventStreamPayload,
} from '@lixpi/constants'

import { toCapabilityRunEventSegment } from '$src/services/capability-run-stream.ts'

describe('toCapabilityRunEventSegment', () => {
    it('routes a capability pipeline payload to its conversation transcript', () => {
        const payload: CapabilityRunEventStreamPayload = {
            status: STREAM_STATUS.CAPABILITY_RUN_EVENT,
            aiProvider: 'Capability',
            conversationAssetId: 'conversation-1',
            capabilityRunEvent: {
                runId: 'run-1',
                sequence: 4,
                eventType: 'STEP_COMPLETED',
                timestamp: 10,
                runStatus: 'running',
                stepId: 'build',
                stepStatus: 'completed',
            },
        }

        expect(toCapabilityRunEventSegment(payload)).toEqual({
            type: 'capability_run_event',
            aiProvider: 'Capability',
            conversationAssetId: 'conversation-1',
            capabilityRunEvent: payload.capabilityRunEvent,
            usesServerProseMirror: true,
        })
    })
})
