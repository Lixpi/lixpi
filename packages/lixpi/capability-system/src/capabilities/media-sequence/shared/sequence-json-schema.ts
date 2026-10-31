import { createMediaSequence } from './media-sequence.ts'

type JsonSchema = Record<string, unknown>

const sequenceDefaults = createMediaSequence('schema-defaults')
export const sequenceCreationDescription = `New sequences use ${sequenceDefaults.timeBase.denominator / sequenceDefaults.timeBase.numerator} ticks per second, ${sequenceDefaults.width} by ${sequenceDefaults.height} output pixels, and ${sequenceDefaults.frameRate.numerator / sequenceDefaults.frameRate.denominator} frames per second. Set requested output dimensions explicitly with a set-properties operation whose values contain width and height. Source dimensions never set output dimensions. Five seconds is ${(5 * sequenceDefaults.timeBase.denominator) / sequenceDefaults.timeBase.numerator} sequence ticks. A source time base, including 1/1000000, applies only to that source's in/out points; it never changes sequence placement or duration.`

export const sequenceIdSchema: JsonSchema = {
    type: 'string',
    pattern: '^[A-Za-z0-9_-]{1,128}$',
}
const tick: JsonSchema = {
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
}
const positive: JsonSchema = {
    ...tick,
    minimum: 1,
}
const numeric: JsonSchema = { type: 'number' }
const flag: JsonSchema = { type: 'boolean' }
const name: JsonSchema = {
    type: 'string',
    minLength: 1,
}
const object = (
    properties: Record<string, JsonSchema>,
    required = Object.keys(properties),
): JsonSchema => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
})
export const sequenceRationalSchema = object({
    numerator: positive,
    denominator: positive,
})
const trackValues = {
    name,
    locked: flag,
    visible: flag,
    muted: flag,
    solo: flag,
}
const track = object({
    trackId: sequenceIdSchema,
    kind: { enum: ['video', 'audio', 'text'] },
    ...trackValues,
})
const source = object(
    {
        sourceId: sequenceIdSchema,
        assetId: sequenceIdSchema,
        renditionId: sequenceIdSchema,
        blobHash: {
            type: 'string',
            pattern: '^[a-f0-9]{64}$',
        },
        byteSize: positive,
        kind: { enum: ['image', 'video', 'audio'] },
        timeBase: sequenceRationalSchema,
        duration: tick,
        width: positive,
        height: positive,
        channels: positive,
        hasAudio: flag,
    },
    ['sourceId', 'assetId', 'renditionId', 'blobHash', 'byteSize', 'kind', 'timeBase', 'duration'],
)
const transformValues = {
    x: numeric,
    y: numeric,
    scaleX: {
        type: 'number',
        exclusiveMinimum: 0,
    },
    scaleY: {
        type: 'number',
        exclusiveMinimum: 0,
    },
    rotation: numeric,
    opacity: {
        type: 'number',
        minimum: 0,
        maximum: 1,
    },
    crop: object({
        left: tick,
        top: tick,
        right: tick,
        bottom: tick,
    }),
}
const audioValues = {
    gain: {
        type: 'number',
        minimum: 0,
        maximum: 16,
    },
    pan: {
        type: 'number',
        minimum: -1,
        maximum: 1,
    },
    muted: flag,
}
const text = object({
    content: name,
    fontFamily: { enum: ['sans', 'serif', 'mono'] },
    fontSize: {
        type: 'number',
        minimum: 1,
        maximum: 4096,
    },
    color: {
        type: 'string',
        pattern: '^#[a-fA-F0-9]{6}([a-fA-F0-9]{2})?$',
    },
    align: { enum: ['left', 'center', 'right'] },
})
const keyframe = object({
    keyframeId: sequenceIdSchema,
    property: { enum: ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'gain', 'pan'] },
    time: tick,
    value: numeric,
    interpolation: { enum: ['linear', 'hold'] },
})
const clip = object(
    {
        clipId: sequenceIdSchema,
        trackId: sequenceIdSchema,
        sourceId: sequenceIdSchema,
        sourceIn: {
            ...tick,
            description: 'Ticks in the selected source time base. Use zero for an image hold.',
        },
        sourceOut: {
            ...tick,
            description: 'Ticks in the selected source time base. Use zero for an image hold.',
        },
        start: {
            ...tick,
            description: 'Ticks in the sequence time base, never the source time base. New sequences use 240000 ticks per second.',
        },
        duration: {
            ...positive,
            description: 'Ticks in the sequence time base. A five-second clip in a new sequence is 1200000 ticks, including an image hold.',
        },
        rate: sequenceRationalSchema,
        transform: object(transformValues),
        audio: object(audioValues),
        text,
        keyframes: {
            type: 'array',
            items: keyframe,
        },
    },
    ['clipId', 'trackId', 'sourceIn', 'sourceOut', 'start', 'duration', 'rate', 'transform', 'audio', 'keyframes'],
)
const transition = object(
    {
        transitionId: sequenceIdSchema,
        kind: { enum: ['cross-dissolve', 'fade-in', 'fade-out'] },
        clipId: sequenceIdSchema,
        otherClipId: sequenceIdSchema,
        duration: positive,
    },
    ['transitionId', 'kind', 'clipId', 'duration'],
)
export const sequenceExportSchema = object(
    {
        presetId: { enum: ['mp4-h264-aac', 'wav-pcm', 'mp3'] },
        quality: { enum: ['draft', 'standard', 'high'] },
        videoBitrateKbps: {
            type: 'integer',
            minimum: 32,
        },
        audioBitrateKbps: {
            type: 'integer',
            minimum: 32,
        },
    },
    ['presetId', 'quality'],
)
const properties = {
    name,
    frameRate: sequenceRationalSchema,
    width: positive,
    height: positive,
    audioSampleRate: positive,
    duration: tick,
    exportDefaults: sequenceExportSchema,
}
const operation = (
    op: string,
    fields: Record<string, JsonSchema>,
    required = Object.keys(fields),
): JsonSchema =>
    object(
        {
            op: { const: op },
            ...fields,
        },
        ['op', ...required],
    )

export const sequencePatchOperationSchema: JsonSchema = {
    anyOf: [
        operation(
            'add-track',
            {
                track,
                index: tick,
            },
            ['track'],
        ),
        operation('remove-track', { trackId: sequenceIdSchema }),
        operation(
            'reorder-track',
            {
                trackId: sequenceIdSchema,
                index: tick,
            },
        ),
        operation(
            'set-track',
            {
                trackId: sequenceIdSchema,
                values: object(trackValues, []),
            },
        ),
        operation('add-source', { source }),
        operation('remove-source', { sourceId: sequenceIdSchema }),
        operation('insert-clip', { clip }),
        operation('remove-clip', { clipId: sequenceIdSchema }),
        operation(
            'move-clip',
            {
                clipId: sequenceIdSchema,
                trackId: sequenceIdSchema,
                start: tick,
            },
        ),
        operation(
            'split-clip',
            {
                clipId: sequenceIdSchema,
                time: tick,
                newClipId: sequenceIdSchema,
            },
        ),
        operation(
            'trim-clip',
            {
                clipId: sequenceIdSchema,
                sourceIn: tick,
                sourceOut: tick,
                start: tick,
                duration: positive,
            },
        ),
        operation(
            'ripple-edit',
            {
                trackId: sequenceIdSchema,
                time: tick,
                deleteDuration: tick,
                insertDuration: tick,
                splitClipIds: {
                    type: 'object',
                    additionalProperties: sequenceIdSchema,
                },
            },
            ['trackId', 'time', 'deleteDuration', 'insertDuration'],
        ),
        operation(
            'set-rate',
            {
                clipId: sequenceIdSchema,
                rate: sequenceRationalSchema,
            },
        ),
        operation(
            'set-transform',
            {
                clipId: sequenceIdSchema,
                values: object(transformValues, []),
            },
        ),
        operation(
            'set-audio',
            {
                clipId: sequenceIdSchema,
                values: object(audioValues, []),
            },
        ),
        operation(
            'set-text',
            {
                clipId: sequenceIdSchema,
                text,
            },
        ),
        operation(
            'set-keyframe',
            {
                clipId: sequenceIdSchema,
                keyframe,
            },
        ),
        operation(
            'remove-keyframe',
            {
                clipId: sequenceIdSchema,
                keyframeId: sequenceIdSchema,
            },
        ),
        operation('add-transition', { transition }),
        operation('remove-transition', { transitionId: sequenceIdSchema }),
        operation('set-properties', { values: object(properties, []) }),
    ],
}

export const sequencePatchRequestSchema = object({
    sequenceId: sequenceIdSchema,
    baseRevision: positive,
    clientMutationId: sequenceIdSchema,
    operations: {
        type: 'array',
        minItems: 1,
        maxItems: 256,
        items: sequencePatchOperationSchema,
    },
})
