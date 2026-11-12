import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    formatWorkspaceSubtreeOutline,
    type WorkspaceSubtreeEntry,
} from './subtree-outline.ts'

const entry = (
    name: string,
    depth: number,
    overrides: Partial<WorkspaceSubtreeEntry> = {},
): WorkspaceSubtreeEntry => ({
    entryType: 'workspace',
    id: name.toLowerCase(),
    name,
    depth,
    ...overrides,
})

describe('formatWorkspaceSubtreeOutline', () => {
    it('indents by depth and shows headings, ids and notes without content', () => {
        expect(formatWorkspaceSubtreeOutline([
            entry('Campaigns', 1, {
                entryType: 'heading',
                level: 2,
            }),
            entry('Storyboard', 1, { note: 'Spring launch' }),
            entry('Shots', 2),
            entry('Check the brief first', 1, {
                entryType: 'heading',
                level: 0,
            }),
        ])).toBe([
            '## Campaigns',
            '- Storyboard [workspace storyboard] (Spring launch)',
            '  - Shots [workspace shots]',
            'Check the brief first',
        ].join('\n'))
    })

    it('caps the outline and points to the listing tool for the rest', () => {
        const entries = Array.from({ length: 205 }, (_, index) => entry(`W${index}`, 1))
        const lines = formatWorkspaceSubtreeOutline(entries).split('\n')

        expect(lines).toHaveLength(201)
        expect(lines.at(-1)).toContain('5 more entries; call list_workspace_tree')
    })

    it('says so when there are no sub-workspaces', () => void expect(formatWorkspaceSubtreeOutline([])).toBe('This workspace has no sub-workspaces.'))
})
