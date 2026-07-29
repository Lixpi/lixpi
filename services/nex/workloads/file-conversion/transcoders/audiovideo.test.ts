'use strict'

import { writeFile } from 'node:fs/promises'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { transcodeAudioVideo, extractPosterFrame, extractRepresentativeFrame, probeMedia } from './audiovideo.ts'

const runProcessMock = vi.fn()

vi.mock('./run-process.ts', async () => {
    const actual = await vi.importActual<typeof import('./run-process.ts')>('./run-process.ts')
    return {
        ...actual,
        runProcess: (...args: Parameters<typeof runProcessMock>) => runProcessMock(...args),
    }
})

vi.mock('@lixpi/debug-tools', () => ({
    warn: () => undefined,
}))

const parseShOutputPath = (command: string): string => {
    const match = />\s+"([^"]+)"$/.exec(command)
    if (!match) {
        throw new Error(`cannot parse sh output path: ${command}`)
    }
    return match[1]
}

beforeEach(() => {
    runProcessMock.mockReset()
})

describe('transcodeAudioVideo', () => {
    it('builds expected ffmpeg args for MP3', async () => {
        runProcessMock.mockImplementation(async (_command, args) => {
            const outPath = args.at(-1)
            await writeFile(outPath, Buffer.from('mp3'))
        })
        const out = await transcodeAudioVideo(Buffer.from('audio'), 'audio/mpeg')

        expect(out.toString()).toBe('mp3')
        expect(runProcessMock).toHaveBeenCalledWith(
            'ffmpeg',
            ['-y', '-i', expect.any(String), '-vn', '-c:a', 'libmp3lame', '-q:a', '2', expect.any(String)],
            { timeoutMs: 300000 },
        )
    })

    it('builds expected ffmpeg args for WAV', async () => {
        runProcessMock.mockImplementation(async (_command, args) => {
            const outPath = args.at(-1)
            await writeFile(outPath, Buffer.from('wav'))
        })
        const out = await transcodeAudioVideo(Buffer.from('audio'), 'audio/wav')

        expect(out.toString()).toBe('wav')
        expect(runProcessMock).toHaveBeenCalledWith(
            'ffmpeg',
            ['-y', '-i', expect.any(String), '-vn', expect.any(String)],
            { timeoutMs: 300000 },
        )
    })

    it('builds expected ffmpeg args for MP4', async () => {
        runProcessMock.mockImplementation(async (_command, args) => {
            const outPath = args.at(-1)
            await writeFile(outPath, Buffer.from('mp4'))
        })
        const out = await transcodeAudioVideo(Buffer.from('video'), 'video/mp4')

        expect(out.toString()).toBe('mp4')
        expect(runProcessMock).toHaveBeenCalledWith(
            'ffmpeg',
            expect.arrayContaining(['-c:v', 'libx264', '-preset', 'fast', '-movflags', '+faststart']),
            { timeoutMs: 300000 },
        )
    })

    it('throws for unsupported canonical mime', async () => {
        await expect(transcodeAudioVideo(Buffer.from('audio'), 'video/webm'))
            .rejects.toThrow('Unsupported audio/video canonical mime: video/webm')
    })
})

describe('extractPosterFrame / extractRepresentativeFrame', () => {
    it('extracts a frame from video at 0 when no seek time is passed', async () => {
        runProcessMock.mockImplementation(async (_command, args) => {
            const outPath = args.at(-1)
            await writeFile(outPath, Buffer.from('frame'))
        })
        const frame = await extractPosterFrame(Buffer.from('video'))

        expect(frame?.toString()).toBe('frame')
        expect(runProcessMock).toHaveBeenCalledWith(
            'ffmpeg',
            ['-y', '-i', expect.any(String), '-frames:v', '1', '-f', 'image2', '-c:v', 'png', expect.any(String)],
        )
    })

    it('extracts a representative frame from the provided second offset', async () => {
        runProcessMock.mockImplementation(async (_command, args) => {
            const outPath = args.at(-1)
            await writeFile(outPath, Buffer.from('frame'))
        })
        const frame = await extractRepresentativeFrame(Buffer.from('video'), 4.2)

        expect(frame?.toString()).toBe('frame')
        expect(runProcessMock).toHaveBeenCalledWith(
            'ffmpeg',
            ['-y', '-ss', '4.200', '-i', expect.any(String), '-frames:v', '1', '-f', 'image2', '-c:v', 'png', expect.any(String)],
        )
    })

    it('returns null when ffmpeg frame extraction fails', async () => {
        runProcessMock.mockRejectedValue(new Error('ffmpeg missing'))
        expect(await extractPosterFrame(Buffer.from('video'))).toBeNull()
    })
})

describe('probeMedia', () => {
    it('extracts duration, aspect ratio, and audio presence from ffprobe output', async () => {
        runProcessMock.mockImplementation(async (_command, args) => {
            const outPath = parseShOutputPath(args[1])
            await writeFile(outPath, JSON.stringify({
                format: { duration: '12.34' },
                streams: [
                    { codec_type: 'video', width: 1280, height: 720, duration: '10' },
                    { codec_type: 'audio', duration: '12.34' },
                ],
            }))
        })
        const probe = await probeMedia(Buffer.from('video'))
        expect(probe.durationSeconds).toBe(12.34)
        expect(probe.aspectRatio).toBe(1280 / 720)
        expect(probe.hasAudio).toBe(true)
    })

    it('returns a safe default when parser output is malformed', async () => {
        runProcessMock.mockImplementation(async (_command, args) => {
            const outPath = parseShOutputPath(args[1])
            await writeFile(outPath, '{bad json')
        })
        const probe = await probeMedia(Buffer.from('video'))
        expect(probe.durationSeconds).toBeNull()
        expect(probe.aspectRatio).toBeNull()
        expect(probe.hasAudio).toBe(false)
    })

    it('returns safe defaults when command fails', async () => {
        runProcessMock.mockRejectedValue(new Error('ffprobe missing'))
        const probe = await probeMedia(Buffer.from('video'))
        expect(probe.durationSeconds).toBeNull()
        expect(probe.aspectRatio).toBeNull()
        expect(probe.hasAudio).toBe(false)
    })
})
