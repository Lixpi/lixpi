'use strict'

// nex-entry — the file-conversion responder, supervised on NATS NEX.
//
// The native nexlet launches this file as a long-running `service`:
//     node --experimental-transform-types index.ts
//
// All heavy media processing (sharp / ffmpeg / libreoffice / poppler) runs HERE.
// Jobs read content-addressed organization Blobs and return immutable rendition
// hashes; this workload never writes DynamoDB or workspace storage.
//
// Connection: the Object Store buckets live in the NATS `AUTH` account, so this
// workload connects to NATS as `AUTH`'s `regular_user` (same identity the API
// server uses) rather than the NEX-account creds the native nexlet mints — that
// keeps the conversion traffic and Object Store access entirely within AUTH with
// no cross-account export/import. The NEX node only supervises the process.
//
// Env reaches this process via the Nexfile start_request.environment that
// services/nex/entrypoint.sh injects (the native nexlet does NOT inherit the
// container env): NATS_SERVERS and NATS_REGULAR_USER_PASSWORD are required.

import process from 'process'

import NatsService from '@lixpi/nats-service'
import {
    info,
    warn,
    err,
} from '@lixpi/debug-tools'
import {
    NATS_SUBJECTS,
    type GenerateRenditionsRequest,
    type GenerateRenditionsResponse,
} from '@lixpi/constants'

import { generateAssetRenditions } from './asset-renditions.ts'

const { BLOB_PROCESSING_SUBJECTS } = NATS_SUBJECTS

const servers = process.env.NATS_SERVERS
const pass = process.env.NATS_REGULAR_USER_PASSWORD

if (!servers || !pass) {
    err('file-conversion: NATS_SERVERS and NATS_REGULAR_USER_PASSWORD are required; exiting')
    process.exit(1)
}

const fileConvertSubjects = [
    {
        subject: BLOB_PROCESSING_SUBJECTS.GENERATE_RENDITIONS,
        type: 'reply',
        payloadType: 'json',
        handler: async (data: GenerateRenditionsRequest) => {
            const service = NatsService.getInstance()
            if (!service) throw new Error('Conversion service storage unavailable.')
            let result: GenerateRenditionsResponse
            try {
                result = await generateAssetRenditions(data, service)
            } catch (error) {
                const candidate = error as { code?: string; message?: string }
                const errorCode = (candidate.code ?? candidate.message ?? 'RENDITION_JOB_FAILED')
                    .toUpperCase()
                    .replaceAll(/[^A-Z0-9]+/g, '_')
                    .slice(0, 96)
                result = {
                    jobId: data.jobId,
                    jobKey: data.jobKey,
                    organizationId: data.organizationId,
                    assetId: data.assetId,
                    sourceBlobHash: data.sourceBlobHash,
                    renditions: data.requestedRenditions.map((name) => ({
                        name,
                        status: 'failed' as const,
                        errorCode,
                    })),
                }
            }
            return result
        },
    },
]

const service = await NatsService.init({
    servers,
    name: 'nex-file-conversion',
    user: 'regular_user',
    pass,
    subscriptions: fileConvertSubjects,
})

info(`nex-entry file-conversion up; listening on ${BLOB_PROCESSING_SUBJECTS.GENERATE_RENDITIONS}`)

const shutdown = async (signal: string): Promise<void> => {
    warn(`nex-entry received ${signal}; shutting down file-conversion`)
    try {
        await service.close?.()
    } catch { /* best-effort */ }
    process.exit(0)
}

process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
})
process.on('SIGINT', () => {
    void shutdown('SIGINT')
})
