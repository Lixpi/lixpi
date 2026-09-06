import {
    type CapabilityJsonValue,
} from '@lixpi/constants'
import {
    assertTimelineTiming,
    parseActionTimelineTiming,
    type ActionTimelineInput,
} from '@lixpi/capability-system'

export type ActionTimelineInputResolution =
    | {
        valid: true
        input: ActionTimelineInput
    }
    | {
        valid: false
        error: 'ACTION_TIMELINE_DURATION_AND_PRECISION_REQUIRED'
        missingInputFields: Array<'durationMs' | 'precisionMs'>
    }

export const resolveActionTimelineInput = ({
    prompt,
    referenceAssetIds,
    routedInput,
    submittedInput,
}: {
    prompt: string
    referenceAssetIds: string[]
    routedInput?: Readonly<Record<string, CapabilityJsonValue>>
    submittedInput?: Readonly<Record<string, CapabilityJsonValue>>
}): ActionTimelineInputResolution => {
    const promptTiming = parseActionTimelineTiming(prompt)
    const durationMs = promptTiming.durationMs
        ?? readNumber(routedInput?.durationMs)
        ?? readNumber(submittedInput?.durationMs)
    const precisionMs = promptTiming.precisionMs
        ?? readNumber(routedInput?.precisionMs)
        ?? readNumber(submittedInput?.precisionMs)

    if (
        durationMs === undefined
        || precisionMs === undefined
    ) {
        return {
            valid: false,
            error: 'ACTION_TIMELINE_DURATION_AND_PRECISION_REQUIRED',
            missingInputFields: [
                ...(durationMs === undefined ? ['durationMs' as const] : []),
                ...(precisionMs === undefined ? ['precisionMs' as const] : []),
            ],
        }
    }

    assertTimelineTiming(durationMs, precisionMs)

    return {
        valid: true,
        input: {
            prompt,
            referenceAssetIds: [...new Set(referenceAssetIds)],
            durationMs,
            precisionMs,
        },
    }
}

function readNumber(value: CapabilityJsonValue | undefined): number | undefined {
    return typeof value === 'number' ? value : undefined
}
