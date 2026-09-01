import { access } from 'node:fs/promises'
import {
    describe,
    it,
    expect,
    beforeEach,
    vi,
} from 'vitest'

import {
    runProcess,
    withTempDir,
} from './transcoders/run-process.ts'

describe('runProcess', () => {
    it('resolves when process exits successfully', async () => {
        await expect(runProcess('node', ['-e', 'process.exit(0)'])).resolves.toBeUndefined()
    })

    it('rejects when process exits non-zero', async () => {
        await expect(runProcess('node', ['-e', 'process.exit(3)']))
            .rejects.toThrow('node exited with code 3')
    })

    it('rejects when a process exceeds timeout', async () => {
        await expect(runProcess('node', ['-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 25 }))
            .rejects.toThrow('node timed out after 25ms')
    })
})

describe('withTempDir', () => {
    beforeEach(() => {
        vi.useRealTimers()
    })

    it('creates a temporary directory, passes it into a function, and always removes it', async () => {
        let innerDir: string | null = null

        const result = await withTempDir('unit-', async (dir) => {
            innerDir = dir
            await access(dir)
            return 'done'
        })

        expect(result).toBe('done')
        expect(innerDir).toBeTruthy()
        await expect(access(innerDir as string)).rejects.toThrow()
    })

    it('removes the directory even when the callback throws', async () => {
        let innerDir: string | null = null
        await expect(withTempDir('unit-', async (dir) => {
            innerDir = dir
            await access(dir)
            throw new Error('extract failed')
        })).rejects.toThrow('extract failed')

        await expect(access(innerDir as string)).rejects.toThrow()
    })
})
