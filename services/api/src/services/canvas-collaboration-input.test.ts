import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    type CanvasCollaborationPresence,
} from '@lixpi/constants'
import { readCanvasPresence } from './canvas-collaboration-input.ts'

const playback = {
    nodeId: 'video-1',
    time: 135.75,
    paused: false,
    rate: 1.25,
    volume: 0.75,
    muted: false,
}

describe('Canvas control presence', () => {
    it('copies only the allowed menu, playback and library fields', () => {
        const input = {
            menu: {
                kind: 'model-settings',
                nodeId: 'image-1',
                controlId: 'model-id',
                text: 'private text',
            },
            playback: {
                ...playback,
                transcript: 'private transcript',
            },
            library: {
                kind: 'artifacts' as const,
                selectedId: 'artifact-1',
                scrollTop: 175,
                title: 'private title',
            },
        }

        expect(readCanvasPresence(input)).toEqual({
            menu: {
                kind: 'model-settings',
                nodeId: 'image-1',
                controlId: 'model-id',
            },
            playback,
            library: {
                kind: 'artifacts',
                selectedId: 'artifact-1',
                scrollTop: 175,
            },
        })
    })

    it('accepts closed controls and playback bounds', () => {
        const closed = {
            menu: null,
            playback: null,
            library: null,
        }

        expect(readCanvasPresence(closed)).toEqual(closed)
        expect(readCanvasPresence({
            library: {
                kind: 'media',
                selectedId: null,
            },
            playback: {
                ...playback,
                time: 0,
                rate: 0.25,
                volume: 0,
            },
        })).toMatchObject({
            library: {
                kind: 'media',
                selectedId: null,
            },
            playback: {
                time: 0,
                rate: 0.25,
                volume: 0,
            },
        })
        expect(readCanvasPresence({
            playback: {
                ...playback,
                rate: 4,
                volume: 1,
            },
        })).toMatchObject({
            playback: {
                rate: 4,
                volume: 1,
            },
        })
    })

    it.each([
        ['non-finite playback time', { playback: {
            ...playback,
            time: Infinity,
        } }],
        ['negative playback time', { playback: {
            ...playback,
            time: -1,
        } }],
        ['rate below the player range', { playback: {
            ...playback,
            rate: 0.24,
        } }],
        ['rate above the player range', { playback: {
            ...playback,
            rate: 4.01,
        } }],
        ['volume outside its range', { playback: {
            ...playback,
            volume: 1.01,
        } }],
        ['invalid playback flag', { playback: {
            ...playback,
            muted: 'false',
        } }],
        ['unsupported library kind', { library: {
            kind: 'conversations',
            selectedId: null,
        } }],
        ['unbounded library offset', { library: {
            kind: 'media',
            selectedId: null,
            scrollTop: 1e10,
        } }],
        ['invalid selected ID', { library: {
            kind: 'media',
            selectedId: 'a path',
        } }],
        ['oversized control ID', { menu: {
            kind: 'model-settings',
            controlId: 'x'.repeat(193),
        } }],
    ])('rejects %s', (_label, input) => void expect(() => readCanvasPresence(input as CanvasCollaborationPresence)).toThrow('INVALID_CANVAS_PRESENCE'))
})
