import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    canEditWorkspace,
    hasAccessLevel,
    higherAccessLevel,
    resolveEffectiveAccess,
} from './access.ts'

// =============================================================================
// EFFECTIVE ACCESS
// =============================================================================

describe('resolveEffectiveAccess', () => {
    const chain = {
        workspaceId: 'child',
        ancestorIds: [
            'root',
            'parent',
        ],
    }

    it('uses a direct grant', () => {
        expect(resolveEffectiveAccess({
            ...chain,
            grants: [{
                workspaceId: 'child',
                accessLevel: 'editor',
            }],
        })).toEqual({
            grantWorkspaceId: 'child',
            accessLevel: 'editor',
            ancestorIds: ['root', 'parent'],
        })
    })

    it('inherits a grant from any ancestor', () => {
        expect(resolveEffectiveAccess({
            ...chain,
            grants: [{
                workspaceId: 'root',
                accessLevel: 'viewer',
            }],
        })).toMatchObject({
            grantWorkspaceId: 'root',
            accessLevel: 'viewer',
        })
    })

    it('lets a child grant raise access but never lower it', () => {
        expect(resolveEffectiveAccess({
            ...chain,
            grants: [
                {
                    workspaceId: 'root',
                    accessLevel: 'viewer',
                },
                {
                    workspaceId: 'child',
                    accessLevel: 'owner',
                },
            ],
        })).toMatchObject({
            grantWorkspaceId: 'child',
            accessLevel: 'owner',
        })
        expect(resolveEffectiveAccess({
            ...chain,
            grants: [
                {
                    workspaceId: 'root',
                    accessLevel: 'owner',
                },
                {
                    workspaceId: 'child',
                    accessLevel: 'viewer',
                },
            ],
        })).toMatchObject({
            grantWorkspaceId: 'root',
            accessLevel: 'owner',
        })
    })

    it('prefers the nearest grant when two give the same level', () => {
        expect(resolveEffectiveAccess({
            ...chain,
            grants: [
                {
                    workspaceId: 'root',
                    accessLevel: 'editor',
                },
                {
                    workspaceId: 'parent',
                    accessLevel: 'editor',
                },
            ],
        })?.grantWorkspaceId).toBe('parent')
    })

    it('ignores grants outside the chain and returns nothing without a grant', () => {
        expect(resolveEffectiveAccess({
            ...chain,
            grants: [{
                workspaceId: 'sibling',
                accessLevel: 'owner',
            }],
        })).toBeUndefined()
        expect(resolveEffectiveAccess({
            ...chain,
            grants: [],
        })).toBeUndefined()
    })
})

// =============================================================================
// LEVEL RULES
// =============================================================================

describe('access level rules', () => {
    it('orders viewer, editor and owner', () => {
        expect(hasAccessLevel('owner', 'editor')).toBe(true)
        expect(hasAccessLevel('editor', 'editor')).toBe(true)
        expect(hasAccessLevel('viewer', 'editor')).toBe(false)
        expect(hasAccessLevel(undefined, 'viewer')).toBe(false)
        expect(canEditWorkspace('editor')).toBe(true)
        expect(canEditWorkspace('viewer')).toBe(false)
    })

    it('picks the higher of two levels', () => {
        expect(higherAccessLevel('viewer', 'owner')).toBe('owner')
        expect(higherAccessLevel('editor', undefined)).toBe('editor')
        expect(higherAccessLevel(undefined, undefined)).toBeUndefined()
    })
})
