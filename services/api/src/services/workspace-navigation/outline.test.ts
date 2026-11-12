import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    sectionLevel,
    wouldCreateCycle,
} from './outline.ts'

describe('wouldCreateCycle', () => {
    it('refuses a move under the workspace itself or a descendant', () => {
        expect(wouldCreateCycle({
            workspaceId: 'a',
            targetParentId: 'a',
            targetAncestorIds: [],
        })).toBe(true)
        expect(wouldCreateCycle({
            workspaceId: 'a',
            targetParentId: 'grandchild',
            targetAncestorIds: ['root', 'a', 'child'],
        })).toBe(true)
        expect(wouldCreateCycle({
            workspaceId: 'a',
            targetParentId: 'sibling',
            targetAncestorIds: ['root'],
        })).toBe(false)
        expect(wouldCreateCycle({
            workspaceId: 'a',
            targetParentId: undefined,
            targetAncestorIds: [],
        })).toBe(false)
    })
})

describe('sectionLevel', () => {
    it('groups at a heading level and not at a note', () => {
        expect(sectionLevel(0)).toBeUndefined()
        expect(sectionLevel(2)).toBe(2)
        expect(sectionLevel(undefined)).toBe(1)
    })
})
