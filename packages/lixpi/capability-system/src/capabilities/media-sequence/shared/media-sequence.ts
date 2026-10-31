export const MEDIA_SEQUENCE_MODULE_ID = 'media-sequence'
export const MEDIA_SEQUENCE_ARTIFACT_TYPE_ID = 'media-sequence'
export const MEDIA_SEQUENCE_SCHEMA_VERSION = 'media-sequence-v1'
export const MEDIA_SEQUENCE_TOOL_ID = 'global.media-sequence'
export const MEDIA_SEQUENCE_MAX_SOURCES = 24

export type SequenceExportProgress = {
    phase: 'decode' | 'compose' | 'encode' | 'finalize'
    processedDurationSeconds?: number
    durationSeconds: number
}

export type SequenceExportHandle = {
    jobId: string
    outputAssetId: string
    sequenceId: string
    sequenceRevision: number
    state: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'
    attempt: number
    error?: string
    progress?: SequenceExportProgress
}

export type SequenceExportCommand = {
    action?: 'submit'
    sequenceId: string
    revision: number
    preset?: SequenceExportDefaults
    clientMutationId: string
} | {
    action: 'get' | 'cancel'
    jobId: string
}

export type SequenceRational = {
    numerator: number
    denominator: number
}

export type SequenceTrack = {
    trackId: string
    name: string
    kind: 'video' | 'audio' | 'text'
    locked: boolean
    visible: boolean
    muted: boolean
    solo: boolean
}

export type SequenceSourceBinding = {
    sourceId: string
    assetId: string
    renditionId: string
    blobHash: string
    byteSize: number
    kind: 'image' | 'video' | 'audio'
    timeBase: SequenceRational
    duration: number
    width?: number
    height?: number
    channels?: number
    hasAudio?: boolean
}

export type SequenceTransform = {
    x: number
    y: number
    scaleX: number
    scaleY: number
    rotation: number
    opacity: number
    crop: {
        left: number
        top: number
        right: number
        bottom: number
    }
}

export type SequenceAudio = {
    gain: number
    pan: number
    muted: boolean
}

export type SequenceText = {
    content: string
    fontFamily: 'sans' | 'serif' | 'mono'
    fontSize: number
    color: string
    align: 'left' | 'center' | 'right'
}

export type SequenceKeyframe = {
    keyframeId: string
    property: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'gain' | 'pan'
    time: number
    value: number
    interpolation: 'linear' | 'hold'
}

export type SequenceClip = {
    clipId: string
    trackId: string
    sourceId?: string
    sourceIn: number
    sourceOut: number
    start: number
    duration: number
    rate: SequenceRational
    transform: SequenceTransform
    audio: SequenceAudio
    text?: SequenceText
    keyframes: SequenceKeyframe[]
}

export type SequenceTransition = {
    transitionId: string
    kind: 'cross-dissolve' | 'fade-in' | 'fade-out'
    clipId: string
    otherClipId?: string
    duration: number
}

export type SequenceExportDefaults = {
    presetId: 'mp4-h264-aac' | 'wav-pcm' | 'mp3'
    quality: 'draft' | 'standard' | 'high'
    videoBitrateKbps?: number
    audioBitrateKbps?: number
}

export type SequenceMutationOrigin = {
    kind: 'manual'
    userId: string
    clientMutationId: string
} | {
    kind: 'conversation'
    conversationAssetId: string
    turnId: string
    operationId: string
}

export type MediaSequence = {
    schemaVersion: typeof MEDIA_SEQUENCE_SCHEMA_VERSION
    sequenceId: string
    revision: number
    name: string
    timeBase: SequenceRational
    frameRate: SequenceRational
    width: number
    height: number
    audioSampleRate: number
    duration: number
    tracks: SequenceTrack[]
    sources: SequenceSourceBinding[]
    clips: SequenceClip[]
    transitions: SequenceTransition[]
    exportDefaults: SequenceExportDefaults
}

export type SequenceProperties = Pick<MediaSequence,
    'name' | 'frameRate' | 'width' | 'height' | 'audioSampleRate' | 'duration' | 'exportDefaults'>

export type SequencePatchOperation =
    | {
        op: 'add-track'
        track: SequenceTrack
        index?: number
    }
    | {
        op: 'remove-track'
        trackId: string
    }
    | {
        op: 'reorder-track'
        trackId: string
        index: number
    }
    | {
        op: 'set-track'
        trackId: string
        values: Partial<Omit<SequenceTrack, 'trackId' | 'kind'>>
    }
    | {
        op: 'add-source'
        source: SequenceSourceBinding
    }
    | {
        op: 'remove-source'
        sourceId: string
    }
    | {
        op: 'insert-clip'
        clip: SequenceClip
    }
    | {
        op: 'remove-clip'
        clipId: string
    }
    | {
        op: 'move-clip'
        clipId: string
        trackId: string
        start: number
    }
    | {
        op: 'split-clip'
        clipId: string
        time: number
        newClipId: string
    }
    | {
        op: 'trim-clip'
        clipId: string
        sourceIn: number
        sourceOut: number
        start: number
        duration: number
    }
    | {
        op: 'ripple-edit'
        trackId: string
        start: number
        deleteDuration: number
        insertDuration: number
        splitClipIds?: Record<string, string>
    }
    | {
        op: 'set-rate'
        clipId: string
        rate: SequenceRational
    }
    | {
        op: 'set-transform'
        clipId: string
        values: Partial<SequenceTransform>
    }
    | {
        op: 'set-audio'
        clipId: string
        values: Partial<SequenceAudio>
    }
    | {
        op: 'set-text'
        clipId: string
        text: SequenceText
    }
    | {
        op: 'set-keyframe'
        clipId: string
        keyframe: SequenceKeyframe
    }
    | {
        op: 'remove-keyframe'
        clipId: string
        keyframeId: string
    }
    | {
        op: 'add-transition'
        transition: SequenceTransition
    }
    | {
        op: 'remove-transition'
        transitionId: string
    }
    | {
        op: 'set-properties'
        values: Partial<SequenceProperties>
    }

export type SequencePatchRequest = {
    sequenceId: string
    baseRevision: number
    clientMutationId: string
    operations: SequencePatchOperation[]
}

export type SequenceObjectRestore =
    | {
        kind: 'track'
        id: string
        value: SequenceTrack | null
        index?: number
    }
    | {
        kind: 'source'
        id: string
        value: SequenceSourceBinding | null
    }
    | {
        kind: 'clip'
        id: string
        value: SequenceClip | null
    }
    | {
        kind: 'transition'
        id: string
        value: SequenceTransition | null
    }
    | {
        kind: 'properties'
        value: Partial<SequenceProperties>
    }
    | {
        kind: 'track-order'
        value: string[]
    }

export type SequenceRevision = {
    sequenceId: string
    revision: number
    baseRevision: number
    clientMutationId: string
    requestHash: string
    origin: SequenceMutationOrigin
    changedObjectIds: string[]
    readObjectIds: string[]
    inverse: SequenceObjectRestore[]
    forward: SequenceObjectRestore[]
    createdAt: string
    historyAction?: {
        action: 'undo' | 'redo'
        revision: number
    }
}

export type SequencePatchResult = {
    status: 'committed' | 'duplicate'
    sequence: MediaSequence
    revision: SequenceRevision
    rebased: boolean
} | {
    status: 'conflict'
    sequence: MediaSequence
    changedObjectIds: string[]
    message: string
}

export const defaultSequenceTransform = (): SequenceTransform => ({
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    crop: {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    },
})

export const defaultSequenceAudio = (): SequenceAudio => ({
    gain: 1,
    pan: 0,
    muted: false,
})

export const createMediaSequence = (
    sequenceId: string,
    name = 'Sequence',
): MediaSequence => ({
    schemaVersion: MEDIA_SEQUENCE_SCHEMA_VERSION,
    sequenceId,
    revision: 1,
    name,
    timeBase: {
        numerator: 1,
        denominator: 240000,
    },
    frameRate: {
        numerator: 30,
        denominator: 1,
    },
    width: 1920,
    height: 1080,
    audioSampleRate: 48000,
    duration: 0,
    tracks: [],
    sources: [],
    clips: [],
    transitions: [],
    exportDefaults: {
        presetId: 'mp4-h264-aac',
        quality: 'standard',
    },
})
