import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    getNatsUserInboxPrefix,
    getNatsUserSubjectToken,
} from './index.ts'

describe('user-scoped NATS reply inboxes', () => {
    it('derives a stable ASCII-safe inbox prefix from the full user identity', () => {
        expect(getNatsUserSubjectToken('auth0|user@example.com')).toBe(
            '61757468307c75736572406578616d706c652e636f6d',
        )
        expect(getNatsUserInboxPrefix('auth0|user@example.com')).toBe(
            '_INBOX.61757468307c75736572406578616d706c652e636f6d',
        )
    })

    it('rejects a missing user identity', () => {
        expect(() => getNatsUserInboxPrefix('')).toThrow(
            'A user identity is required for a NATS reply inbox',
        )
    })
})
