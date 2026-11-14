import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { createFilesystemMiddleware } from 'deepagents'
import { AgentScopedBackend } from './agent-harness.ts'

const skillPath = '/skills/global.media-pipeline-planning/media-pipeline-planning/SKILL.md'
const createBackend = (lineCount = 750) => {
    const content = Array.from(
        { length: lineCount },
        (_, index) => `Instruction ${index + 1}.`,
    ).join('\n')
    const read = vi.fn(async () => ({
        path: skillPath,
        content,
        revision: 1,
        updatedAt: '2026-11-14T08:00:00Z',
    }))
    const assertCurrent = vi.fn(async () => {})
    const backend = new AgentScopedBackend({
        list: async () => [],
        read,
        write: vi.fn(),
        assertCurrent,
    })

    return {
        backend,
        read,
        assertCurrent,
    }
}

describe('bounded native filesystem reads', () => {
    it.each([800, 1000])('accepts a %i-line request and returns a bounded, resumable page', async limit => {
        const { backend } = createBackend()
        const first = await backend.read(skillPath, 0, limit)
        expect(first).toMatchObject({
            startLine: 1,
            endLine: 500,
            totalLines: 750,
            nextOffset: 500,
        })
        expect(first.content?.split('\n')).toHaveLength(500)
        const last = await backend.read(skillPath, first.nextOffset, limit)
        expect(last).toMatchObject({
            startLine: 501,
            endLine: 750,
            totalLines: 750,
        })
        expect(last.content?.split('\n')[0]).toBe('Instruction 501.')
        expect(last.nextOffset).toBeUndefined()
    })

    it('lets the installed native read_file tool read a Skill with an oversized limit', async () => {
        const { backend } = createBackend()
        const middleware = createFilesystemMiddleware({
            backend,
            tools: ['read_file'],
            toolTokenLimitBeforeEvict: null,
            permissions: [
                {
                    operations: ['read'],
                    paths: ['/skills/**'],
                    mode: 'allow',
                },
                {
                    operations: ['read', 'write'],
                    paths: ['/**'],
                    mode: 'deny',
                },
            ],
        })
        const readFile = middleware.tools?.find(tool => tool.name === 'read_file')

        if (
            !readFile
            || !('invoke' in readFile)
        )
            throw new Error('Native filesystem middleware must expose read_file')

        const result = await readFile.invoke({
            type: 'tool_call',
            id: 'read-large-skill',
            name: 'read_file',
            args: {
                file_path: skillPath,
                offset: 0,
                limit: 1000,
            },
        })
        const text = JSON.stringify(result)
        expect(text).toContain('Instruction 500.')
        expect(text).not.toContain('Instruction 501.')
        expect(text).toContain('next offset 500')
        expect(text).not.toContain('pagination is invalid')
    })

    it.each([
        [-1, 100],
        [0, 0],
        [0, -1],
        [0, Number.POSITIVE_INFINITY],
        [0, 1.5],
    ])('rejects invalid pagination (%s, %s) before reading a file', async (offset, limit) => {
        const {
            backend,
            read,
        } = createBackend()
        expect(await backend.read(skillPath, offset, limit)).toHaveProperty('error')
        expect(read).not.toHaveBeenCalled()
    })

    it('preserves path and continuation checks when the requested window exceeds the cap', async () => {
        const {
            backend,
            read,
            assertCurrent,
        } = createBackend()
        expect(await backend.read('/skills/../private/SKILL.md', 0, 1000)).toHaveProperty('error')
        expect(read).not.toHaveBeenCalled()
        assertCurrent.mockRejectedValueOnce(new Error('AGENT_CONTINUATION_REVOKED'))
        await expect(backend.read(skillPath, 0, 1000)).rejects.toThrow('AGENT_CONTINUATION_REVOKED')
        expect(read).not.toHaveBeenCalled()
    })
})
