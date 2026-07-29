'use strict'

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Spawn a CLI tool (ffmpeg, soffice, pdftoppm, …) and resolve when it exits 0.
// stdio is fully ignored — transcoders communicate via temp files, never stdin/
// stdout — and a hard timeout kills runaway conversions so a conversion request
// can never hang indefinitely.
export const runProcess = async (
    command: string,
    args: string[],
    { timeoutMs = 120000 }: { timeoutMs?: number } = {},
): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'ignore'] })
        const timer = setTimeout(() => {
            child.kill('SIGKILL')
            reject(new Error(`${command} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
        child.on('error', (e) => {
            clearTimeout(timer)
            reject(e)
        })
        child.on('close', (code) => {
            clearTimeout(timer)
            if (code === 0) resolve()
            else reject(new Error(`${command} exited with code ${code}`))
        })
    })
}

// Run `fn` inside a freshly created temp dir, always cleaning it up afterwards.
// Transcoders need a seekable on-disk input (ffmpeg/soffice/pdftoppm all read
// files, not pipes), so this is the shared scaffolding around that.
export const withTempDir = async <T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> => {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    try {
        return await fn(dir)
    } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
}
