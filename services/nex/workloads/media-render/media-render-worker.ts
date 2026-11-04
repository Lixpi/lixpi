import { createHash } from 'node:crypto'
import {
    access,
    readFile,
    readdir,
    stat,
    statfs,
    writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    defaultMediaRenderLimits,
    type MediaRenderCompilerPort,
    type MediaRenderLimits,
    type MediaRenderPlan,
    type MediaRenderProgress,
    type MediaRenderReadiness,
    type MediaRenderRequest,
    type MediaRenderResult,
    type MediaSourceProbeRequest,
    type MediaSourceProbeResult,
} from '@lixpi/capability-system/backend'
import {
    type ConversionStorage,
} from '../file-conversion/asset-renditions.ts'
import { withTempDir } from '../file-conversion/transcoders/run-process.ts'
import { AccountWorkScope } from '../account-work.ts'
import { RenderProcess } from './render-process.ts'

type ActiveRender = {
    attempt: number
    organizationId: string
    fingerprint: string
    controller: AbortController
    result: Promise<MediaRenderResult>
}

type Probe = {
    streams: Array<{
        codec_type: string
        codec_name: string
        width?: number
        height?: number
        sample_rate?: string
        channels?: number
        avg_frame_rate?: string
        side_data_list?: Array<{ rotation?: number }>
    }>
    format: { duration: string }
}

const hash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
const objectKey = (digest: string): string => `sha256/${digest.slice(0, 2)}/${digest}`
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
const minimumFreeDiskBytes = 8 * 1024 * 1024

export class MediaRenderWorker {
    private readonly active = new Map<string, ActiveRender>()
    private ready?: MediaRenderReadiness
    private probing = false
    private probeController?: AbortController
    private probeSettled?: Promise<void>
    private stopping = false

    constructor(
        private readonly compiler: MediaRenderCompilerPort,
        private readonly storage: ConversionStorage,
        private readonly progress: (event: MediaRenderProgress) => Promise<void>,
        private readonly limits: MediaRenderLimits = { ...defaultMediaRenderLimits },
        private readonly processRunner = new RenderProcess(),
    ) {
        for (const value of Object.values(limits))
            if (
                !Number.isSafeInteger(value)
                || value < 1
            )
                throw new Error('MEDIA_RENDER_INVALID_LIMIT')
    }

    async readiness(): Promise<MediaRenderReadiness> {
        const installed = await this.encoderReadiness()
        let available = false

        try {
            const disk = await statfs(
                tmpdir(),
            )
            available = !this.stopping && disk.bavail * disk.bsize >= minimumFreeDiskBytes
        } catch {
            // An inaccessible temporary filesystem cannot accept render work.
        }

        if (available)
            return installed

        return {
            ...installed,
            ready: false,
            presets: installed.presets.map(
                preset => ({
                    ...preset,
                    available: false,
                    reason: this.stopping ? 'MEDIA_RENDER_WORKER_STOPPED' : 'MEDIA_RENDER_DISK_UNAVAILABLE',
                }),
            ),
        }
    }

    private async encoderReadiness(): Promise<MediaRenderReadiness> {
        if (this.ready)
            return this.ready

        let encoders = ''
        let filters = ''
        let fonts = false

        try {
            encoders = await this.processRunner.run(
                'ffmpeg',
                ['-hide_banner', '-encoders'],
                { timeoutMs: 10000 },
            )
            filters = await this.processRunner.run(
                'ffmpeg',
                ['-hide_banner', '-filters'],
                { timeoutMs: 10000 },
            )
            await Promise.all(
                ['DejaVuSans.ttf', 'DejaVuSerif.ttf', 'DejaVuSansMono.ttf'].map(font => access(`/usr/share/fonts/dejavu/${font}`)),
            )
            fonts = true
        } catch {
            // Each unavailable preset reports its missing dependencies below.
        }

        const hasEncoder = (name: string): boolean => new RegExp(`\\s${name}\\s`).test(encoders)
        const videoAvailable = fonts
            && /\sdrawtext\s/.test(filters)
            && hasEncoder('libx264')
            && hasEncoder('aac')
        const presets: MediaRenderReadiness['presets'] = [
            {
                presetId: 'mp4-h264-aac',
                available: videoAvailable,
            },
            {
                presetId: 'wav-pcm',
                available: hasEncoder('pcm_s16le'),
            },
            {
                presetId: 'mp3',
                available: hasEncoder('libmp3lame'),
            },
        ].map(
            preset => ({
                ...preset,
                ...(!preset.available ? { reason: 'MEDIA_RENDER_ENCODER_UNAVAILABLE' } : {}),
            }),
        ) as MediaRenderReadiness['presets']
        this.ready = {
            ready: presets.some(preset => preset.available),
            presets,
            limits: { ...this.limits },
        }

        return this.ready
    }

    async probeSource(request: MediaSourceProbeRequest): Promise<MediaSourceProbeResult> {
        if (this.stopping)
            throw new Error('MEDIA_RENDER_WORKER_STOPPED')

        if (
            !request
            || !safeId(request.organizationId)
        )
            throw new Error('MEDIA_RENDER_INVALID_REQUEST')

        if (
            this.probing
            || this.active.size >= this.limits.maxConcurrentJobs
        )
            throw new Error('MEDIA_RENDER_BUSY')

        const source = this.compiler.validateSource(request.source)

        if (source.byteSize > Math.min(this.limits.tempLimitBytes, this.limits.maxBufferedBytes))
            throw new Error('MEDIA_RENDER_SOURCE_LIMIT')

        this.probing = true
        const controller = new AbortController()
        this.probeController = controller
        const accountSignal = AccountWorkScope.signal()
        const signal = accountSignal ? AbortSignal.any([controller.signal, accountSignal]) : controller.signal
        let settleProbe: () => void = () => {}
        this.probeSettled = new Promise(resolve => void (settleProbe = resolve))
        const deadline = setTimeout(
            () => controller.abort(
                new Error('MEDIA_SOURCE_PROBE_TIMEOUT'),
            ),
            90000,
        )

        try {
            await AccountWorkScope.check()

            return await withTempDir('lixpi-source-probe-', async directory => {
                const bytes = await this.storage.getObject(
                    `blobs-${request.organizationId}-files`,
                    objectKey(source.blobHash),
                    {
                        signal,
                        maxBytes: source.byteSize,
                    },
                )
                await AccountWorkScope.check()
                signal.throwIfAborted()

                if (
                    !bytes
                    || bytes.byteLength !== source.byteSize
                    || hash(bytes) !== source.blobHash
                )
                    throw new Error('MEDIA_RENDER_SOURCE_INTEGRITY')

                await writeFile(
                    join(directory, 'source'),
                    bytes,
                    { flag: 'wx' },
                )
                const whitelist = 'mov,matroska,webm,avi,mp3,wav,flac,ogg,aac,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,tiff_pipe,gif,image2'
                const inspected = JSON.parse(
                    await this.processRunner.run(
                        'ffprobe',
                        ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', whitelist, '-show_streams', '-show_format', '-of', 'json', 'source'],
                        {
                            cwd: directory,
                            signal,
                            timeoutMs: 30000,
                        },
                    ),
                ) as Probe
                const video = inspected.streams.find(stream => stream.codec_type === 'video')
                const audio = inspected.streams.find(stream => stream.codec_type === 'audio')
                const rotation = Math.abs(video?.side_data_list?.find(data => data.rotation !== undefined)?.rotation ?? 0) % 180
                const rotated = Math.abs(rotation - 90) < 0.01
                const duration = source.kind === 'image' ? 0 : Number(inspected.format.duration)

                if (
                    !Number.isFinite(duration)
                    || duration < 0
                    || duration > this.limits.maxDurationSeconds
                    || (video?.width ?? 0) * (video?.height ?? 0) > this.limits.maxPixels
                )
                    throw new Error('MEDIA_RENDER_SOURCE_LIMIT')

                const peaks = audio ? new Array<number>(512).fill(0) : []

                if (
                    audio
                    && duration > 0
                ) {
                    const totalSamples = Math.ceil(duration * 8000)
                    let sample = 0
                    let pending = Buffer.alloc(0)
                    await this.processRunner.run(
                        'ffmpeg',
                        ['-v', 'error', '-nostdin', '-threads', '1', '-protocol_whitelist', 'file,pipe', '-format_whitelist', whitelist, '-i', 'source', '-vn', '-t', String(duration), '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'],
                        {
                            cwd: directory,
                            signal,
                            timeoutMs: 60000,
                            captureOutput: false,
                            onBytes: chunk => {
                                const buffer = Buffer.concat([pending, chunk])
                                const complete = buffer.length - buffer.length % 4

                                for (let offset = 0; offset < complete; offset += 4) {
                                    if (sample > totalSamples + 8000)
                                        throw new Error('MEDIA_RENDER_SOURCE_LIMIT')

                                    const bucket = Math.min(
                                        511,
                                        Math.floor(sample++ * 512 / Math.max(1, totalSamples)),
                                    )
                                    const value = Math.abs(
                                        buffer.readFloatLE(offset),
                                    )

                                    if (Number.isFinite(value))
                                        peaks[bucket] = Math.max(
                                            peaks[bucket],
                                            Math.min(1, value),
                                        )
                                }

                                pending = Buffer.from(
                                    buffer.subarray(complete),
                                )
                            },
                        },
                    )
                }

                await AccountWorkScope.check()

                signal.throwIfAborted()

                return {
                    probeVersion: 'media-source-v1',
                    blobHash: source.blobHash,
                    durationSeconds: duration,
                    ...(video ? {
                        width: rotated ? video.height : video.width,
                        height: rotated ? video.width : video.height,
                    } : {}),
                    ...(audio ? {
                        channels: audio.channels,
                        audioSampleRate: Number(audio.sample_rate),
                    } : {}),
                    hasAudio: Boolean(audio),
                    peaks,
                }
            })
        } finally {
            this.probing = false
            clearTimeout(deadline)
            this.probeController = undefined
            this.probeSettled = undefined
            settleProbe()
        }
    }

    async run(request: MediaRenderRequest): Promise<MediaRenderResult> {
        if (this.stopping)
            throw new Error('MEDIA_RENDER_WORKER_STOPPED')

        if (
            !request
            || !safeId(request.jobId)
            || !safeId(request.organizationId)
            || !safeId(request.outputAssetId)
            || !Number.isSafeInteger(request.attempt)
            || request.attempt < 1
        )
            throw new Error('MEDIA_RENDER_INVALID_REQUEST')

        const plan = this.compiler.compile(
            request.sequence,
            request.preset,
            this.limits,
        )
        const fingerprint = hash(
            JSON.stringify({
                organizationId: request.organizationId,
                outputAssetId: request.outputAssetId,
                plan,
            }),
        )
        const existing = this.active.get(request.jobId)

        if (existing) {
            if (
                existing.attempt !== request.attempt
                || existing.fingerprint !== fingerprint
            )
                throw new Error('MEDIA_RENDER_ATTEMPT_CONFLICT')

            return await existing.result
        }

        if (this.active.size + Number(this.probing) >= this.limits.maxConcurrentJobs)
            throw new Error('MEDIA_RENDER_BUSY')

        const controller = new AbortController()
        const state: ActiveRender = {
            attempt: request.attempt,
            organizationId: request.organizationId,
            fingerprint,
            controller,
            result: Promise.resolve(undefined as never),
        }
        this.active.set(request.jobId, state)
        state.result = this.execute(
            request,
            plan,
            controller,
        )

        try {
            return await state.result
        } finally {
            if (this.active.get(request.jobId) === state)
                this.active.delete(request.jobId)
        }
    }

    cancel(request: {
        jobId: string
        attempt: number
        organizationId: string
    }): boolean {
        const state = this.active.get(request.jobId)

        if (
            !state
            || state.attempt !== request.attempt
            || state.organizationId !== request.organizationId
        )
            return false

        state.controller.abort(
            new Error('MEDIA_RENDER_CANCELLED'),
        )

        return true
    }

    async stop(): Promise<void> {
        this.stopping = true
        const probeSettled = this.probeSettled
        this.probeController?.abort(
            new Error('MEDIA_RENDER_WORKER_STOPPED'),
        )
        const states = [...this.active.values()]

        for (const state of states)
            state.controller.abort(
                new Error('MEDIA_RENDER_WORKER_STOPPED'),
            )

        await Promise.allSettled([...states.map(state => state.result), ...(probeSettled ? [probeSettled] : [])])
    }

    private async execute(
        request: MediaRenderRequest,
        plan: MediaRenderPlan,
        controller: AbortController,
    ): Promise<MediaRenderResult> {
        const accountSignal = AccountWorkScope.signal()
        const signal = accountSignal ? AbortSignal.any([controller.signal, accountSignal]) : controller.signal
        const deadline = setTimeout(
            () => controller.abort(
                new Error('MEDIA_RENDER_TIMEOUT'),
            ),
            this.limits.timeoutSeconds * 1000,
        )
        const check = async (): Promise<void> => {
            signal.throwIfAborted()
            await AccountWorkScope.check()
            signal.throwIfAborted()
        }
        const emit = async (
            phase: MediaRenderProgress['phase'],
            processedDurationSeconds?: number,
        ): Promise<void> => {
            await check()
            await this.progress({
                jobId: request.jobId,
                attempt: request.attempt,
                organizationId: request.organizationId,
                phase,
                durationSeconds: plan.durationSeconds,
                ...(processedDurationSeconds === undefined ? {} : { processedDurationSeconds }),
            })
        }

        try {
            await check()
            const readiness = await this.readiness()

            const preset = readiness.presets.find(preset => preset.presetId === plan.preset.presetId)

            if (!preset?.available)
                throw new Error(preset?.reason ?? 'MEDIA_RENDER_ENCODER_UNAVAILABLE')

            const disk = await statfs(
                tmpdir(),
            )

            if (disk.bavail * disk.bsize < plan.estimatedDiskBytes)
                throw new Error('MEDIA_RENDER_DISK_UNAVAILABLE')

            return await withTempDir('lixpi-media-render-', async directory => {
                let checkingDisk = false
                const monitor = setInterval(
                    async () => {
                        if (checkingDisk)
                            return

                        checkingDisk = true

                        try {
                            const sizes = await Promise.all(
                                (await readdir(directory)).map(
                                    async name => (await stat(
                                        join(directory, name),
                                    )).size,
                                ),
                            )

                            if (sizes.reduce((sum, size) => sum + size, 0) > this.limits.tempLimitBytes)
                                controller.abort(
                                    new Error('MEDIA_RENDER_DISK_LIMIT'),
                                )

                            const free = await statfs(directory)

                            if (free.bavail * free.bsize < minimumFreeDiskBytes)
                                controller.abort(
                                    new Error('MEDIA_RENDER_DISK_UNAVAILABLE'),
                                )
                        } catch {
                            controller.abort(
                                new Error('MEDIA_RENDER_DISK_UNAVAILABLE'),
                            )
                        } finally {
                            checkingDisk = false
                        }
                    },
                    250,
                )

                try {
                    await emit('decode')
                    const bucketName = `blobs-${request.organizationId}-files`

                    for (const input of plan.inputs) {
                        await check()
                        const bytes = await this.storage.getObject(
                            bucketName,
                            objectKey(input.blobHash),
                            {
                                signal,
                                maxBytes: input.byteSize,
                            },
                        )
                        await check()

                        if (
                            !bytes
                            || bytes.byteLength !== input.byteSize
                            || hash(bytes) !== input.blobHash
                        )
                            throw new Error('MEDIA_RENDER_SOURCE_INTEGRITY')

                        await writeFile(
                            join(directory, input.filename),
                            bytes,
                            { flag: 'wx' },
                        )
                    }

                    for (const resource of plan.resources)
                        await writeFile(
                            join(directory, resource.filename),
                            resource.content,
                            { flag: 'wx' },
                        )

                    await emit('compose')
                    let progressBuffer = ''
                    let lastSeconds = -1
                    let progressQueue = Promise.resolve()
                    await this.processRunner.run(
                        'ffmpeg',
                        plan.arguments,
                        {
                            cwd: directory,
                            signal,
                            timeoutMs: this.limits.timeoutSeconds * 1000,
                            maxFileBytes: Math.min(this.limits.tempLimitBytes, this.limits.maxBufferedBytes),
                            maxOutputBytes: 8 * 1024 * 1024,
                            onOutput: chunk => {
                                progressBuffer += chunk
                                const lines = progressBuffer.split('\n')
                                progressBuffer = lines.pop() ?? ''

                                for (const line of lines) {
                                    if (!line.startsWith('out_time_us='))
                                        continue

                                    const seconds = Math.min(
                                        plan.durationSeconds,
                                        Math.max(0, Number(
                                            line.slice(12),
                                        ) / 1000000),
                                    )

                                    if (
                                        Number.isFinite(seconds)
                                        && seconds > lastSeconds
                                    ) {
                                        lastSeconds = seconds
                                        progressQueue = progressQueue.then(() => emit('encode', seconds)).catch(
                                            () => controller.abort(
                                                new Error('MEDIA_RENDER_PROGRESS_FAILED'),
                                            ),
                                        )
                                    }
                                }
                            },
                        },
                    )
                    await progressQueue
                    await emit('finalize', plan.durationSeconds)
                    const outputPath = join(directory, plan.outputFilename)
                    const outputStat = await stat(outputPath)

                    if (
                        outputStat.size <= 0
                        || outputStat.size > Math.min(this.limits.tempLimitBytes, this.limits.maxBufferedBytes)
                    )
                        throw new Error('MEDIA_RENDER_OUTPUT_LIMIT')

                    const probe = JSON.parse(
                        await this.processRunner.run(
                            'ffprobe',
                            ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', plan.outputFilename],
                            {
                                cwd: directory,
                                signal,
                                timeoutMs: 30000,
                            },
                        ),
                    ) as Probe
                    const audio = probe.streams.find(stream => stream.codec_type === 'audio')
                    const video = probe.streams.find(stream => stream.codec_type === 'video')
                    const duration = Number(probe.format.duration)
                    const [numerator, denominator] = video?.avg_frame_rate?.split('/').map(Number) ?? []
                    const frameRate = numerator / denominator
                    const codecs = {
                        'mp4-h264-aac': 'aac',
                        'wav-pcm': 'pcm_s16le',
                        mp3: 'mp3',
                    }

                    if (
                        !Number.isFinite(duration)
                        || Math.abs(duration - plan.durationSeconds) > 0.15
                        || audio?.codec_name !== codecs[plan.preset.presetId]
                        || Number(audio.sample_rate) !== plan.sampleRate
                        || audio.channels !== 2
                        || (plan.width && (video?.codec_name !== 'h264' || video.width !== plan.width || video.height !== plan.height))
                        || (plan.frameRate && (!Number.isFinite(frameRate) || Math.abs(
                            frameRate - plan.frameRate.numerator / plan.frameRate.denominator,
                        ) > 0.000001))
                    )
                        throw new Error('MEDIA_RENDER_OUTPUT_INVALID')

                    const bytes = await readFile(outputPath)
                    const blobHash = hash(bytes)
                    const key = objectKey(blobHash)
                    await check()
                    const stored = await this.storage.getObject(
                        bucketName,
                        key,
                        {
                            signal,
                            maxBytes: bytes.byteLength,
                        },
                    )

                    if (
                        stored
                        && hash(stored) !== blobHash
                    )
                        throw new Error('MEDIA_RENDER_OUTPUT_INTEGRITY')

                    if (!stored)
                        await this.storage.putObject(
                            bucketName,
                            key,
                            bytes,
                        )

                    await check()

                    return {
                        jobId: request.jobId,
                        attempt: request.attempt,
                        organizationId: request.organizationId,
                        outputAssetId: request.outputAssetId,
                        sequenceId: plan.sequenceId,
                        sequenceRevision: plan.sequenceRevision,
                        presetId: plan.preset.presetId,
                        blobHash,
                        byteSize: bytes.byteLength,
                        bucketName,
                        objectKey: key,
                        mimeType: plan.mimeType,
                        durationSeconds: duration,
                        ...(video ? {
                            width: video.width,
                            height: video.height,
                        } : {}),
                        audioSampleRate: Number(audio.sample_rate),
                        channels: audio.channels!,
                    }
                } finally {
                    clearInterval(monitor)
                }
            })
        } finally {
            clearTimeout(deadline)
        }
    }
}
