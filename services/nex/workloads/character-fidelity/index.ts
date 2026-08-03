'use strict'

import process from 'process'

import NatsService from '@lixpi/nats-service'
import { err, info, warn } from '@lixpi/debug-tools'
import {
    NATS_SUBJECTS,
    type CharacterFidelityAssessmentRequest,
    type CharacterFidelityAssessmentResponse,
} from '@lixpi/constants'

import { assessCharacterFidelity, loadCharacterFidelityModels } from './scorer.ts'
import { CHARACTER_FIDELITY_MODEL_MANIFEST } from './model-manifest.ts'

const servers = process.env.NATS_SERVERS
const pass = process.env.NATS_REGULAR_USER_PASSWORD
if (!servers || !pass) {
    err('character-fidelity: NATS_SERVERS and NATS_REGULAR_USER_PASSWORD are required; exiting')
    process.exit(1)
}

const subject = NATS_SUBJECTS.CHARACTER_FIDELITY_SUBJECTS.ASSESS_PANEL

// The detector and recognizer sessions take far longer to build than the
// caller's request timeout, so they are warmed before the subject is served;
// otherwise the first assessment of every deployment races that timeout.
await loadCharacterFidelityModels()
info('character-fidelity: detector and recognizer sessions warmed')

const service = await NatsService.init({
    servers,
    name: 'nex-character-fidelity',
    user: 'regular_user',
    pass,
    subscriptions: [{
        subject,
        type: 'reply',
        payloadType: 'json',
        handler: async (request: CharacterFidelityAssessmentRequest): Promise<CharacterFidelityAssessmentResponse> => {
            try {
                return await assessCharacterFidelity(request, NatsService.getInstance()!)
            } catch (error) {
                const message = (error as Error).message
                return {
                    jobId: request.jobId,
                    panelId: request.panelId,
                    attemptId: request.attemptId,
                    metric: { available: false },
                    sourceDetections: [],
                    candidateDetections: [],
                    detector: {
                        artifactId: CHARACTER_FIDELITY_MODEL_MANIFEST.detector.artifactId,
                        sha256: CHARACTER_FIDELITY_MODEL_MANIFEST.detector.sha256,
                    },
                    recognizer: {
                        artifactId: CHARACTER_FIDELITY_MODEL_MANIFEST.recognizer.artifactId,
                        sha256: CHARACTER_FIDELITY_MODEL_MANIFEST.recognizer.sha256,
                    },
                    error: { code: message.split(':')[0]!.slice(0, 96), message: 'Character fidelity assessment failed.' },
                }
            }
        },
    }],
})

info(`nex-entry character-fidelity up; listening on ${subject}`)

const shutdown = async (signal: string): Promise<void> => {
    warn(`nex-entry received ${signal}; shutting down character-fidelity`)
    try { await service.close?.() } catch { /* best-effort */ }
    process.exit(0)
}

process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGINT', () => { void shutdown('SIGINT') })
