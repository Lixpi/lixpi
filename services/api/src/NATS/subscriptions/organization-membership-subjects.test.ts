import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const getSelfMembership = vi.hoisted(() => vi.fn())

vi.mock('../../models/organization.ts', () => ({
    default: {
        getSelfMembership,
    },
}))

import { organizationMembershipSubjects } from './organization-membership-subjects.ts'

describe('organization membership NATS subject', () => {
    beforeEach(() => vi.clearAllMocks())

    it('uses the identity attached by NATS JWT middleware', async () => {
        getSelfMembership.mockResolvedValue({ role: 'owner' })
        const [subscription] = organizationMembershipSubjects

        await expect(subscription?.handler({
            organizationId: 'org-123',
            userId: 'caller-controlled-value',
            user: {
                userId: 'auth0|verified-user',
            },
        })).resolves.toEqual({ role: 'owner' })

        expect(getSelfMembership).toHaveBeenCalledWith({
            organizationId: 'org-123',
            userId: 'auth0|verified-user',
        })
    })

    it.each([
        [{ user: { userId: 'auth0|verified-user' } }],
        [{ organizationId: 'org-123' }],
        [{
            organizationId: ' ',
            user: { userId: 'auth0|verified-user' },
        }],
    ])('rejects malformed membership requests', async data => {
        const [subscription] = organizationMembershipSubjects

        await expect(subscription?.handler(data)).rejects.toThrow(
            'INVALID_MEMBERSHIP_REQUEST',
        )
        expect(getSelfMembership).not.toHaveBeenCalled()
    })
})
