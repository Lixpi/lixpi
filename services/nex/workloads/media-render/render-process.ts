import { spawn } from 'node:child_process'

export type RenderProcessOptions = {
    cwd?: string
    signal?: AbortSignal
    timeoutMs: number
    onOutput?: (chunk: string) => void
    maxOutputBytes?: number
    maxFileBytes?: number
    captureOutput?: boolean
    onBytes?: (chunk: Buffer) => void
}

export class RenderProcess {
    async run(
        command: 'ffmpeg' | 'ffprobe',
        args: string[],
        options: RenderProcessOptions,
    ): Promise<string> {
        options.signal?.throwIfAborted()

        return await new Promise((resolve, reject) => {
            const restrictions = ['--as=2147483648', `--cpu=${Math.ceil(options.timeoutMs / 1000) + 1}`]

            if (options.maxFileBytes)
                restrictions.push(`--fsize=${options.maxFileBytes}`)

            const child = spawn(
                'prlimit',
                [...restrictions, '--', command, ...args],
                {
                    cwd: options.cwd,
                    detached: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                },
            )
            let stdout = ''
            let stderr = ''
            let failure: Error | undefined
            const kill = (error: Error): void => {
                failure ??= error

                if (!child.pid)
                    return

                try {
                    process.kill(-child.pid, 'SIGKILL')
                } catch {
                    child.kill('SIGKILL')
                }
            }
            const abort = (): void => void kill(
                new Error('MEDIA_RENDER_CANCELLED'),
            )
            const timeout = setTimeout(
                () => kill(
                    new Error('MEDIA_RENDER_TIMEOUT'),
                ),
                options.timeoutMs,
            )
            options.signal?.addEventListener(
                'abort',
                abort,
                { once: true },
            )

            if (options.signal?.aborted)
                abort()

            child.stdout.on('data', (buffer: Buffer) => {
                const text = buffer.toString('utf8')

                try {
                    options.onBytes?.(buffer)
                    options.onOutput?.(text)
                } catch {
                    kill(
                        new Error('MEDIA_RENDER_PROGRESS_FAILED'),
                    )
                }

                if (options.captureOutput !== false)
                    stdout += text

                if (Buffer.byteLength(stdout) > (options.maxOutputBytes ?? 2 * 1024 * 1024))
                    kill(
                        new Error('MEDIA_RENDER_PROCESS_OUTPUT_LIMIT'),
                    )
            })
            child.stderr.on('data', (buffer: Buffer) => void (stderr = (stderr + buffer.toString('utf8')).slice(-8192)))
            child.on('error', error => void (failure = error))
            child.on('close', code => {
                clearTimeout(timeout)
                options.signal?.removeEventListener('abort', abort)

                if (failure)
                    reject(failure)
                else if (code !== 0)
                    reject(
                        new Error(`MEDIA_RENDER_PROCESS_FAILED: ${stderr}`),
                    )
                else
                    resolve(stdout)
            })
        })
    }
}
