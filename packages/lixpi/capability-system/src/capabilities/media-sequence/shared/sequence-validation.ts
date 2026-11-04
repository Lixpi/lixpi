import {
    MEDIA_SEQUENCE_SCHEMA_VERSION,
    MEDIA_SEQUENCE_MAX_SOURCES,
    type MediaSequence,
    type SequenceClip,
    type SequenceKeyframe,
    type SequenceSourceBinding,
    type SequenceTrack,
    type SequenceTransition,
} from './media-sequence.ts'
import {
    assertSequenceInteger,
    assertSequenceRational,
    sourceDurationToSequenceTicks,
} from './sequence-time.ts'

const object = (value: unknown): Record<string, unknown> => {
    if (
        !value
        || typeof value !== 'object'
        || Array.isArray(value)
    )
        throw new Error('MEDIA_SEQUENCE_INVALID_OBJECT')

    return value as Record<string, unknown>
}

const fields = (
    value: unknown,
    names: string[],
): void => {
    if (Object.keys(
        object(value),
    ).some(key => !names.includes(key)))
        throw new Error('MEDIA_SEQUENCE_UNKNOWN_FIELD')
}

export const assertSequenceId = (value: unknown): void => {
    if (
        typeof value !== 'string'
        || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)
    )
        throw new Error('MEDIA_SEQUENCE_INVALID_ID')
}

const text = (value: unknown): void => {
    if (
        typeof value !== 'string'
        || !value.trim()
    )
        throw new Error('MEDIA_SEQUENCE_INVALID_TEXT')
}

const boolean = (value: unknown): void => {
    if (typeof value !== 'boolean')
        throw new Error('MEDIA_SEQUENCE_INVALID_BOOLEAN')
}

const finite = (
    value: unknown,
    minimum = -Number.MAX_VALUE,
    maximum = Number.MAX_VALUE,
): void => {
    if (
        typeof value !== 'number'
        || !Number.isFinite(value)
        || value < minimum
        || value > maximum
    )
        throw new Error('MEDIA_SEQUENCE_INVALID_NUMBER')
}

const unique = <T>(
    values: T[],
    key: (value: T) => string,
): void => {
    if (!Array.isArray(values))
        throw new Error('MEDIA_SEQUENCE_INVALID_COLLECTION')

    const ids = values.map(key)
    ids.forEach(assertSequenceId)

    if (new Set(ids).size !== ids.length)
        throw new Error('MEDIA_SEQUENCE_DUPLICATE_ID')
}

const assertTrack = (track: SequenceTrack): void => {
    fields(track, ['trackId', 'name', 'kind', 'locked', 'visible', 'muted', 'solo'])
    assertSequenceId(track.trackId)
    text(track.name)

    if (!['video', 'audio', 'text'].includes(track.kind))
        throw new Error('MEDIA_SEQUENCE_INVALID_TRACK_KIND')

    for (const value of [track.locked, track.visible, track.muted, track.solo])
        boolean(value)
}

export const assertSequenceSource = (source: SequenceSourceBinding): void => {
    fields(
        source,
        ['sourceId', 'assetId', 'renditionId', 'blobHash', 'byteSize', 'kind', 'timeBase', 'duration', 'width', 'height', 'channels', 'hasAudio'],
    )
    assertSequenceId(source.sourceId)
    assertSequenceId(source.assetId)
    assertSequenceId(source.renditionId)

    if (
        typeof source.blobHash !== 'string'
        || !/^[a-f0-9]{64}$/u.test(source.blobHash)
    )
        throw new Error('MEDIA_SEQUENCE_INVALID_SOURCE_HASH')

    if (!['image', 'video', 'audio'].includes(source.kind))
        throw new Error('MEDIA_SEQUENCE_INVALID_SOURCE_KIND')

    assertSequenceInteger(
        source.byteSize,
        'SOURCE_SIZE',
        1,
    )
    assertSequenceRational(source.timeBase)
    assertSequenceInteger(
        source.duration,
        'SOURCE_DURATION',
        source.kind === 'image' ? 0 : 1,
    )

    if (source.kind !== 'audio') {
        assertSequenceInteger(
            source.width,
            'SOURCE_WIDTH',
            1,
        )
        assertSequenceInteger(
            source.height,
            'SOURCE_HEIGHT',
            1,
        )
    }

    if (source.channels !== undefined)
        assertSequenceInteger(
            source.channels,
            'SOURCE_CHANNELS',
            1,
        )

    if (source.hasAudio !== undefined)
        boolean(source.hasAudio)
}

export const assertSequenceKeyframe = (
    keyframe: SequenceKeyframe,
    duration: number,
): void => {
    fields(keyframe, ['keyframeId', 'property', 'time', 'value', 'interpolation'])
    assertSequenceId(keyframe.keyframeId)
    assertSequenceInteger(keyframe.time, 'KEYFRAME_TIME')

    if (keyframe.time > duration)
        throw new Error('MEDIA_SEQUENCE_KEYFRAME_OUTSIDE_CLIP')

    if (!['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'gain', 'pan'].includes(keyframe.property))
        throw new Error('MEDIA_SEQUENCE_INVALID_KEYFRAME_PROPERTY')

    if (!['linear', 'hold'].includes(keyframe.interpolation))
        throw new Error('MEDIA_SEQUENCE_INVALID_INTERPOLATION')

    finite(keyframe.value)

    if (keyframe.property === 'opacity')
        finite(
            keyframe.value,
            0,
            1,
        )

    if (keyframe.property === 'pan')
        finite(
            keyframe.value,
            -1,
            1,
        )

    if (keyframe.property === 'gain')
        finite(
            keyframe.value,
            0,
            16,
        )

    if (
        keyframe.property === 'scaleX'
        || keyframe.property === 'scaleY'
    )
        finite(keyframe.value, Number.MIN_VALUE)
}

const assertClip = (
    clip: SequenceClip,
    sequence: MediaSequence,
): void => {
    fields(clip, ['clipId', 'trackId', 'sourceId', 'sourceIn', 'sourceOut', 'start', 'duration', 'rate', 'transform', 'audio', 'text', 'keyframes'])
    assertSequenceId(clip.clipId)
    assertSequenceId(clip.trackId)

    for (const [name, value] of Object.entries({
        SOURCE_IN: clip.sourceIn,
        SOURCE_OUT: clip.sourceOut,
        START: clip.start,
    }))
        assertSequenceInteger(value, name)

    assertSequenceInteger(
        clip.duration,
        'CLIP_DURATION',
        1,
    )
    assertSequenceInteger(clip.start + clip.duration, 'CLIP_END')
    assertSequenceRational(clip.rate)

    if (clip.start + clip.duration > sequence.duration)
        throw new Error('MEDIA_SEQUENCE_CLIP_OUTSIDE_DURATION')

    const track = sequence.tracks.find(candidate => candidate.trackId === clip.trackId)
    const source = sequence.sources.find(candidate => candidate.sourceId === clip.sourceId)

    if (!track)
        throw new Error('MEDIA_SEQUENCE_MISSING_TRACK')

    if (track.kind === 'text') {
        if (
            clip.sourceId
            || !clip.text
            || clip.sourceIn !== 0
            || clip.sourceOut !== 0
        )
            throw new Error('MEDIA_SEQUENCE_INVALID_TEXT_CLIP')

        fields(clip.text, ['content', 'fontFamily', 'fontSize', 'color', 'align'])
        text(clip.text.content)

        if (
            !['sans', 'serif', 'mono'].includes(clip.text.fontFamily)
            || !['left', 'center', 'right'].includes(clip.text.align)
        )
            throw new Error('MEDIA_SEQUENCE_INVALID_TEXT_STYLE')

        if (!/^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?$/u.test(clip.text.color))
            throw new Error('MEDIA_SEQUENCE_INVALID_TEXT_COLOR')

        finite(
            clip.text.fontSize,
            1,
            4096,
        )
    } else {
        if (
            !source
            || clip.text
        )
            throw new Error('MEDIA_SEQUENCE_MISSING_SOURCE')

        if (
            track.kind === 'video'
            && source.kind === 'audio'
        )
            throw new Error('MEDIA_SEQUENCE_TRACK_SOURCE_MISMATCH')

        if (
            track.kind === 'audio'
            && source.kind !== 'audio'
            && !(source.kind === 'video' && source.hasAudio)
        )
            throw new Error('MEDIA_SEQUENCE_TRACK_SOURCE_MISMATCH')

        if (source.kind === 'image') {
            if (
                clip.sourceIn !== 0
                || clip.sourceOut !== 0
            )
                throw new Error('MEDIA_SEQUENCE_IMAGE_SOURCE_RANGE')
        } else {
            if (
                clip.sourceOut <= clip.sourceIn
                || clip.sourceOut > source.duration
            )
                throw new Error('MEDIA_SEQUENCE_SOURCE_BOUNDS')

            const expected = sourceDurationToSequenceTicks(
                clip.sourceOut - clip.sourceIn,
                source.timeBase,
                sequence.timeBase,
                clip.rate,
            )

            if (expected !== clip.duration)
                throw new Error('MEDIA_SEQUENCE_RATE_DURATION_MISMATCH')
        }
    }

    fields(clip.transform, ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'crop'])

    for (const value of [clip.transform.x, clip.transform.y, clip.transform.rotation])
        finite(value)

    finite(clip.transform.scaleX, Number.MIN_VALUE)
    finite(clip.transform.scaleY, Number.MIN_VALUE)
    finite(
        clip.transform.opacity,
        0,
        1,
    )
    fields(clip.transform.crop, ['left', 'top', 'right', 'bottom'])

    for (const value of Object.values(clip.transform.crop))
        assertSequenceInteger(value, 'CROP')

    const width = source?.width ?? (clip.text ? sequence.width : undefined)
    const height = source?.height ?? (clip.text ? sequence.height : undefined)

    if (
        width
        && clip.transform.crop.left + clip.transform.crop.right >= width
    )
        throw new Error('MEDIA_SEQUENCE_CROP_BOUNDS')

    if (
        height
        && clip.transform.crop.top + clip.transform.crop.bottom >= height
    )
        throw new Error('MEDIA_SEQUENCE_CROP_BOUNDS')

    fields(clip.audio, ['gain', 'pan', 'muted'])
    finite(
        clip.audio.gain,
        0,
        16,
    )
    finite(
        clip.audio.pan,
        -1,
        1,
    )
    boolean(clip.audio.muted)
    unique(clip.keyframes, keyframe => keyframe.keyframeId)
    const positions = new Set<string>()

    for (const keyframe of clip.keyframes) {
        assertSequenceKeyframe(keyframe, clip.duration)
        const key = `${keyframe.property}:${keyframe.time}`

        if (positions.has(key))
            throw new Error('MEDIA_SEQUENCE_DUPLICATE_KEYFRAME_TIME')

        positions.add(key)
    }
}

const assertTransition = (
    transition: SequenceTransition,
    sequence: MediaSequence,
): void => {
    fields(transition, ['transitionId', 'kind', 'clipId', 'otherClipId', 'duration'])
    assertSequenceId(transition.transitionId)
    assertSequenceInteger(
        transition.duration,
        'TRANSITION_DURATION',
        1,
    )
    const clip = sequence.clips.find(candidate => candidate.clipId === transition.clipId)

    if (
        !clip
        || transition.duration > clip.duration
    )
        throw new Error('MEDIA_SEQUENCE_TRANSITION_BOUNDS')

    if (transition.kind === 'cross-dissolve') {
        const other = sequence.clips.find(candidate => candidate.clipId === transition.otherClipId)

        if (
            !other
            || other.clipId === clip.clipId
            || other.trackId !== clip.trackId
            || other.start <= clip.start
        )
            throw new Error('MEDIA_SEQUENCE_INVALID_DISSOLVE')

        const overlap = Math.min(clip.start + clip.duration, other.start + other.duration) - other.start

        if (
            overlap !== transition.duration
            || other.start + other.duration < clip.start + clip.duration
        )
            throw new Error('MEDIA_SEQUENCE_TRANSITION_HANDLES')
    } else if (
        !['fade-in', 'fade-out'].includes(transition.kind)
        || transition.otherClipId
    )
        throw new Error('MEDIA_SEQUENCE_INVALID_TRANSITION')
}

export const assertMediaSequence: (input: unknown) => asserts input is MediaSequence = input => {
    const sequence = object(input) as unknown as MediaSequence

    if (sequence.schemaVersion !== MEDIA_SEQUENCE_SCHEMA_VERSION)
        throw new Error('MEDIA_SEQUENCE_READ_ONLY_VERSION')

    fields(
        sequence,
        ['schemaVersion', 'sequenceId', 'revision', 'name', 'timeBase', 'frameRate', 'width', 'height', 'audioSampleRate', 'duration', 'tracks', 'sources', 'clips', 'transitions', 'exportDefaults'],
    )
    assertSequenceId(sequence.sequenceId)
    assertSequenceInteger(
        sequence.revision,
        'REVISION',
        1,
    )
    text(sequence.name)
    assertSequenceRational(sequence.timeBase)
    assertSequenceRational(sequence.frameRate)
    assertSequenceInteger(
        sequence.width,
        'WIDTH',
        1,
    )
    assertSequenceInteger(
        sequence.height,
        'HEIGHT',
        1,
    )
    assertSequenceInteger(
        sequence.audioSampleRate,
        'SAMPLE_RATE',
        1,
    )
    assertSequenceInteger(sequence.duration, 'DURATION')
    unique(sequence.tracks, track => track.trackId)
    unique(sequence.sources, source => source.sourceId)

    if (sequence.sources.length > MEDIA_SEQUENCE_MAX_SOURCES)
        throw new Error('MEDIA_SEQUENCE_SOURCE_LIMIT')

    unique(sequence.clips, clip => clip.clipId)
    unique(sequence.transitions, transition => transition.transitionId)
    sequence.tracks.forEach(assertTrack)
    sequence.sources.forEach(assertSequenceSource)
    sequence.clips.forEach(clip => assertClip(clip, sequence))
    sequence.transitions.forEach(transition => assertTransition(transition, sequence))
    fields(sequence.exportDefaults, ['presetId', 'quality', 'videoBitrateKbps', 'audioBitrateKbps'])

    if (
        !['mp4-h264-aac', 'wav-pcm', 'mp3'].includes(sequence.exportDefaults.presetId)
        || !['draft', 'standard', 'high'].includes(sequence.exportDefaults.quality)
    )
        throw new Error('MEDIA_SEQUENCE_INVALID_EXPORT_DEFAULTS')

    if (sequence.exportDefaults.videoBitrateKbps !== undefined)
        assertSequenceInteger(
            sequence.exportDefaults.videoBitrateKbps,
            'VIDEO_BITRATE',
            1,
        )

    if (sequence.exportDefaults.audioBitrateKbps !== undefined)
        assertSequenceInteger(
            sequence.exportDefaults.audioBitrateKbps,
            'AUDIO_BITRATE',
            1,
        )
}
