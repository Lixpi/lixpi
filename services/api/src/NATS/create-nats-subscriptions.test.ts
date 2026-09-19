import { getNatsSubjectPath } from '@lixpi/constants'
import {
    describe,
    expect,
    it,
} from 'vitest'
import { createNatsSubscriptions, composeApiSubscriptions } from './create-nats-subscriptions.ts'
import { activeContractGroups } from '@lixpi/nats-subject-registry'

describe('contract handler bindings', () => {
    it('binds behavior without accepting permission overrides', async () => {
        const [subscription] = createNatsSubscriptions('user', { [getNatsSubjectPath(subjects => subjects.USER_SUBJECTS.GET_USER)]: async () => 'result' })
        expect(subscription.subject).toBe('user.get')
        expect(subscription.permissions?.pub?.allow).toEqual([subscription.subject])
        expect(await subscription.handler({}, {} as never)).toBe('result')
    })

    it('rejects missing and extra handlers at runtime', () => {
        expect(() => createNatsSubscriptions('user', {} as never)).toThrow('bindings')
        expect(() => createNatsSubscriptions('user', { wrong: () => null } as never)).toThrow('bindings')
        expect(() => createNatsSubscriptions('user', { [getNatsSubjectPath(subjects => subjects.USER_SUBJECTS.GET_USER)]: undefined } as never)).toThrow('Missing')
    })
    it('rejects incomplete or substituted active groups', () => {
        const groups = Object.fromEntries(Object.entries(activeContractGroups).map(([name, contracts]) => [
            name,
            createNatsSubscriptions(name as keyof typeof activeContractGroups, Object.fromEntries(contracts.map(contract => [contract.id, () => null])) as never),
        ])) as Parameters<typeof composeApiSubscriptions>[0]
        expect(composeApiSubscriptions(groups)).toHaveLength(53)
        expect(() => composeApiSubscriptions({} as never)).toThrow('groups')
        expect(() => composeApiSubscriptions({
            ...groups,
            user: [],
        })).toThrow('Incomplete')
        expect(() => composeApiSubscriptions({
            ...groups,
            user: groups['organization-membership'],
        })).toThrow('Mismatched')
    })
})
