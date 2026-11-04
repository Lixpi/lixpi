import {
    createMediaSequence,
    defaultSequenceAudio,
    defaultSequenceTransform,
    type MediaSequence,
} from './media-sequence.ts'

export const sequenceFixture = (): MediaSequence => ({
    ...createMediaSequence('sequence'),
    timeBase: {
        numerator: 1,
        denominator: 240000,
    },
    duration: 2400000,
    tracks: [
        {
            trackId: 'video',
            name: 'Video',
            kind: 'video',
            locked: false,
            visible: true,
            muted: false,
            solo: false,
        },
        {
            trackId: 'audio',
            name: 'Audio',
            kind: 'audio',
            locked: false,
            visible: true,
            muted: false,
            solo: false,
        },
    ],
    sources: [{
        sourceId: 'source',
        assetId: 'asset',
        renditionId: 'original',
        blobHash: 'a'.repeat(64),
        byteSize: 100,
        kind: 'video',
        timeBase: {
            numerator: 1,
            denominator: 48000,
        },
        duration: 480000,
        width: 640,
        height: 360,
        hasAudio: true,
    }],
    clips: [{
        clipId: 'clip',
        trackId: 'video',
        sourceId: 'source',
        sourceIn: 0,
        sourceOut: 480000,
        start: 0,
        duration: 2400000,
        rate: {
            numerator: 1,
            denominator: 1,
        },
        transform: defaultSequenceTransform(),
        audio: defaultSequenceAudio(),
        keyframes: [],
    }],
})
