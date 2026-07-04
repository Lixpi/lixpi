'use strict'

// nex-entry — the file-conversion responder, supervised on NATS NEX.
//
// The native nexlet launches this file as a long-running `service`:
//     node --experimental-transform-types index.ts
//
// All heavy media processing (sharp / ffmpeg / libreoffice / poppler) runs HERE,
// on the NEX node — never on the API container. The API stores an uploaded
// original to the workspace Object Store bucket and issues a NATS request on
// WORKSPACE_SUBJECTS.FILE_SUBJECTS.CONVERT; this responder reads the original,
// transcodes it, writes the canonical (+ poster) back to the same bucket, and
// replies with the canvas hints. The API then persists metadata and notifies the
// browser.
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
import { info, warn, err } from '@lixpi/debug-tools'
import { NATS_SUBJECTS, type ConvertFileRequest, type ExtractFramesRequest } from '@lixpi/constants'

import { convertWorkspaceFile, extractVideoFrames } from './file-conversion.ts'

const { FILE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

const servers = process.env.NATS_SERVERS
const pass = process.env.NATS_REGULAR_USER_PASSWORD

if (!servers || !pass) {
    err('file-conversion: NATS_SERVERS and NATS_REGULAR_USER_PASSWORD are required; exiting')
    process.exit(1)
}

// One reply handler: read the original from Object Store, transcode, write the
// canonical back, and reply with hints. convertWorkspaceFile never throws — a bad
// file becomes `{ success: false, error }` — so the responder survives it.
const fileConvertSubjects = [
    {
        subject: FILE_SUBJECTS.CONVERT,
        type: 'reply',
        payloadType: 'json',
        handler: async (data: ConvertFileRequest) => {
            const service = NatsService.getInstance()
            if (!service) {
                return { success: false, error: 'Conversion service storage unavailable.' }
            }
            try {
                return await convertWorkspaceFile(data, service)
            } catch (error: any) {
                // Backstop: convertWorkspaceFile is designed not to throw, but a
                // surprise (e.g. Object Store write failure) must not kill the loop.
                err('file-conversion handler error:', error)
                return { success: false, error: error?.message || 'File conversion failed.' }
            }
        },
    },
    {
        subject: FILE_SUBJECTS.EXTRACT_FRAMES,
        type: 'reply',
        payloadType: 'json',
        handler: async (data: ExtractFramesRequest) => {
            const service = NatsService.getInstance()
            if (!service) {
                return { success: false, error: 'Conversion service storage unavailable.' }
            }
            try {
                return await extractVideoFrames(data, service)
            } catch (error: any) {
                err('file-conversion extract-frames handler error:', error)
                return { success: false, error: error?.message || 'Frame extraction failed.' }
            }
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

info(`nex-entry file-conversion up; listening on ${FILE_SUBJECTS.CONVERT}`)

const shutdown = async (signal: string): Promise<void> => {
    warn(`nex-entry received ${signal}; shutting down file-conversion`)
    try { await service.close?.() } catch { /* best-effort */ }
    process.exit(0)
}

process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGINT', () => { void shutdown('SIGINT') })
