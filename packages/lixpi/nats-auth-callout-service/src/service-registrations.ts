import { fromPublic } from '@nats-io/nkeys'
import {
    type ServiceAuthConfig,
} from '@lixpi/auth-service'

const asRecord = (value: unknown): Record<string, unknown> => {
    if (
        !value
        || typeof value !== 'object'
        || Array.isArray(value)
    )
        throw new Error('Service registration must contain objects')

    return value as Record<string, unknown>
}

const requireKeys = (
    value: Record<string, unknown>,
    expected: string[],
): void => {
    if (Object.keys(value).some(key => !expected.includes(key)))
        throw new Error('Service registration contains an unknown field')
}

const parseSubjects = (
    value: unknown,
    direction: 'pub' | 'sub',
): string[] => {
    const permission = asRecord(value)
    requireKeys(permission, ['allow'])
    const subjects = permission.allow

    if (
        !Array.isArray(subjects)
        || subjects.length === 0
    )
        throw new Error('Service registrations require nonempty publish and subscribe allowlists')

    const seen = new Set<string>()

    for (const subject of subjects) {
        if (
            typeof subject !== 'string'
            || !/^[A-Za-z0-9_*>-]+(?:\.[A-Za-z0-9_*>-]+)*$/.test(subject)
        )
            throw new Error('Service registration contains an invalid subject')

        if (seen.has(subject))
            throw new Error('Service registration contains a duplicate subject')

        seen.add(subject)

        if (
            !subject.includes('*')
            && !subject.includes('>')
        )
            continue

        // Service inboxes have an explicit prefix. Replies to received requests
        // use bounded response permissions, never a persistent global grant.
        if (/^_INBOX\.[A-Za-z0-9_-]+\.>$/.test(subject))
            continue

        const operation = direction === 'pub' ? 'event' : 'request'
        const modulePattern = new RegExp(
            `^portal\\.module\\.[a-z][a-z0-9-]*\\.(?:\\*|[a-f0-9]+)\\.${operation}\\.(?:>|[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*(?:\\.>)?)$`,
        )

        if (!modulePattern.test(subject))
            throw new Error('Service registration wildcard exceeds its module namespace')
    }

    return [...seen]
}

const parseResponsePermission = (value: unknown): {
    max: number
    ttl: number
} | undefined => {
    if (value === undefined)
        return undefined

    const response = asRecord(value)
    requireKeys(response, ['max', 'ttl'])

    if (
        response.max !== 1
        || typeof response.ttl !== 'number'
        || !Number.isSafeInteger(response.ttl)
        || response.ttl <= 0
        || response.ttl > 10_000_000_000
    )
        throw new Error('Service response permission must allow one reply within at most ten seconds')

    return {
        max: 1,
        ttl: response.ttl,
    }
}

export const parseAdditionalServiceAuthConfigs = (
    source: string | undefined,
    existing: ServiceAuthConfig[] = [],
): ServiceAuthConfig[] => {
    if (
        source === undefined
        || source === ''
    )
        return []

    const registrations: unknown = JSON.parse(source)

    if (!Array.isArray(registrations))
        throw new Error('NATS_SERVICE_AUTH_REGISTRATIONS must be a JSON array')

    const identities = new Set(
        existing.map(config => config.userId),
    )
    const publicKeys = new Set(
        existing.map(config => config.publicKey),
    )

    return registrations.map(value => {
        const registration = asRecord(value)
        requireKeys(registration, ['userId', 'publicKey', 'account', 'permissions'])
        const {
            userId,
            publicKey,
            account,
        } = registration

        if (
            typeof userId !== 'string'
            || !/^svc:[a-z][a-z0-9-]*$/.test(userId)
        )
            throw new Error('Service registration requires a stable svc: identity')

        if (
            typeof publicKey !== 'string'
            || !publicKey.startsWith('U')
        )
            throw new Error('Service registration requires a public user NKey')

        fromPublic(publicKey).getPublicKey()

        if (
            typeof account !== 'string'
            || !/^[A-Za-z0-9_-]+$/.test(account)
        )
            throw new Error('Service registration requires an explicit NATS account')

        if (
            identities.has(userId)
            || publicKeys.has(publicKey)
        )
            throw new Error('Service registration duplicates an identity or public NKey')

        const permissions = asRecord(registration.permissions)
        requireKeys(permissions, ['pub', 'sub', 'resp'])
        const responsePermission = parseResponsePermission(permissions.resp)
        const parsed = {
            publicKey,
            userId,
            account,
            permissions: {
                pub: { allow: parseSubjects(permissions.pub, 'pub') },
                sub: { allow: parseSubjects(permissions.sub, 'sub') },
                ...(responsePermission ? { resp: responsePermission } : {}),
            },
        }
        identities.add(userId)
        publicKeys.add(publicKey)

        return parsed
    })
}
