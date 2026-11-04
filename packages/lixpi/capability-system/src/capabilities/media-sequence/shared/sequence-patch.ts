import {
    type MediaSequence,
    type SequenceClip,
    type SequenceKeyframe,
    type SequenceObjectRestore,
    type SequencePatchOperation,
    type SequenceProperties,
} from './media-sequence.ts'
import {
    assertMediaSequence,
    assertSequenceId,
} from './sequence-validation.ts'
import {
    assertSequenceInteger,
    sequenceOffsetToSourceTicks,
    sourceDurationToSequenceTicks,
} from './sequence-time.ts'
import { evaluateSequenceProperty } from './sequence-evaluator.ts'

export type AppliedSequencePatch = {
    sequence: MediaSequence
    readObjectIds: string[]
    changedObjectIds: string[]
    inverse: SequenceObjectRestore[]
    forward: SequenceObjectRestore[]
}

const propertyNames = ['name', 'frameRate', 'width', 'height', 'audioSampleRate', 'duration', 'exportDefaults'] as const
const operationFields: Record<SequencePatchOperation['op'], string[]> = {
    'add-track': ['track', 'index'],
    'remove-track': ['trackId'],
    'reorder-track': ['trackId', 'index'],
    'set-track': ['trackId', 'values'],
    'add-source': ['source'],
    'remove-source': ['sourceId'],
    'insert-clip': ['clip'],
    'remove-clip': ['clipId'],
    'move-clip': ['clipId', 'trackId', 'start'],
    'split-clip': ['clipId', 'time', 'newClipId'],
    'trim-clip': ['clipId', 'sourceIn', 'sourceOut', 'start', 'duration'],
    'ripple-edit': ['trackId', 'start', 'deleteDuration', 'insertDuration', 'splitClipIds'],
    'set-rate': ['clipId', 'rate'],
    'set-transform': ['clipId', 'values'],
    'set-audio': ['clipId', 'values'],
    'set-text': ['clipId', 'text'],
    'set-keyframe': ['clipId', 'keyframe'],
    'remove-keyframe': ['clipId', 'keyframeId'],
    'add-transition': ['transition'],
    'remove-transition': ['transitionId'],
    'set-properties': ['values'],
}

const same = (
    left: unknown,
    right: unknown,
): boolean => JSON.stringify(left) === JSON.stringify(right)

const record = (value: unknown): Record<string, unknown> => {
    if (
        !value
        || typeof value !== 'object'
        || Array.isArray(value)
    )
        throw new Error('MEDIA_SEQUENCE_INVALID_PATCH')

    return value as Record<string, unknown>
}

const requireFields = (
    value: unknown,
    allowed: readonly string[],
): void => {
    if (Object.keys(
        record(value),
    ).some(key => !allowed.includes(key)))
        throw new Error('MEDIA_SEQUENCE_UNKNOWN_PATCH_FIELD')
}

export class SequencePatchEditor {
    private readonly sequence: MediaSequence
    private readonly reads = new Set<string>()
    private readonly writes = new Set<string>()

    constructor(private readonly original: MediaSequence) {
        assertMediaSequence(original)
        this.sequence = structuredClone(original)
    }

    apply(operations: SequencePatchOperation[]): AppliedSequencePatch {
        if (
            !Array.isArray(operations)
            || operations.length === 0
            || operations.length > 256
        )
            throw new Error('MEDIA_SEQUENCE_INVALID_PATCH')

        for (const operation of operations) {
            const input = record(operation)

            if (
                typeof input.op !== 'string'
                || !Object.hasOwn(operationFields, input.op)
            )
                throw new Error('MEDIA_SEQUENCE_UNKNOWN_OPERATION')

            requireFields(operation, ['op', ...operationFields[operation.op]])
            this.applyOperation(operation)
        }

        assertMediaSequence(this.sequence)

        return this.result()
    }

    restore(restores: SequenceObjectRestore[]): AppliedSequencePatch {
        // Check the current document before changing dependencies. An inverse can
        // remove a track and its clips together, or recreate both together.
        for (const restore of restores) {
            if (restore.kind === 'clip') {
                const existing = this.sequence.clips.find(clip => clip.clipId === restore.id)

                for (const trackId of new Set([
                    existing?.trackId,
                    restore.value?.trackId,
                ])) {
                    if (!trackId)
                        continue

                    if (this.sequence.tracks.some(track => track.trackId === trackId))
                        this.track(trackId)

                    this.writes.add(`track-content:${trackId}`)
                }
            } else if (restore.kind === 'source') {
                for (const clip of this.sequence.clips.filter(clip => clip.sourceId === restore.id))
                    this.track(clip.trackId)
            } else if (restore.kind === 'transition') {
                const existing = this.sequence.transitions.find(transition => transition.transitionId === restore.id)

                for (const clipId of [existing?.clipId, existing?.otherClipId, restore.value?.clipId, restore.value?.otherClipId])
                    if (
                        clipId
                        && this.sequence.clips.some(clip => clip.clipId === clipId)
                    )
                        this.clip(clipId)
            }
        }

        for (const restore of restores) {
            if (restore.kind === 'properties') {
                requireFields(restore.value, propertyNames)

                for (const property of Object.keys(restore.value))
                    this.writes.add(`property:${property}`)

                Object.entries(restore.value).forEach(([key, value]) => {
                    ;(this.sequence as unknown as Record<string, unknown>)[key] = structuredClone(value)
                })

                continue
            }

            if (restore.kind === 'track-order') {
                if (
                    restore.value.length !== this.sequence.tracks.length
                    || new Set(restore.value).size !== restore.value.length
                )
                    throw new Error('MEDIA_SEQUENCE_INVALID_TRACK_ORDER')

                this.sequence.tracks = restore.value.map(id => {
                    const track = this.sequence.tracks.find(candidate => candidate.trackId === id)

                    if (!track)
                        throw new Error('MEDIA_SEQUENCE_MISSING_TRACK')

                    return track
                })
                this.writes.add('track-order')

                continue
            }

            assertSequenceId(restore.id)

            if (restore.kind === 'clip') {
                this.sequence.clips = this.sequence.clips.filter(clip => clip.clipId !== restore.id)

                if (restore.value)
                    this.sequence.clips.push(
                        structuredClone(restore.value),
                    )
            } else if (restore.kind === 'track') {
                const existing = this.sequence.tracks.find(track => track.trackId === restore.id)
                const unlockOnly = existing
                    && restore.value
                    && same(
                        {
                            ...existing,
                            locked: false,
                        },
                        restore.value,
                    )

                if (
                    existing?.locked
                    && !unlockOnly
                    && (!restore.value || !same(existing, restore.value))
                )
                    throw new Error(`MEDIA_SEQUENCE_TRACK_LOCKED:${restore.id}`)

                this.sequence.tracks = this.sequence.tracks.filter(track => track.trackId !== restore.id)

                if (restore.value)
                    this.sequence.tracks.splice(
                        restore.index ?? this.sequence.tracks.length,
                        0,
                        structuredClone(restore.value),
                    )
            } else if (restore.kind === 'source') {
                this.sequence.sources = this.sequence.sources.filter(source => source.sourceId !== restore.id)

                if (restore.value)
                    this.sequence.sources.push(
                        structuredClone(restore.value),
                    )
            } else {
                this.sequence.transitions = this.sequence.transitions.filter(transition => transition.transitionId !== restore.id)

                if (restore.value)
                    this.sequence.transitions.push(
                        structuredClone(restore.value),
                    )
            }

            this.writes.add(`${restore.kind}:${restore.id}`)
        }

        assertMediaSequence(this.sequence)

        return this.result()
    }

    private track(trackId: string) {
        assertSequenceId(trackId)
        const track = this.sequence.tracks.find(candidate => candidate.trackId === trackId)

        if (!track)
            throw new Error('MEDIA_SEQUENCE_MISSING_TRACK')

        if (track.locked)
            throw new Error(`MEDIA_SEQUENCE_TRACK_LOCKED:${trackId}`)

        this.reads.add(`track:${trackId}`)

        return track
    }

    private clip(clipId: string): SequenceClip {
        assertSequenceId(clipId)
        const clip = this.sequence.clips.find(candidate => candidate.clipId === clipId)

        if (!clip)
            throw new Error('MEDIA_SEQUENCE_MISSING_CLIP')

        this.track(clip.trackId)
        this.reads.add(`clip:${clipId}`)

        if (clip.sourceId)
            this.reads.add(`source:${clip.sourceId}`)

        return clip
    }

    private applyOperation(operation: SequencePatchOperation): void {
        if (operation.op === 'add-track') {
            assertSequenceId(operation.track?.trackId)

            if (this.sequence.tracks.some(track => track.trackId === operation.track.trackId))
                throw new Error('MEDIA_SEQUENCE_DUPLICATE_ID')

            const index = operation.index ?? this.sequence.tracks.length
            assertSequenceInteger(index, 'TRACK_INDEX')

            if (index > this.sequence.tracks.length)
                throw new Error('MEDIA_SEQUENCE_INVALID_TRACK_INDEX')

            this.sequence.tracks.splice(
                index,
                0,
                structuredClone(operation.track),
            )
            this.writes.add('track-order')

            return
        }

        if (operation.op === 'remove-track') {
            this.track(operation.trackId)

            for (const clip of [...this.sequence.clips].filter(clip => clip.trackId === operation.trackId))
                this.removeClip(clip.clipId)

            this.sequence.tracks = this.sequence.tracks.filter(track => track.trackId !== operation.trackId)
            this.writes.add(`track-content:${operation.trackId}`)
            this.writes.add('track-order')

            return
        }

        if (operation.op === 'reorder-track') {
            const track = this.track(operation.trackId)
            assertSequenceInteger(operation.index, 'TRACK_INDEX')

            if (operation.index >= this.sequence.tracks.length)
                throw new Error('MEDIA_SEQUENCE_INVALID_TRACK_INDEX')

            this.sequence.tracks = this.sequence.tracks.filter(candidate => candidate !== track)
            this.sequence.tracks.splice(
                operation.index,
                0,
                track,
            )
            this.writes.add('track-order')

            return
        }

        if (operation.op === 'set-track') {
            requireFields(operation.values, ['name', 'locked', 'visible', 'muted', 'solo'])
            const track = this.sequence.tracks.find(candidate => candidate.trackId === operation.trackId)

            if (!track)
                throw new Error('MEDIA_SEQUENCE_MISSING_TRACK')

            // Unlocking is an explicit operation; a locked track rejects every
            // other change, including a patch that combines unlock and edits.
            if (
                track.locked
                && (operation.values.locked !== false || Object.keys(operation.values).length !== 1)
            )
                throw new Error(`MEDIA_SEQUENCE_TRACK_LOCKED:${track.trackId}`)

            this.sequence.tracks = this.sequence.tracks.map(
                candidate => candidate === track ? {
                    ...track,
                    ...operation.values,
                } : candidate,
            )
            this.reads.add(`track:${track.trackId}`)

            return
        }

        if (operation.op === 'add-source') {
            if (this.sequence.sources.some(source => source.sourceId === operation.source.sourceId))
                throw new Error('MEDIA_SEQUENCE_DUPLICATE_ID')

            this.sequence.sources.push(
                structuredClone(operation.source),
            )

            return
        }

        if (operation.op === 'remove-source') {
            this.reads.add(`source:${operation.sourceId}`)

            if (this.sequence.clips.some(clip => clip.sourceId === operation.sourceId))
                throw new Error('MEDIA_SEQUENCE_SOURCE_IN_USE')

            if (!this.sequence.sources.some(source => source.sourceId === operation.sourceId))
                throw new Error('MEDIA_SEQUENCE_MISSING_SOURCE')

            this.sequence.sources = this.sequence.sources.filter(source => source.sourceId !== operation.sourceId)

            return
        }

        if (operation.op === 'insert-clip') {
            this.track(operation.clip.trackId)

            if (operation.clip.sourceId)
                this.reads.add(`source:${operation.clip.sourceId}`)

            if (this.sequence.clips.some(clip => clip.clipId === operation.clip.clipId))
                throw new Error('MEDIA_SEQUENCE_DUPLICATE_ID')

            this.sequence.clips.push(
                structuredClone(operation.clip),
            )
            this.writes.add(`track-content:${operation.clip.trackId}`)
            this.extendDuration()

            return
        }

        if (operation.op === 'remove-clip') {
            this.removeClip(operation.clipId)

            return
        }

        if (operation.op === 'ripple-edit') {
            this.ripple(operation)

            return
        }

        if (operation.op === 'add-transition') {
            this.clip(operation.transition.clipId)

            if (operation.transition.otherClipId)
                this.clip(operation.transition.otherClipId)

            if (this.sequence.transitions.some(transition => transition.transitionId === operation.transition.transitionId))
                throw new Error('MEDIA_SEQUENCE_DUPLICATE_ID')

            this.sequence.transitions.push(
                structuredClone(operation.transition),
            )

            return
        }

        if (operation.op === 'remove-transition') {
            const transition = this.sequence.transitions.find(candidate => candidate.transitionId === operation.transitionId)

            if (!transition)
                throw new Error('MEDIA_SEQUENCE_MISSING_TRANSITION')

            this.clip(transition.clipId)

            if (transition.otherClipId)
                this.clip(transition.otherClipId)

            this.sequence.transitions = this.sequence.transitions.filter(candidate => candidate !== transition)

            return
        }

        if (operation.op === 'set-properties') {
            requireFields(operation.values, propertyNames)

            if (operation.values.duration !== undefined) for (const clip of this.sequence.clips)
                this.reads.add(`clip:${clip.clipId}`)

            Object.entries(operation.values).forEach(([key, value]) => {
                ;(this.sequence as unknown as Record<string, unknown>)[key] = structuredClone(value)
            })

            return
        }

        const clip = this.clip(operation.clipId)

        if (operation.op === 'move-clip') {
            this.track(operation.trackId)
            this.writes.add(`track-content:${clip.trackId}`)
            clip.trackId = operation.trackId
            clip.start = operation.start
            this.writes.add(`track-content:${clip.trackId}`)
        } else if (operation.op === 'split-clip') {
            assertSequenceId(operation.newClipId)

            if (this.sequence.clips.some(candidate => candidate.clipId === operation.newClipId))
                throw new Error('MEDIA_SEQUENCE_DUPLICATE_ID')

            const local = operation.time - clip.start

            if (
                local <= 0
                || local >= clip.duration
            )
                throw new Error('MEDIA_SEQUENCE_SPLIT_OUTSIDE_CLIP')

            const left = this.sliceClip(
                clip,
                0,
                local,
                clip.clipId,
            )
            const right = this.sliceClip(
                clip,
                local,
                clip.duration,
                operation.newClipId,
            )
            right.start = left.start + left.duration
            this.sequence.clips = this.sequence.clips.flatMap(candidate => (candidate === clip ? [left, right] : [candidate]))

            for (const transition of this.sequence.transitions)
                if (
                    transition.clipId === clip.clipId
                    && transition.kind !== 'fade-in'
                )
                    transition.clipId = right.clipId

            this.writes.add(`track-content:${clip.trackId}`)
        } else if (operation.op === 'trim-clip') {
            const source = this.sequence.sources.find(source => source.sourceId === clip.sourceId)
            const shift = source
                && source.kind !== 'image'
                ? sourceDurationToSequenceTicks(
                    Math.max(0, operation.sourceIn - clip.sourceIn),
                    source.timeBase,
                    this.sequence.timeBase,
                    clip.rate,
                )
                : Math.max(0, operation.start - clip.start)
            clip.keyframes = this.sliceKeyframes(
                clip,
                shift,
                shift + operation.duration,
            )
            clip.sourceIn = operation.sourceIn
            clip.sourceOut = operation.sourceOut
            clip.start = operation.start
            clip.duration = operation.duration
            this.writes.add(`track-content:${clip.trackId}`)
        } else if (operation.op === 'set-rate') {
            const source = this.sequence.sources.find(source => source.sourceId === clip.sourceId)
            const oldDuration = clip.duration
            clip.rate = structuredClone(operation.rate)

            if (
                source
                && source.kind !== 'image'
            )
                clip.duration = sourceDurationToSequenceTicks(
                    clip.sourceOut - clip.sourceIn,
                    source.timeBase,
                    this.sequence.timeBase,
                    clip.rate,
                )

            clip.keyframes = clip.keyframes.map(
                keyframe => ({
                    ...keyframe,
                    time: Math.round(keyframe.time * clip.duration / oldDuration),
                }),
            )
            this.writes.add(`track-content:${clip.trackId}`)
        } else if (operation.op === 'set-transform') {
            requireFields(operation.values, ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'crop'])
            clip.transform = {
                ...clip.transform,
                ...structuredClone(operation.values),
            }
        } else if (operation.op === 'set-audio') {
            requireFields(operation.values, ['gain', 'pan', 'muted'])
            clip.audio = {
                ...clip.audio,
                ...structuredClone(operation.values),
            }
        } else if (operation.op === 'set-text')
            clip.text = structuredClone(operation.text)
        else if (operation.op === 'set-keyframe')
            clip.keyframes = [...clip.keyframes.filter(keyframe => keyframe.keyframeId !== operation.keyframe.keyframeId), structuredClone(operation.keyframe)]
        else if (operation.op === 'remove-keyframe') {
            if (!clip.keyframes.some(keyframe => keyframe.keyframeId === operation.keyframeId))
                throw new Error('MEDIA_SEQUENCE_MISSING_KEYFRAME')

            clip.keyframes = clip.keyframes.filter(keyframe => keyframe.keyframeId !== operation.keyframeId)
        }

        this.extendDuration()
    }

    private removeClip(clipId: string): void {
        const clip = this.clip(clipId)
        this.sequence.clips = this.sequence.clips.filter(candidate => candidate !== clip)
        this.sequence.transitions = this.sequence.transitions.filter(transition => transition.clipId !== clipId && transition.otherClipId !== clipId)
        this.writes.add(`track-content:${clip.trackId}`)
    }

    private extendDuration(): void {
        this.sequence.duration = Math.max(this.sequence.duration, ...this.sequence.clips.map(clip => clip.start + clip.duration))
    }

    private sliceClip(
        clip: SequenceClip,
        from: number,
        to: number,
        clipId: string,
    ): SequenceClip {
        const source = this.sequence.sources.find(source => source.sourceId === clip.sourceId)
        const sourceIn = source
            && source.kind !== 'image'
            ? clip.sourceIn + sequenceOffsetToSourceTicks(
                from,
                this.sequence.timeBase,
                source.timeBase,
                clip.rate,
            )
            : 0
        const sourceOut = source
            && source.kind !== 'image'
            ? Math.min(clip.sourceOut, clip.sourceIn + sequenceOffsetToSourceTicks(
                to,
                this.sequence.timeBase,
                source.timeBase,
                clip.rate,
            ))
            : 0
        const duration = source
            && source.kind !== 'image'
            ? sourceDurationToSequenceTicks(
                sourceOut - sourceIn,
                source.timeBase,
                this.sequence.timeBase,
                clip.rate,
            )
            : to - from

        return {
            ...structuredClone(clip),
            clipId,
            start: clip.start + from,
            sourceIn,
            sourceOut,
            duration,
            keyframes: this.sliceKeyframes(
                clip,
                from,
                from + duration,
            ),
        }
    }

    private sliceKeyframes(
        clip: SequenceClip,
        from: number,
        to: number,
    ): SequenceKeyframe[] {
        const retained = clip.keyframes.filter(keyframe => keyframe.time >= from && keyframe.time <= to).map(
            keyframe => ({
                ...keyframe,
                time: keyframe.time - from,
            }),
        )

        for (const property of new Set(
            clip.keyframes.map(keyframe => keyframe.property),
        )) {
            for (const [time, boundary] of [
                [0, from],
                [to - from, to],
            ]) {
                if (retained.some(keyframe => keyframe.property === property && keyframe.time === time))
                    continue

                const previous = clip.keyframes.filter(keyframe => keyframe.property === property && keyframe.time <= boundary).sort(
                    (left, right) => right.time - left.time,
                )[0]
                retained.push({
                    keyframeId: this.boundaryKeyframeId(
                        retained,
                        property,
                        time,
                    ),
                    property,
                    time,
                    value: evaluateSequenceProperty(
                        clip.keyframes,
                        property,
                        boundary,
                        0,
                    ),
                    interpolation: previous?.interpolation ?? 'linear',
                })
            }
        }

        return retained
    }

    private boundaryKeyframeId(
        keyframes: SequenceKeyframe[],
        property: string,
        time: number,
    ): string {
        const prefix = `boundary-${property}-${time}`
        let id = prefix
        let suffix = 1

        while (keyframes.some(keyframe => keyframe.keyframeId === id))
            id = `${prefix}-${suffix++}`

        return id
    }

    private ripple(operation: Extract<SequencePatchOperation, { op: 'ripple-edit' }>): void {
        this.track(operation.trackId)
        assertSequenceInteger(operation.start, 'RIPPLE_START')
        assertSequenceInteger(operation.deleteDuration, 'RIPPLE_DELETE')
        assertSequenceInteger(operation.insertDuration, 'RIPPLE_INSERT')
        const end = operation.start + operation.deleteDuration
        const delta = operation.insertDuration - operation.deleteDuration
        this.reads.add(`track-content:${operation.trackId}`)
        this.writes.add(`track-content:${operation.trackId}`)

        for (const clip of [...this.sequence.clips].filter(clip => clip.trackId === operation.trackId)) {
            this.clip(clip.clipId)
            const clipEnd = clip.start + clip.duration

            if (clipEnd <= operation.start)
                continue

            if (clip.start >= end) {
                clip.start += delta

                continue
            }

            const slices: SequenceClip[] = []

            if (clip.start < operation.start)
                slices.push(
                    this.sliceClip(
                        clip,
                        0,
                        operation.start - clip.start,
                        clip.clipId,
                    ),
                )

            if (clipEnd > end) {
                const rightId = slices.length ? operation.splitClipIds?.[clip.clipId] : clip.clipId

                if (!rightId)
                    throw new Error('MEDIA_SEQUENCE_RIPPLE_SPLIT_ID_REQUIRED')

                assertSequenceId(rightId)
                const right = this.sliceClip(
                    clip,
                    end - clip.start,
                    clip.duration,
                    rightId,
                )
                right.start = operation.start + operation.insertDuration
                slices.push(right)
            }

            this.sequence.clips = this.sequence.clips.flatMap(candidate => (candidate === clip ? slices : [candidate]))
            this.sequence.transitions = this.sequence.transitions.filter(
                transition => transition.clipId !== clip.clipId && transition.otherClipId !== clip.clipId,
            )
        }

        this.sequence.duration = Math.max(0, this.sequence.duration + delta)
        this.extendDuration()
    }

    private result(): AppliedSequencePatch {
        const inverse: SequenceObjectRestore[] = []
        const forward: SequenceObjectRestore[] = []
        const changed = new Set(this.writes)

        for (const [kind, name, idName] of [
            ['track', 'tracks', 'trackId'],
            ['source', 'sources', 'sourceId'],
            ['clip', 'clips', 'clipId'],
            ['transition', 'transitions', 'transitionId'],
        ] as const) {
            const before = this.original[name] as unknown as Array<Record<string, unknown>>
            const after = this.sequence[name] as unknown as Array<Record<string, unknown>>
            const ids = new Set(
                [...before, ...after].map(value => String(value[idName])),
            )

            for (const id of ids) {
                const previous = before.find(value => value[idName] === id) ?? null
                const next = after.find(value => value[idName] === id) ?? null

                if (same(previous, next))
                    continue

                changed.add(`${kind}:${id}`)
                inverse.push(
                    {
                        kind,
                        id,
                        value: structuredClone(previous),
                        ...(kind === 'track' ? { index: before.indexOf(previous!) } : {}),
                    } as SequenceObjectRestore,
                )
                forward.push(
                    {
                        kind,
                        id,
                        value: structuredClone(next),
                        ...(kind === 'track' ? { index: after.indexOf(next!) } : {}),
                    } as SequenceObjectRestore,
                )
            }
        }

        const previousOrder = this.original.tracks.map(track => track.trackId)
        const nextOrder = this.sequence.tracks.map(track => track.trackId)

        if (!same(previousOrder, nextOrder)) {
            changed.add('track-order')
            inverse.push({
                kind: 'track-order',
                value: previousOrder,
            })
            forward.push({
                kind: 'track-order',
                value: nextOrder,
            })
        }

        const previousProperties: Partial<SequenceProperties> = {}
        const nextProperties: Partial<SequenceProperties> = {}

        for (const name of propertyNames) {
            if (same(this.original[name], this.sequence[name]))
                continue

            changed.add(`property:${name}`)
            ;(previousProperties as Record<string, unknown>)[name] = structuredClone(this.original[name])
            ;(nextProperties as Record<string, unknown>)[name] = structuredClone(this.sequence[name])
        }

        if (Object.keys(previousProperties).length) {
            inverse.push({
                kind: 'properties',
                value: previousProperties,
            })
            forward.push({
                kind: 'properties',
                value: nextProperties,
            })
        }

        return {
            sequence: this.sequence,
            readObjectIds: [...this.reads].sort(),
            changedObjectIds: [...changed].sort(),
            inverse,
            forward,
        }
    }
}
