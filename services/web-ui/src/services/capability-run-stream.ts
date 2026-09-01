import {
    type CapabilityRunEventStreamPayload,
} from '@lixpi/constants'

export type CapabilityRunEventSegment = {
    type: 'capability_run_event'
    aiProvider: 'Capability'
    conversationAssetId: string
    capabilityRunEvent: CapabilityRunEventStreamPayload['capabilityRunEvent']
    usesServerProseMirror: true
}

export function toCapabilityRunEventSegment(
    payload: CapabilityRunEventStreamPayload,
): CapabilityRunEventSegment {
    return {
        type: 'capability_run_event',
        aiProvider: 'Capability',
        conversationAssetId: payload.conversationAssetId,
        capabilityRunEvent: payload.capabilityRunEvent,
        usesServerProseMirror: true,
    }
}
