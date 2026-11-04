import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    ACCOUNT_ADMISSION_CLAIM,
    ACCOUNT_ADMISSION_CHECK_SUBJECT,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    type default as NatsService,
} from '@lixpi/nats-service'
import { AccountAdmissionRuntime } from './account-admission-runtime.ts'
import { jwtAuthMiddleware } from '../NATS/middleware/nats-auth-middleware.ts'

const signature = vi.hoisted(() => ({ verify: vi.fn() }))
vi.mock('@lixpi/auth-service', () => ({ createJwtVerifier: () => signature }))

const runtimes: AccountAdmissionRuntime[] = []
afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.stop()

    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('account admission runtime readiness', () => {
    it('rejects replay during startup and feed interruption without reporting account revocation, then resumes the same authenticated session', async () => {
        vi.stubEnv('ACCOUNT_ADMISSION_ENABLED', 'true')
        const issuer = 'https://identity.example/'
        const audience = 'https://api.example'
        const stream = 'ACCOUNT_ADMISSION'
        const registration = {
            payload: Buffer.from(JSON.stringify({ browsers: [{
                issuer,
                audience,
                admission: {
                    subject: ACCOUNT_ADMISSION_CHECK_SUBJECT,
                    claim: ACCOUNT_ADMISSION_CLAIM,
                    stream,
                },
            }] })).toString('base64'),
        }
        const connection = {
            subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
            flush: vi.fn(async () => {}),
        }
        const runtime = new AccountAdmissionRuntime(
            { getConnection: () => connection } as unknown as NatsService,
            { transactRead: vi.fn() },
            {
                AUTH0_DOMAIN: issuer,
                AUTH0_API_IDENTIFIER: audience,
                ACCOUNT_ADMISSION_STREAM: stream,
                NATS_APPLICATION_REGISTRATION: JSON.stringify(registration),
                ORG_NAME: 'test',
                STAGE: 'test',
            },
        )
        runtimes.push(runtime)
        let ready = false
        let finishStartup = () => {}
        const startupGate = new Promise<void>(resolve => void (finishStartup = resolve))
        vi.spyOn(runtime.feed, 'isReady').mockImplementation(() => ready)
        vi.spyOn(runtime.feed, 'start').mockImplementation(async () => {
            await startupGate
            ready = true
        })
        const admission = vi.spyOn(runtime.admission, 'admitVerifiedToken').mockResolvedValue({} as never)
        signature.verify.mockResolvedValue({ decoded: {
            sub: 'user',
            exp: Math.floor(Date.now() / 1000) + 60,
        } })
        const request = () => jwtAuthMiddleware(
            { token: 'same-session-token' },
            { subject: NATS_SUBJECTS.CONVERSATION_SUBJECTS.REPLAY } as never,
        )
        const starting = runtime.start()
        await expect(request()).rejects.toThrow(/^ACCOUNT_ADMISSION_UNAVAILABLE$/)
        expect(admission).not.toHaveBeenCalled()
        expect(connection.subscribe).not.toHaveBeenCalled()
        finishStartup()
        await starting
        expect(await request()).toMatchObject({ data: { user: { userId: 'user' } } })

        ready = false
        await expect(request()).rejects.toThrow(/^ACCOUNT_ADMISSION_UNAVAILABLE$/)
        expect(admission).toHaveBeenCalledOnce()
        ready = true
        expect(await request()).toMatchObject({ data: { user: { userId: 'user' } } })

        admission.mockRejectedValueOnce(new Error('ACCOUNT_ADMISSION_DENIED'))
        await expect(request()).rejects.toThrow(/^ACCOUNT_ADMISSION_DENIED$/)
        runtime.stop()
        await expect(request()).rejects.toThrow(/^ACCOUNT_ADMISSION_UNAVAILABLE$/)
    })
})
