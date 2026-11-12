import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const mocks = vi.hoisted(() => ({
    listAccessibleWorkspaces: vi.fn(),
    getUserOrganizations: vi.fn(),
}))

vi.mock('./workspace-tree.ts', () => ({
    workspaceAccessResolver: () => ({ listAccessibleWorkspaces: mocks.listAccessibleWorkspaces }),
}))

vi.mock('../models/organization.ts', () => ({
    default: { getUserOrganizations: mocks.getUserOrganizations },
}))

import { getAssetRequesterContext } from './asset-requester-context.ts'

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUserOrganizations.mockResolvedValue([{ organizationId: 'org-1' }])
})

describe('getAssetRequesterContext', () => {
    it('shares one read among concurrent requests and reads again once it settles', async () => {
        let release: () => void = () => undefined
        mocks.listAccessibleWorkspaces.mockImplementation(async () => {
            await new Promise<void>(resolve => void (release = resolve))

            return [{
                workspace: { workspaceId: 'workspace-1' },
                accessLevel: 'editor',
            }]
        })

        const first = getAssetRequesterContext('user-1')
        const second = getAssetRequesterContext('user-1')
        await vi.waitFor(() => expect(mocks.listAccessibleWorkspaces).toHaveBeenCalledTimes(1))
        release()
        const [left, right] = await Promise.all([first, second])

        expect(left).toEqual({
            userId: 'user-1',
            workspaceIds: ['workspace-1'],
            editableWorkspaceIds: ['workspace-1'],
            organizationIds: ['org-1'],
        })
        expect(right).toEqual(left)
        expect(right.workspaceIds).not.toBe(left.workspaceIds)

        mocks.listAccessibleWorkspaces.mockResolvedValueOnce([])
        expect((await getAssetRequesterContext('user-1')).workspaceIds).toEqual([])
        expect(mocks.listAccessibleWorkspaces).toHaveBeenCalledTimes(2)
    })
})
