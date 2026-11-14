import { getNatsSubjectPath } from '@lixpi/constants'
import {
    describe,
    expect,
    it,
} from 'vitest'
import { createNatsSubscriptions, composeApiSubscriptions } from './create-nats-subscriptions.ts'
import { activeContractGroups } from '@lixpi/nats-subject-registry'

const userReadId = getNatsSubjectPath(subjects => subjects.USER_SUBJECTS.GET_USER)
const preferenceUpdateId = getNatsSubjectPath(subjects => subjects.USER_SUBJECTS.UPDATE_PREFERENCES)

describe('contract handler bindings', () => {
    it('binds behavior without accepting permission overrides', async () => {
        const [subscription, preferenceUpdate] = createNatsSubscriptions(
            'user',
            {
                [userReadId]: async () => 'result',
                [preferenceUpdateId]: async () => ({}),
            },
        )
        expect(preferenceUpdate.queue).toBe('userPreferenceWrites')
        expect(subscription.subject).toBe('user.get')
        expect(subscription.permissions?.pub?.allow).toEqual([subscription.subject])
        expect(await subscription.handler({}, {} as never)).toBe('result')
    })

    it('forwards the navigation write queue to the runtime subscription', () => {
        const handlers = Object.fromEntries(activeContractGroups.workspace.map(contract => [contract.id, () => null]))
        const subscriptions = createNatsSubscriptions('workspace', handlers as never)
        const id = getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.SAVE_WORKSPACE_NAVIGATION)
        const contract = activeContractGroups.workspace.find(entry => entry.id === id)!
        expect(subscriptions.find(subscription => subscription.subject === contract.subject)?.queue).toBe('workspaceNavigationWrites')
    })

    it('rejects missing and extra handlers at runtime', () => {
        expect(() => createNatsSubscriptions('user', {} as never)).toThrow('bindings')
        expect(() => createNatsSubscriptions('user', { wrong: () => null } as never)).toThrow('bindings')
        expect(() => createNatsSubscriptions(
            'user',
            {
                [userReadId]: undefined,
                [preferenceUpdateId]: () => null,
            } as never,
        )).toThrow('Missing')
    })
    it('rejects incomplete or substituted active groups', () => {
        const groups = Object.fromEntries(Object.entries(activeContractGroups).map(([name, contracts]) => [
            name,
            createNatsSubscriptions(name as keyof typeof activeContractGroups, Object.fromEntries(contracts.map(contract => [contract.id, () => null])) as never),
        ])) as Parameters<typeof composeApiSubscriptions>[0]
        expect(composeApiSubscriptions(groups)).toHaveLength(Object.values(activeContractGroups).flat().length)
        expect(() => composeApiSubscriptions({} as never)).toThrow('groups')
        expect(() => composeApiSubscriptions({
            ...groups,
            user: [],
        })).toThrow('Incomplete')
        expect(() => composeApiSubscriptions({
            ...groups,
            user: [groups.user[0]!, ...groups['organization-membership']],
        })).toThrow('Mismatched')
    })
})
