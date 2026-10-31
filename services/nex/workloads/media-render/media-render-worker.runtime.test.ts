import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { statfs } from 'node:fs/promises'
import {
    MediaSequenceRenderCompiler,
    defaultMediaRenderLimits,
    type MediaRenderRequest,
} from '@lixpi/capability-system/backend'
import {
    createMediaSequence,
    defaultSequenceAudio,
    defaultSequenceTransform,
} from '@lixpi/capability-system/shared'
import { MediaRenderWorker } from './media-render-worker.ts'
import { RenderProcess } from './render-process.ts'

vi.mock('node:fs/promises', async importOriginal => {
    const original = await importOriginal<typeof import('node:fs/promises')>()

    return {
        ...original,
        statfs: vi.fn(original.statfs),
    }
})

const request = (): MediaRenderRequest => {
    const sequence = createMediaSequence('test_sequence')
    sequence.width = 64
    sequence.height = 64
    sequence.duration = 120000
    sequence.audioSampleRate = 48000

    return {
        jobId: 'test_job',
        attempt: 1,
        organizationId: 'test_org',
        outputAssetId: 'test_output',
        sequence,
        preset: {
            presetId: 'mp4-h264-aac',
            quality: 'draft',
        },
    }
}

const storage = () => {
    const objects = new Map<string, Uint8Array>()

    return {
        objects,
        getObject: vi.fn(async (_bucket: string, key: string, _options?: {
            signal?: AbortSignal
            maxBytes?: number
        }) => objects.get(key) ?? null),
        putObject: vi.fn(async (_bucket: string, key: string, bytes: Uint8Array) => void objects.set(key, bytes)),
    }
}

// =============================================================================
// WORKER PROCESS, STORAGE AND FINALIZATION BOUNDARIES
// =============================================================================

describe('media render worker', () => {
    it('probes and exports an immutable original TIFF through local image demuxing', async () => {
        const { stdout: bytes } = await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', '-c:v', 'tiff', '-f', 'image2pipe', 'pipe:1'], { encoding: 'buffer' })
        const blobs = storage()
        const blobHash = createHash('sha256').update(bytes).digest('hex')
        blobs.objects.set(`sha256/${blobHash.slice(0, 2)}/${blobHash}`, bytes)
        const worker = new MediaRenderWorker(new MediaSequenceRenderCompiler(), blobs, async () => {})
        const source = {
            sourceId: 'tiff',
            assetId: 'asset',
            renditionId: 'original',
            blobHash,
            byteSize: bytes.length,
            kind: 'image' as const,
            timeBase: {
                numerator: 1,
                denominator: 1,
            },
            duration: 1,
            width: 64,
            height: 64,
        }

        try {
            expect(await worker.probeSource({
                organizationId: 'test_org',
                source,
            })).toMatchObject({
                width: 64,
                height: 64,
                hasAudio: false,
                blobHash,
            })
            const job = request()
            const sequence = job.sequence as ReturnType<typeof createMediaSequence>
            sequence.sources = [source]
            sequence.tracks = [{
                trackId: 'video',
                name: 'Video',
                kind: 'video',
                locked: false,
                visible: true,
                muted: false,
                solo: false,
            }]
            sequence.clips = [{
                clipId: 'clip',
                trackId: 'video',
                sourceId: 'tiff',
                sourceIn: 0,
                sourceOut: 0,
                start: 0,
                duration: sequence.duration,
                rate: {
                    numerator: 1,
                    denominator: 1,
                },
                transform: defaultSequenceTransform(),
                audio: defaultSequenceAudio(),
                keyframes: [],
            }]
            expect(await worker.run(job)).toMatchObject({
                mimeType: 'video/mp4',
                width: 64,
                height: 64,
                durationSeconds: 0.5,
            })
        } finally {
            await worker.stop()
        }
    }, 20000)
    it('rechecks temporary disk availability without hiding recovered encoders', async () => {
        const worker = new MediaRenderWorker(new MediaSequenceRenderCompiler(), storage(), async () => {})
        const ready = await worker.readiness()
        expect(ready.ready).toBe(true)
        vi.mocked(statfs).mockResolvedValueOnce({
            bavail: 1,
            bsize: 4096,
        } as never)
        const unavailable = await worker.readiness()
        expect(unavailable.ready).toBe(false)
        expect(unavailable.presets.every(preset => !preset.available && preset.reason === 'MEDIA_RENDER_DISK_UNAVAILABLE')).toBe(true)
        expect((await worker.readiness()).ready).toBe(true)
        await worker.stop()
        expect((await worker.readiness()).ready).toBe(false)
    })

    it('cancels a stalled source download through the typed storage signal', async () => {
        const blobs = storage()
        blobs.getObject.mockImplementationOnce(async (_bucket, _key, options) => await new Promise((_resolve, reject) => void options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true })))
        const worker = new MediaRenderWorker(new MediaSequenceRenderCompiler(), blobs, async () => {})
        const pending = worker.probeSource({
            organizationId: 'test_org',
            source: {
                sourceId: 'source',
                assetId: 'asset',
                renditionId: 'original',
                blobHash: 'a'.repeat(64),
                byteSize: 3,
                kind: 'audio',
                timeBase: {
                    numerator: 1,
                    denominator: 1,
                },
                duration: 1,
            },
        })
        const rejected = expect(pending).rejects.toThrow('MEDIA_RENDER_WORKER_STOPPED')
        await vi.waitFor(() => expect(blobs.getObject).toHaveBeenCalled())
        expect(blobs.getObject.mock.calls[0][2]).toMatchObject({
            maxBytes: 3,
            signal: expect.any(AbortSignal),
        })
        await worker.stop()
        await rejected
    })

    it('waits for an aborted source probe to release its resources before shutdown', async () => {
        const blobs = storage()
        const bytes = new Uint8Array([1, 2, 3])
        let finishDownload: (value: Uint8Array) => void = () => {}
        blobs.getObject.mockImplementationOnce(async () => await new Promise(resolve => void (finishDownload = resolve)))
        const worker = new MediaRenderWorker(new MediaSequenceRenderCompiler(), blobs, async () => {})
        const pending = worker.probeSource({
            organizationId: 'test_org',
            source: {
                sourceId: 'source',
                assetId: 'asset',
                renditionId: 'original',
                blobHash: createHash('sha256').update(bytes).digest('hex'),
                byteSize: bytes.byteLength,
                kind: 'audio',
                timeBase: {
                    numerator: 1,
                    denominator: 1,
                },
                duration: 1,
            },
        })
        const rejected = expect(pending).rejects.toThrow('MEDIA_RENDER_WORKER_STOPPED')
        await vi.waitFor(() => expect(blobs.getObject).toHaveBeenCalled())
        let stopped = false
        const shutdown = (async () => {
            await worker.stop()
            stopped = true
        })()
        await Promise.resolve()
        expect(stopped).toBe(false)
        finishDownload(bytes)
        await Promise.all([shutdown, rejected])
        expect(stopped).toBe(true)
        await expect(worker.run(request())).rejects.toThrow('MEDIA_RENDER_WORKER_STOPPED')
    })

    it('measures bounded waveform peaks and channel metadata from authorized source bytes', async () => {
        const blobs = storage()
        const bytes = Buffer.alloc(44 + 8000 * 2)
        bytes.write('RIFF', 0)
        bytes.writeUInt32LE(bytes.length - 8, 4)
        bytes.write('WAVEfmt ', 8)
        bytes.writeUInt32LE(16, 16)
        bytes.writeUInt16LE(1, 20)
        bytes.writeUInt16LE(1, 22)
        bytes.writeUInt32LE(8000, 24)
        bytes.writeUInt32LE(16000, 28)
        bytes.writeUInt16LE(2, 32)
        bytes.writeUInt16LE(16, 34)
        bytes.write('data', 36)
        bytes.writeUInt32LE(16000, 40)

        for (let sample = 0; sample < 8000; sample++)
            bytes.writeInt16LE(Math.round(Math.sin(sample * Math.PI * 2 * 440 / 8000) * (sample < 4000 ? 0.2 : 0.8) * 32767), 44 + sample * 2)

        const blobHash = createHash('sha256').update(bytes).digest('hex')
        blobs.objects.set(`sha256/${blobHash.slice(0, 2)}/${blobHash}`, bytes)
        const worker = new MediaRenderWorker(new MediaSequenceRenderCompiler(), blobs, async () => {})
        const result = await worker.probeSource({
            organizationId: 'test_org',
            source: {
                sourceId: 'audio',
                assetId: 'asset',
                renditionId: 'original',
                blobHash,
                byteSize: bytes.length,
                kind: 'audio',
                timeBase: {
                    numerator: 1,
                    denominator: 8000,
                },
                duration: 8000,
            },
        })
        expect(result).toMatchObject({
            probeVersion: 'media-source-v1',
            blobHash,
            channels: 1,
            audioSampleRate: 8000,
            durationSeconds: 1,
            hasAudio: true,
        })
        expect(result.peaks).toHaveLength(512)
        expect(Math.max(...result.peaks.slice(0, 250))).toBeCloseTo(0.2, 2)
        expect(Math.max(...result.peaks.slice(260))).toBeCloseTo(0.8, 2)
    }, 20000)

    it('probes installed encoders and stores a verified immutable export once for concurrent retries', async () => {
        const blobs = storage()
        const progress = vi.fn(async () => {})
        const worker = new MediaRenderWorker(new MediaSequenceRenderCompiler(), blobs, progress)
        expect((await worker.readiness()).presets).toEqual([
            {
                presetId: 'mp4-h264-aac',
                available: true,
            },
            {
                presetId: 'wav-pcm',
                available: true,
            },
            {
                presetId: 'mp3',
                available: true,
            },
        ])
        const input = request()
        const [first, duplicate] = await Promise.all([worker.run(input), worker.run(input)])
        expect(duplicate).toEqual(first)
        expect(first).toMatchObject({
            jobId: 'test_job',
            attempt: 1,
            sequenceRevision: 1,
            width: 64,
            height: 64,
            audioSampleRate: 48000,
            channels: 2,
        })
        expect(first.durationSeconds).toBeCloseTo(0.5, 1)
        const bytes = blobs.objects.get(first.objectKey)!
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(first.blobHash)
        expect(blobs.putObject).toHaveBeenCalledTimes(1)
        expect(progress.mock.calls.length).toBeGreaterThanOrEqual(3)
        expect(worker.cancel({
            jobId: 'test_job',
            attempt: 1,
            organizationId: 'test_org',
        })).toBe(false)
    }, 20000)

    it('rejects a probed frame rate that differs from the frozen sequence before publishing bytes', async () => {
        const blobs = storage()
        const runner = new RenderProcess()
        const run = runner.run.bind(runner)
        vi.spyOn(runner, 'run').mockImplementation(async (command, args, options) => {
            const result = await run(command, args, options)

            if (command !== 'ffprobe')
                return result

            const probe = JSON.parse(result)
            probe.streams.find(stream => stream.codec_type === 'video').avg_frame_rate = '12/1'

            return JSON.stringify(probe)
        })
        const worker = new MediaRenderWorker(new MediaSequenceRenderCompiler(), blobs, async () => {}, { ...defaultMediaRenderLimits }, runner)
        await expect(worker.run(request())).rejects.toThrow('MEDIA_RENDER_OUTPUT_INVALID')
        expect(blobs.putObject).not.toHaveBeenCalled()
    }, 20000)

    it('fences cancellation before output publication and ignores another organization or attempt', async () => {
        const blobs = storage()
        let worker: MediaRenderWorker
        worker = new MediaRenderWorker(new MediaSequenceRenderCompiler(), blobs, async event => {
            if (event.phase !== 'finalize')
                return

            expect(worker.cancel({
                jobId: 'test_job',
                attempt: 1,
                organizationId: 'another_org',
            })).toBe(false)
            expect(worker.cancel({
                jobId: 'test_job',
                attempt: 2,
                organizationId: 'test_org',
            })).toBe(false)
            expect(worker.cancel({
                jobId: 'test_job',
                attempt: 1,
                organizationId: 'test_org',
            })).toBe(true)
        })
        await expect(worker.run(request())).rejects.toThrow('MEDIA_RENDER_CANCELLED')
        expect(blobs.putObject).not.toHaveBeenCalled()
    }, 20000)

    it('rejects changed retries, excess concurrency and mismatched frozen source bytes', async () => {
        const blobs = storage()
        const pause = Promise.withResolvers<void>()
        const worker = new MediaRenderWorker(new MediaSequenceRenderCompiler(), blobs, async event => {
            if (event.phase === 'decode')
                await pause.promise
        })
        const job = request()
        const running = worker.run(job)
        await expect(worker.run({
            ...job,
            attempt: 2,
        })).rejects.toThrow('MEDIA_RENDER_ATTEMPT_CONFLICT')
        await expect(worker.run({
            ...job,
            jobId: 'second_job',
        })).rejects.toThrow('MEDIA_RENDER_BUSY')
        pause.resolve()
        await running

        const sourceJob = request()
        const sequence = createMediaSequence('source_sequence')
        sequence.width = 64
        sequence.height = 64
        sequence.duration = 120000
        sequence.tracks = [{
            trackId: 'video',
            name: 'Video',
            kind: 'video',
            locked: false,
            visible: true,
            muted: false,
            solo: false,
        }]
        sequence.sources = [{
            sourceId: 'source',
            assetId: 'asset',
            renditionId: 'original',
            blobHash: 'a'.repeat(64),
            byteSize: 3,
            kind: 'image',
            duration: 0,
            timeBase: {
                numerator: 1,
                denominator: 1,
            },
            width: 64,
            height: 64,
        }]
        sequence.clips = [{
            clipId: 'clip',
            trackId: 'video',
            sourceId: 'source',
            sourceIn: 0,
            sourceOut: 0,
            start: 0,
            duration: 120000,
            rate: {
                numerator: 1,
                denominator: 1,
            },
            transform: defaultSequenceTransform(),
            audio: defaultSequenceAudio(),
            keyframes: [],
        }]
        sourceJob.sequence = sequence
        await expect(worker.run(sourceJob)).rejects.toThrow('MEDIA_RENDER_SOURCE_INTEGRITY')
    }, 20000)

    it('rejects unavailable encoders and invalid resource settings before reading sources', async () => {
        const runner = new RenderProcess()
        vi.spyOn(runner, 'run').mockResolvedValue('')
        const blobs = storage()
        const worker = new MediaRenderWorker(new MediaSequenceRenderCompiler(), blobs, async () => {}, { ...defaultMediaRenderLimits }, runner)
        await expect(worker.run(request())).rejects.toThrow('MEDIA_RENDER_ENCODER_UNAVAILABLE')
        expect(blobs.getObject).not.toHaveBeenCalled()
        expect(() => new MediaRenderWorker(new MediaSequenceRenderCompiler(), blobs, async () => {}, {
            ...defaultMediaRenderLimits,
            timeoutSeconds: 0,
        })).toThrow('MEDIA_RENDER_INVALID_LIMIT')
    })

    it('kills and reaps the encoder process group on cancellation and timeout', async () => {
        const runner = new RenderProcess()
        const controller = new AbortController()
        const args = ['-v', 'error', '-re', '-f', 'lavfi', '-i', 'color=s=64x64:r=24', '-f', 'null', '-']
        const process = runner.run('ffmpeg', args, {
            signal: controller.signal,
            timeoutMs: 10000,
        })
        const timer = setTimeout(() => controller.abort(), 100)

        try {
            await expect(process).rejects.toThrow('MEDIA_RENDER_CANCELLED')
        } finally {
            clearTimeout(timer)
        }

        await expect(runner.run('ffmpeg', args, { timeoutMs: 100 })).rejects.toThrow('MEDIA_RENDER_TIMEOUT')
    })
})
