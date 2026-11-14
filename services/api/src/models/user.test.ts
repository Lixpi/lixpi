import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import User from './user.ts'

afterEach(() => vi.unstubAllGlobals())

describe('user account preferences storage', () => {
    it('writes independent conditional attributes and reads them as preferences', async () => {
        const row: Record<string, unknown> = {
            userId: 'user-1',
            name: 'Alex',
        }
        const updateItem = vi.fn(async ({ updates }: { updates: Record<string, unknown> }) => {
            for (const [key, value] of Object.entries(updates))
                row[key] = value
        })
        const getItem = vi.fn(async () => ({ ...row }))
        vi.stubGlobal('dynamoDBService', {
            getItem,
            updateItem,
        })
        const agent = {
            contextMode: 'mixed' as const,
            midRunPolicy: 'queue' as const,
        }

        await Promise.all([
            User.updatePreferences('user-1', { appearance: 'system' }),
            User.updatePreferences('user-1', { agent }),
        ])

        expect(updateItem).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                key: { userId: 'user-1' },
                conditionExpression: 'attribute_exists(userId)',
                updates: { appearancePreference: 'system' },
            }),
        )
        expect(updateItem).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                key: { userId: 'user-1' },
                conditionExpression: 'attribute_exists(userId)',
                updates: { agentPreferences: agent },
            }),
        )
        await expect(User.get('user-1')).resolves.toEqual({
            userId: 'user-1',
            name: 'Alex',
            preferences: {
                appearance: 'system',
                agent,
            },
        })
        expect(getItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { userId: 'user-1' },
            consistentRead: true,
        }))
    })
})
