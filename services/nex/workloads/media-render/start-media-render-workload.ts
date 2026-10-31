import NatsService from '@lixpi/nats-service'
import { NATS_SUBJECTS } from '@lixpi/constants'
import {
    info,
    warn,
} from '@lixpi/debug-tools'
import {
    defaultMediaRenderLimits,
    type MediaRenderCompilerPort,
    type MediaRenderLimits,
    type MediaRenderRequest,
    type MediaSourceProbeRequest,
} from '@lixpi/capability-system/backend'
import {
    AccountWorkScopes,
    AccountWorkStorage,
} from '../account-work.ts'
import { MediaRenderWorker } from './media-render-worker.ts'

export const startMediaRenderWorkload = async (compiler: MediaRenderCompilerPort): Promise<void> => {
    const servers = process.env.NATS_SERVERS
    const nkeySeed = process.env.NATS_MEDIA_RENDER_NKEY_SEED

    if (
        !servers
        || !nkeySeed
    )
        throw new Error('media-render: NATS_SERVERS and NATS_MEDIA_RENDER_NKEY_SEED are required')

    const limits: MediaRenderLimits = {
        maxDurationSeconds: Number(process.env.MEDIA_RENDER_MAX_DURATION_SECONDS ?? defaultMediaRenderLimits.maxDurationSeconds),
        maxPixels: Number(process.env.MEDIA_RENDER_MAX_PIXELS ?? defaultMediaRenderLimits.maxPixels),
        maxFps: Number(process.env.MEDIA_RENDER_MAX_FPS ?? defaultMediaRenderLimits.maxFps),
        maxConcurrentJobs: Number(process.env.MEDIA_RENDER_MAX_CONCURRENT_JOBS ?? defaultMediaRenderLimits.maxConcurrentJobs),
        tempLimitBytes: Number(process.env.MEDIA_RENDER_TEMP_LIMIT_BYTES ?? defaultMediaRenderLimits.tempLimitBytes),
        maxBufferedBytes: defaultMediaRenderLimits.maxBufferedBytes,
        timeoutSeconds: Number(process.env.MEDIA_RENDER_TIMEOUT_SECONDS ?? defaultMediaRenderLimits.timeoutSeconds),
    }
    const subjects = NATS_SUBJECTS.MEDIA_RENDER_SUBJECTS
    const scopes = new AccountWorkScopes(process.env.ACCOUNT_ADMISSION_ENABLED === 'true')
    let worker: MediaRenderWorker
    const service = await NatsService.init({
        servers,
        nkeySeed,
        name: 'nex-media-render',
        userId: 'svc:media-render',
        subscriptions: [
            {
                subject: subjects.PROBE_SOURCE,
                type: 'reply',
                payloadType: 'json',
                handler: async (request: MediaSourceProbeRequest) => await scopes.run(request, async () => await worker.probeSource(request)),
            },
            {
                subject: subjects.RENDER,
                type: 'reply',
                payloadType: 'json',
                handler: async (request: MediaRenderRequest) => await scopes.run(request, async () => {
                    const result = await worker.run(request)
                    service.publish(subjects.COMPLETE, result)

                    return result
                }),
            },
            {
                subject: subjects.CANCEL,
                type: 'reply',
                payloadType: 'json',
                handler: async (request: {
                    jobId: string
                    attempt: number
                    organizationId: string
                }) => ({ cancelled: worker.cancel(request) }),
            },
            {
                subject: subjects.READINESS,
                type: 'reply',
                payloadType: 'json',
                handler: async () => await worker.readiness(),
            },
        ],
    })
    worker = new MediaRenderWorker(
        compiler,
        new AccountWorkStorage(service),
        async event => void service.publish(subjects.PROGRESS, event),
        limits,
    )
    scopes.start(service)
    info('media-render: worker ready', await worker.readiness())
    const shutdown = async (): Promise<void> => {
        scopes.stop()
        await worker.stop()
        await service.close()
    }

    for (const signal of ['SIGTERM', 'SIGINT'] as const)
        process.once(signal, async () => {
            try {
                await shutdown()
            } catch (error) {
                warn('media-render: shutdown failed', error)
            }
        })
}
