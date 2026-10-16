import { describe, expect, it, vi } from 'vitest'
import { AccountControlStream } from './account-control-stream.ts'

const configuration = {
    name: 'account_control',
    subjects: ['accounts.admission.changed.v1'],
    storage: 'file',
    retention: 'limits',
    num_replicas: 3,
    max_age: 0,
    max_msgs: -1,
    max_msgs_per_subject: -1,
    max_bytes: -1,
    deny_delete: true,
    deny_purge: true,
    allow_rollup_hdrs: false,
}
const fixture = (responses: unknown[]) => {
    const request = vi.fn()

    for (const response of responses)
        request.mockResolvedValueOnce({ json: () => response })

    return {
        request,
        stream: new AccountControlStream({ getConnection: () => ({ request }) }),
    }
}
describe('admission stream preparation', () => {
    it('creates a missing durable stream before it can be used', async () => {
        const {
            stream,
            request,
        } = fixture([{ error: { err_code: 10059 } }, {
            created: 'today',
            config: configuration,
        }])
        await stream.prepare('account_control', 3)
        expect(request).toHaveBeenCalledTimes(2)
        expect(request.mock.calls[1][0]).toBe('$JS.API.STREAM.CREATE.account_control')
        expect(JSON.parse(request.mock.calls[1][1])).toEqual(configuration)
    })
    it('does not modify a compatible existing stream', async () => {
        const {
            stream,
            request,
        } = fixture([{
            created: 'today',
            config: configuration,
        }])
        await stream.prepare('account_control', 3)
        expect(request).toHaveBeenCalledTimes(1)
    })
    it.each([{ error: { err_code: 10039 } }, {
        created: 'today',
        config: {
            ...configuration,
            max_age: 100,
        },
    },
        {
            created: 'today',
            config: {
                ...configuration,
                subjects: ['unrelated'],
            },
        },
        {
            created: 'today',
            config: {
                ...configuration,
                deny_purge: false,
            },
        }])('refuses an incompatible or unavailable stream without changing it', async response => {
        const {
            stream,
            request,
        } = fixture([response])
        await expect(stream.prepare('account_control', 3)).rejects.toThrow('incompatible')
        expect(request).toHaveBeenCalledTimes(1)
    })
})
