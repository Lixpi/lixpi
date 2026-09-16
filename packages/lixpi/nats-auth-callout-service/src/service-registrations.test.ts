import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const {
    fromPublicMock,
    getPublicKeyMock,
} = vi.hoisted(() => ({
    fromPublicMock: vi.fn(),
    getPublicKeyMock: vi.fn(),
}))

vi.mock('@nats-io/nkeys', () => ({
    fromPublic: fromPublicMock,
}))

import { parseAdditionalServiceAuthConfigs } from './service-registrations.ts'

const registration = (overrides: Record<string, unknown> = {}): string => JSON.stringify([{
    userId: 'svc:portal',
    publicKey: 'USER_PUBLIC_KEY',
    account: 'AUTH',
    permissions: {
        pub: {
            allow: [
                'organization.membership.get',
                'portal.module.private.*.event.changed',
            ],
        },
        sub: {
            allow: [
                '_INBOX.svc-portal.>',
                'portal.module.private.*.request.>',
            ],
        },
        resp: {
            max: 1,
            ttl: 10_000_000_000,
        },
    },
    ...overrides,
}])

describe('parseAdditionalServiceAuthConfigs', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        fromPublicMock.mockReturnValue({ getPublicKey: getPublicKeyMock })
        getPublicKeyMock.mockReturnValue('USER_PUBLIC_KEY')
    })

    it('accepts an explicit scoped identity and bounded response permission', () => {
        expect(parseAdditionalServiceAuthConfigs(registration())).toEqual([{
            userId: 'svc:portal',
            publicKey: 'USER_PUBLIC_KEY',
            account: 'AUTH',
            permissions: {
                pub: {
                    allow: [
                        'organization.membership.get',
                        'portal.module.private.*.event.changed',
                    ],
                },
                sub: {
                    allow: [
                        '_INBOX.svc-portal.>',
                        'portal.module.private.*.request.>',
                    ],
                },
                resp: {
                    max: 1,
                    ttl: 10_000_000_000,
                },
            },
        }])
    })

    it.each([
        ['global inbox wildcard', registration({
            permissions: {
                pub: { allow: ['_INBOX.>'] },
                sub: { allow: ['portal.module.private.*.request.>'] },
            },
        })],
        ['module wildcard above the operation boundary', registration({
            permissions: {
                pub: { allow: ['portal.module.>'] },
                sub: { allow: ['portal.module.private.*.request.>'] },
            },
        })],
        ['unbounded response permission', registration({
            permissions: {
                pub: { allow: ['organization.membership.get'] },
                sub: { allow: ['portal.module.private.*.request.>'] },
                resp: {
                    max: 2,
                    ttl: 10_000_000_000,
                },
            },
        })],
    ])('rejects %s', (_label, source) => expect(
        () => parseAdditionalServiceAuthConfigs(source),
    ).toThrow())

    it('rejects identities and public keys already registered by the API', () => {
        const existing = [{
            userId: 'svc:portal',
            publicKey: 'OTHER_PUBLIC_KEY',
            account: 'AUTH',
            permissions: {
                pub: { allow: ['existing.publish'] },
                sub: { allow: ['existing.subscribe'] },
            },
        }]

        expect(() => parseAdditionalServiceAuthConfigs(
            registration(),
            existing,
        )).toThrow('duplicates an identity or public NKey')
    })
})
