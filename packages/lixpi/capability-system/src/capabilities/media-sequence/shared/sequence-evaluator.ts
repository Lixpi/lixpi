import {
    type MediaSequence,
    type SequenceAudio,
    type SequenceClip,
    type SequenceKeyframe,
    type SequenceSourceBinding,
    type SequenceTrack,
    type SequenceTransform,
} from './media-sequence.ts'
import { sequenceOffsetToSourceTicks } from './sequence-time.ts'

export type EvaluatedSequenceClip = {
    clip: SequenceClip
    track: SequenceTrack
    source?: SequenceSourceBinding
    sourceTime: number
    transform: SequenceTransform
    audio: SequenceAudio & {
        left: number
        right: number
    }
    visible: boolean
}

export type SequencePreviewState = {
    sequenceId: string
    revision: number
    time: number
    duration: number
    clips: EvaluatedSequenceClip[]
}

export const evaluateSequenceProperty = (
    keyframes: SequenceKeyframe[],
    property: SequenceKeyframe['property'],
    time: number,
    fallback: number,
): number => {
    const keys = keyframes.filter(keyframe => keyframe.property === property).sort((left, right) => left.time - right.time)

    if (!keys.length)
        return fallback

    const right = keys.findIndex(keyframe => keyframe.time > time)

    if (right === 0)
        return keys[0].time > 0
            ? fallback + (keys[0].value - fallback) * Math.max(0, time) / keys[0].time
            : keys[0].value

    if (right === -1)
        return keys.at(-1)!.value

    const previous = keys[right - 1]
    const next = keys[right]

    if (previous.interpolation === 'hold')
        return previous.value

    return previous.value + ((next.value - previous.value) * (time - previous.time)) / (next.time - previous.time)
}

export const evaluateMediaSequence = (
    sequence: MediaSequence,
    time: number,
): SequencePreviewState => {
    const position = Math.min(
        sequence.duration,
        Math.max(
            0,
            Math.round(time),
        ),
    )
    const solo = sequence.tracks.some(track => track.solo)
    const clips: EvaluatedSequenceClip[] = []

    for (const track of sequence.tracks) {
        const active = sequence.clips.filter(
            clip => clip.trackId === track.trackId && clip.start <= position && position < clip.start + clip.duration,
        )
            .sort((left, right) => left.start - right.start)

        for (const clip of active) {
            const source = sequence.sources.find(binding => binding.sourceId === clip.sourceId)
            const local = position - clip.start
            const transform = structuredClone(clip.transform)
            const audio = structuredClone(clip.audio)

            for (const property of ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'] as const)
                transform[property] = evaluateSequenceProperty(
                    clip.keyframes,
                    property,
                    local,
                    transform[property],
                )

            for (const property of ['gain', 'pan'] as const)
                audio[property] = evaluateSequenceProperty(
                    clip.keyframes,
                    property,
                    local,
                    audio[property],
                )

            let visualWeight = 1
            let audioWeight = 1

            for (const transition of sequence.transitions) {
                if (
                    transition.kind === 'fade-in'
                    && transition.clipId === clip.clipId
                ) {
                    const weight = Math.min(1, local / transition.duration)
                    visualWeight *= weight
                    audioWeight *= weight
                }

                if (
                    transition.kind === 'fade-out'
                    && transition.clipId === clip.clipId
                ) {
                    const weight = Math.min(1, (clip.duration - local) / transition.duration)
                    visualWeight *= weight
                    audioWeight *= weight
                }

                if (transition.kind === 'cross-dissolve') {
                    const incoming = sequence.clips.find(candidate => candidate.clipId === transition.otherClipId)

                    if (!incoming)
                        continue

                    const weight = Math.max(
                        0,
                        Math.min(1, (position - incoming.start) / transition.duration),
                    )

                    if (transition.clipId === clip.clipId)
                        audioWeight *= 1 - weight

                    if (transition.otherClipId === clip.clipId) {
                        visualWeight *= weight
                        audioWeight *= weight
                    }
                }
            }

            transform.opacity *= visualWeight
            audio.gain *= audioWeight
            audio.muted = audio.muted
                || track.muted
                || (solo && !track.solo)
                || track.kind === 'text'

            if (audio.muted)
                audio.gain = 0

            clips.push({
                clip,
                track,
                ...(source ? { source } : {}),
                sourceTime: source
                    && source.kind !== 'image'
                    ? Math.min(clip.sourceOut, clip.sourceIn + sequenceOffsetToSourceTicks(
                        local,
                        sequence.timeBase,
                        source.timeBase,
                        clip.rate,
                    ))
                    : 0,
                transform,
                audio: {
                    ...audio,
                    left: audio.gain * Math.sqrt(1 - Math.max(audio.pan, 0)),
                    right: audio.gain * Math.sqrt(1 + Math.min(audio.pan, 0)),
                },
                visible: track.visible && track.kind !== 'audio' && (!solo || track.solo),
            })
        }
    }

    return {
        sequenceId: sequence.sequenceId,
        revision: sequence.revision,
        time: position,
        duration: sequence.duration,
        clips,
    }
}
