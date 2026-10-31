import {
    beforeAll,
    afterAll,
    describe,
    expect,
    it,
} from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
    createMediaSequence,
    defaultSequenceAudio,
    defaultSequenceTransform,
    type MediaSequence,
} from '../../shared/media-sequence.ts'
import { MediaSequenceRenderCompiler } from './sequence-render-compiler.ts'
import { defaultMediaRenderLimits } from './render-contract.ts'

const execute = promisify(execFile)
const compiler = new MediaSequenceRenderCompiler()
let directory = ''
let sequence: MediaSequence

const frame = async (path: string, seconds: number): Promise<Buffer> => {
    const result = await execute('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
        encoding: 'buffer',
        maxBuffer: 1024 * 1024,
    })

    return result.stdout
}

beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sequence-fixture-'))
    sequence = createMediaSequence('sequence_fixture')
    sequence.width = 64
    sequence.height = 64
    sequence.frameRate = {
        numerator: 24,
        denominator: 1,
    }
    sequence.audioSampleRate = 48000
    sequence.duration = 360000
    sequence.tracks = [{
        trackId: 'video',
        name: 'Video',
        kind: 'video',
        locked: false,
        visible: true,
        muted: false,
        solo: false,
    }]

    for (const [index, color] of ['red', 'blue'].entries()) {
        const filename = join(directory, `input-${index}`)
        await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64:r=24:d=1`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mp4', filename])
        const bytes = await readFile(filename)
        sequence.sources.push({
            sourceId: `source${index}`,
            assetId: `asset${index}`,
            renditionId: 'original',
            blobHash: createHash('sha256').update(bytes).digest('hex'),
            byteSize: bytes.byteLength,
            kind: 'video',
            timeBase: {
                numerator: 1,
                denominator: 240000,
            },
            duration: 240000,
            width: 64,
            height: 64,
            channels: 1,
            hasAudio: true,
        })
        sequence.clips.push({
            clipId: `clip${index}`,
            trackId: 'video',
            sourceId: `source${index}`,
            sourceIn: 0,
            sourceOut: 240000,
            start: index * 120000,
            duration: 240000,
            rate: {
                numerator: 1,
                denominator: 1,
            },
            transform: defaultSequenceTransform(),
            audio: defaultSequenceAudio(),
            keyframes: [],
        })
    }

    sequence.transitions = [{
        transitionId: 'dissolve',
        kind: 'cross-dissolve',
        clipId: 'clip0',
        otherClipId: 'clip1',
        duration: 120000,
    }]
}, 20000)

afterAll(async () => void (await rm(directory, {
    recursive: true,
    force: true,
})))

// =============================================================================
// REAL FFMPEG EXPORTS
// =============================================================================

describe('media sequence render compiler', () => {
    it('renders overlapping video and audio with a cross-dissolve, fixed codecs and duration', async () => {
        const plan = compiler.compile(sequence, {
            presetId: 'mp4-h264-aac',
            quality: 'draft',
        }, defaultMediaRenderLimits)
        await execute('ffmpeg', plan.arguments, {
            cwd: directory,
            maxBuffer: 1024 * 1024,
        })
        const output = join(directory, plan.outputFilename)
        const probe = JSON.parse((await execute('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output])).stdout)
        expect(probe.streams.map((stream: { codec_name: string }) => stream.codec_name)).toEqual(['h264', 'aac'])
        expect(probe.streams[0]).toMatchObject({
            width: 64,
            height: 64,
            avg_frame_rate: '24/1',
        })
        expect(probe.streams[1]).toMatchObject({
            sample_rate: '48000',
            channels: 2,
        })
        expect(Number(probe.format.duration)).toBeCloseTo(1.5, 1)
        const before = await frame(output, 0.25)
        const during = await frame(output, 0.75)
        const after = await frame(output, 1.25)
        const center = (32 * 64 + 32) * 3
        expect(before[center]).toBeGreaterThan(220)
        expect(before[center + 2]).toBeLessThan(20)
        expect(during[center]).toBeGreaterThan(90)
        expect(during[center]).toBeLessThan(170)
        expect(during[center + 2]).toBeGreaterThan(90)
        expect(after[center]).toBeLessThan(20)
        expect(after[center + 2]).toBeGreaterThan(220)
    }, 20000)

    it('keeps delayed video and gain automation aligned at a rational frame rate after a speed change', async () => {
        const timed = structuredClone(sequence)
        timed.frameRate = {
            numerator: 30000,
            denominator: 1001,
        }
        timed.transitions = []
        timed.clips = [timed.clips[0]]
        const clip = timed.clips[0]
        clip.start = 120000
        clip.duration = 120000
        clip.rate = {
            numerator: 2,
            denominator: 1,
        }
        clip.audio.gain = 0
        clip.keyframes = [{
            keyframeId: 'gain-ramp',
            property: 'gain',
            time: 60000,
            value: 1,
            interpolation: 'linear',
        }]
        const plan = compiler.compile(timed, {
            presetId: 'mp4-h264-aac',
            quality: 'high',
        }, defaultMediaRenderLimits)
        await execute('ffmpeg', plan.arguments, {
            cwd: directory,
            maxBuffer: 1024 * 1024,
        })
        const output = join(directory, plan.outputFilename)
        const probe = JSON.parse((await execute('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output])).stdout)
        expect(probe.streams[0].avg_frame_rate).toBe('30000/1001')
        expect(Number(probe.format.duration)).toBeCloseTo(1.5, 1)
        const pixels = await Promise.all([0.25, 0.6, 1.2].map(async time => await frame(output, time)))
        const center = (32 * 64 + 32) * 3
        expect(pixels[0][center]).toBeLessThan(20)
        expect(pixels[1][center]).toBeGreaterThan(220)
        expect(pixels[2][center]).toBeLessThan(20)
        const decoded = await execute('ffmpeg', ['-v', 'error', '-i', output, '-vn', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'], {
            encoding: 'buffer',
            maxBuffer: 1024 * 1024,
        })
        const rms = (start: number, end: number): number => {
            let sum = 0
            const from = Math.round(start * 48000)
            const to = Math.round(end * 48000)

            for (let sample = from; sample < to; sample++)
                sum += decoded.stdout.readFloatLE(sample * 8) ** 2

            return Math.sqrt(sum / (to - from))
        }
        expect(rms(0.1, 0.4)).toBeLessThan(0.001)
        expect(rms(0.57, 0.62)).toBeGreaterThan(0.01)
        expect(rms(0.57, 0.62)).toBeLessThan(rms(0.85, 0.95) * 0.6)
        expect(rms(0.85, 0.95)).toBeGreaterThan(0.07)
        expect(rms(1.1, 1.4)).toBeLessThan(0.001)
    }, 20000)

    it.each(['wav-pcm', 'mp3'] as const)('exports %s with sample rate, stereo balance and gain', async presetId => {
        const audioSequence = structuredClone(sequence)
        audioSequence.transitions = []
        audioSequence.clips = [audioSequence.clips[0]]
        audioSequence.clips[0].audio = {
            gain: 0.5,
            pan: -1,
            muted: false,
        }
        const plan = compiler.compile(audioSequence, {
            presetId,
            quality: 'standard',
        }, defaultMediaRenderLimits)
        await execute('ffmpeg', plan.arguments, {
            cwd: directory,
            maxBuffer: 1024 * 1024,
        })
        const probe = JSON.parse((await execute('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(directory, plan.outputFilename)])).stdout)
        expect(probe.streams).toHaveLength(1)
        expect(probe.streams[0]).toMatchObject({
            codec_name: presetId === 'wav-pcm' ? 'pcm_s16le' : 'mp3',
            sample_rate: '48000',
            channels: 2,
        })
        expect(Number(probe.format.duration)).toBeCloseTo(1.5, 1)
        const result = await execute('ffmpeg', ['-v', 'error', '-i', plan.outputFilename, '-t', '0.5', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'], {
            cwd: directory,
            encoding: 'buffer',
            maxBuffer: 1024 * 1024,
        })
        let left = 0
        let right = 0

        for (let index = 0; index + 8 <= result.stdout.length; index += 8) {
            left += result.stdout.readFloatLE(index) ** 2
            right += result.stdout.readFloatLE(index + 4) ** 2
        }

        expect(Math.sqrt(left / (result.stdout.length / 8))).toBeGreaterThan(0.04)
        expect(Math.sqrt(left / (result.stdout.length / 8))).toBeLessThan(0.05)
        expect(right).toBeLessThan(left / 1000)
    }, 20000)

    it('renders literal text and numeric keyframes without accepting filter text', async () => {
        const textSequence = structuredClone(sequence)
        textSequence.tracks.push({
            trackId: 'text',
            name: 'Titles',
            kind: 'text',
            visible: true,
            locked: false,
            muted: false,
            solo: false,
        })
        textSequence.clips.push({
            clipId: 'title',
            trackId: 'text',
            sourceIn: 0,
            sourceOut: 0,
            start: 0,
            duration: 360000,
            rate: {
                numerator: 1,
                denominator: 1,
            },
            transform: defaultSequenceTransform(),
            audio: defaultSequenceAudio(),
            text: {
                content: "A:%{n}';[x]",
                fontFamily: 'sans',
                fontSize: 12,
                color: '#ffffff',
                align: 'left',
            },
            keyframes: [{
                keyframeId: 'move',
                property: 'x',
                time: 240000,
                value: 4,
                interpolation: 'linear',
            }],
        })
        const plan = compiler.compile(textSequence, undefined, defaultMediaRenderLimits)

        for (const resource of plan.resources)
            await writeFile(join(directory, resource.filename), resource.content)

        expect(plan.arguments.join(' ').includes("A:%{n}';[x]")).toBe(false)
        await execute('ffmpeg', plan.arguments, {
            cwd: directory,
            maxBuffer: 1024 * 1024,
        })
        const pixels = await frame(join(directory, plan.outputFilename), 0.25)
        const green = [...pixels.subarray(0, 64 * 16 * 3)].filter((value, index) => index % 3 === 1 && value > 150)
        expect(green.length).toBeGreaterThan(20)
        expect(() => compiler.compile({
            ...textSequence,
            filterGraph: 'movie=https://example.com/',
        }, undefined, defaultMediaRenderLimits)).toThrow('MEDIA_SEQUENCE_UNKNOWN_FIELD')
    }, 20000)

    it('rejects oversized transforms and disk estimates before processing sources', () => {
        const huge = structuredClone(sequence)
        huge.clips[0].transform.scaleX = 100000
        expect(() => compiler.compile(huge, undefined, defaultMediaRenderLimits)).toThrow('MEDIA_RENDER_RESOURCE_LIMIT')
        expect(() => compiler.compile(sequence, undefined, {
            ...defaultMediaRenderLimits,
            tempLimitBytes: 1024,
        })).toThrow('MEDIA_RENDER_DISK_LIMIT')
        expect(() => compiler.compile(sequence, undefined, {
            ...defaultMediaRenderLimits,
            maxBufferedBytes: 1024,
        })).toThrow('MEDIA_RENDER_BUFFER_LIMIT')
    })

    it('evaluates crop, scale, rotation, opacity and speed keyframes in the exported frames', async () => {
        const animated = structuredClone(sequence)
        animated.transitions = []
        animated.clips = [animated.clips[0]]
        const clip = animated.clips[0]
        clip.duration = 120000
        clip.rate = {
            numerator: 2,
            denominator: 1,
        }
        clip.transform = {
            x: 16,
            y: 16,
            scaleX: 0.5,
            scaleY: 0.5,
            rotation: 45,
            opacity: 0.5,
            crop: {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
        }
        clip.keyframes = [
            {
                keyframeId: 'scale',
                property: 'scaleX',
                time: 60000,
                value: 0.75,
                interpolation: 'linear',
            },
            {
                keyframeId: 'turn',
                property: 'rotation',
                time: 60000,
                value: 90,
                interpolation: 'linear',
            },
            {
                keyframeId: 'opacity',
                property: 'opacity',
                time: 60000,
                value: 1,
                interpolation: 'linear',
            },
            {
                keyframeId: 'gain',
                property: 'gain',
                time: 60000,
                value: 0.5,
                interpolation: 'linear',
            },
        ]
        const plan = compiler.compile(animated, undefined, defaultMediaRenderLimits)
        await execute('ffmpeg', plan.arguments, {
            cwd: directory,
            maxBuffer: 1024 * 1024,
        })
        const visible = await frame(join(directory, plan.outputFilename), 0.25)
        const ended = await frame(join(directory, plan.outputFilename), 0.75)
        const center = (32 * 64 + 32) * 3
        expect(visible[center]).toBeGreaterThan(150)
        expect(visible[center + 2]).toBeLessThan(20)
        expect(ended[center]).toBeLessThan(20)
    }, 20000)
})
