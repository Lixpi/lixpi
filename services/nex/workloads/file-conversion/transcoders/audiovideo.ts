'use strict'

import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { warn } from '@lixpi/debug-tools'

import { runProcess, withTempDir } from './run-process.ts'

// Transcode exotic audio/video to a model-safe canonical container. Audio →
// MP3; video → faststart H.264/AAC MP4. The target is the policy table's
// `canonicalMime` so the matrix lives in data, not in branches here.
export const transcodeAudioVideo = async (buffer: Buffer, canonicalMime: string): Promise<Buffer> =>
    withTempDir('av-transcode-', async (dir) => {
        const inPath = join(dir, 'in')
        await writeFile(inPath, buffer)

        let outPath: string
        let args: string[]
        switch (canonicalMime) {
            case 'audio/mpeg':
                outPath = join(dir, 'out.mp3')
                args = ['-y', '-i', inPath, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', outPath]
                break
            case 'audio/wav':
                outPath = join(dir, 'out.wav')
                args = ['-y', '-i', inPath, '-vn', outPath]
                break
            case 'video/mp4':
                outPath = join(dir, 'out.mp4')
                args = [
                    '-y', '-i', inPath,
                    '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac',
                    '-movflags', '+faststart',
                    outPath,
                ]
                break
            default:
                throw new Error(`Unsupported audio/video canonical mime: ${canonicalMime}`)
        }

        await runProcess('ffmpeg', args, { timeoutMs: 300000 })
        return readFile(outPath)
    })

// Extract a single PNG frame from a video. When `atSeconds` is set the decoder
// fast-seeks there first; otherwise it grabs frame 0. Best-effort — returns null
// if ffmpeg is unavailable or extraction fails, so a conversion never fails solely
// because a poster could not be produced.
const extractFrameFromVideo = async (videoBuffer: Buffer, atSeconds?: number): Promise<Buffer | null> => {
    try {
        return await withTempDir('av-frame-', async (dir) => {
            const inPath = join(dir, 'in.mp4')
            const outPath = join(dir, 'frame.png')
            await writeFile(inPath, videoBuffer)

            const seekArgs = typeof atSeconds === 'number' && atSeconds > 0
                ? ['-ss', atSeconds.toFixed(3)]
                : []

            await runProcess('ffmpeg', [
                '-y', ...seekArgs, '-i', inPath,
                '-frames:v', '1', '-f', 'image2', '-c:v', 'png', outPath,
            ])
            return readFile(outPath)
        })
    } catch (e: any) {
        warn(`extractFrameFromVideo failed (proceeding without frame): ${e?.message ?? e}`)
        return null
    }
}

// Frame 0 of a video, used as the PIXI low-LoD poster.
export const extractPosterFrame = async (videoBuffer: Buffer): Promise<Buffer | null> =>
    extractFrameFromVideo(videoBuffer)

// A frame near the temporal middle of the clip — the still the branch resolver
// grounds the video against and that VEO uses as the image-to-video anchor.
export const extractRepresentativeFrame = async (videoBuffer: Buffer, atSeconds?: number): Promise<Buffer | null> =>
    extractFrameFromVideo(videoBuffer, atSeconds)

// Probe a media buffer for duration / dimensions via ffprobe. Best-effort —
// returns nulls when ffprobe is unavailable or the stream can't be read.
export type MediaProbe = {
    durationSeconds: number | null
    aspectRatio: number | null
    hasAudio: boolean
    width: number | null
    height: number | null
}

export const probeMedia = async (buffer: Buffer): Promise<MediaProbe> => {
    try {
        return await withTempDir('av-probe-', async (dir) => {
            const inPath = join(dir, 'in')
            const outPath = join(dir, 'probe.json')
            await writeFile(inPath, buffer)
            await runProcess('sh', [
                '-c',
                `ffprobe -v quiet -print_format json -show_format -show_streams "${inPath}" > "${outPath}"`,
            ], { timeoutMs: 30000 })

            const probe = JSON.parse(await readFile(outPath, 'utf-8'))
            const streams: any[] = Array.isArray(probe.streams) ? probe.streams : []
            const videoStream = streams.find((s) => s.codec_type === 'video')
            const hasAudio = streams.some((s) => s.codec_type === 'audio')
            const durationRaw = Number(probe.format?.duration ?? videoStream?.duration)
            const width = Number(videoStream?.width)
            const height = Number(videoStream?.height)

            return {
                durationSeconds: Number.isFinite(durationRaw) ? durationRaw : null,
                aspectRatio: width && height ? width / height : null,
                hasAudio,
                width: width || null,
                height: height || null,
            }
        })
    } catch (e: any) {
        warn(`probeMedia failed (proceeding without probe): ${e?.message ?? e}`)
        return { durationSeconds: null, aspectRatio: null, hasAudio: false, width: null, height: null }
    }
}

export const createVideoPreview = async (buffer: Buffer): Promise<Buffer> =>
    withTempDir('av-preview-', async (dir) => {
        const inPath = join(dir, 'in')
        const outPath = join(dir, 'preview.mp4')
        await writeFile(inPath, buffer)
        await runProcess('ffmpeg', [
            '-y', '-i', inPath,
            '-vf', 'scale=w=min(1280\\,iw):h=-2',
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '26', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart',
            outPath,
        ], { timeoutMs: 300000 })
        return readFile(outPath)
    })
