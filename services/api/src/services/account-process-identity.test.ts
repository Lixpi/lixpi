import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { AccountProcessIdentity } from './account-process-identity.ts'

describe('account admission deployment identity', () => {
    it('exposes the complete marker to Linux process inspection', () => {
        const consumer = `admission_api_${'c'.repeat(32)}`
        const source = `
            import { readFileSync } from 'node:fs';
            import { AccountProcessIdentity } from ${JSON.stringify(new URL('./account-process-identity.ts', import.meta.url).href)};
            const identity = await new AccountProcessIdentity({ ENVIRONMENT: 'local' }).read(${JSON.stringify(consumer)});
            process.stdout.write(JSON.stringify({ identity, command: readFileSync('/proc/self/cmdline', 'utf8').replace(/\\0+$/, '') }));
        `
        const child = spawnSync(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', source], {
            encoding: 'utf8',
            timeout: 5000,
        })
        expect(child.status, child.stderr).toBe(0)
        expect(JSON.parse(child.stdout)).toMatchObject({
            identity: { process: consumer },
            command: consumer,
        })
    })

    it('publishes the exact process marker only after the runtime accepts it', async () => {
        const runtime = { title: 'node' }
        const consumer = `admission_api_${'a'.repeat(32)}`
        const identity = new AccountProcessIdentity({ ENVIRONMENT: 'local' }, () => 'b'.repeat(12), fetch, runtime)
        expect(await identity.read(consumer)).toEqual({
            kind: 'compose',
            container: 'b'.repeat(12),
            task: '',
            process: consumer,
        })
        expect(runtime.title).toBe(consumer)
        await expect(identity.read('invalid')).rejects.toThrow('process name')
        const truncated = {
            get title() { return 'truncated' },
            set title(_value: string) {},
        }
        await expect(new AccountProcessIdentity({ ENVIRONMENT: 'local' }, () => 'b'.repeat(12), fetch, truncated).read(consumer)).rejects.toThrow('truncated')
    })

    it('uses a Docker container identity only in the local environment', async () => {
        const host = () => 'a'.repeat(12)
        expect(await new AccountProcessIdentity({ ENVIRONMENT: 'local' }, host).read()).toEqual({
            kind: 'compose',
            container: host(),
            task: '',
        })

        for (const environment of [{}, { ENVIRONMENT: 'dev' }, { ENVIRONMENT: 'production' }])
            await expect(new AccountProcessIdentity(environment, host).read()).rejects.toThrow('requires local Docker')

        await expect(new AccountProcessIdentity({ ENVIRONMENT: 'local' }, () => 'friendly-name').read()).rejects.toThrow()
    })

    it('binds an ECS runtime container to exactly one task member', async () => {
        const container = `${'a'.repeat(32)  }-123456`
        const task = `arn:aws:ecs:us-east-1:123456789012:task/cluster/${'b'.repeat(32)}`
        const request = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ DockerId: container }))
            .mockResolvedValueOnce(Response.json({
                TaskARN: task,
                Containers: [{ DockerId: container }],
            }))
        const identity = new AccountProcessIdentity({ ECS_CONTAINER_METADATA_URI_V4: 'http://169.254.170.2/v4/test-id' }, () => 'ignored', request)
        expect(await identity.read()).toEqual({
            kind: 'ecs',
            container,
            task,
        })
        expect(request.mock.calls.every(([, options]) => options?.redirect === 'error' && options.signal instanceof AbortSignal)).toBe(true)
        request.mockResolvedValueOnce(Response.json({ DockerId: container })).mockResolvedValueOnce(Response.json({
            TaskARN: task,
            Containers: [],
        }))
        await expect(identity.read()).rejects.toThrow('Incomplete ECS')
    })

    it('rejects arbitrary metadata destinations and never falls back after an ECS failure', async () => {
        const request = vi.fn<typeof fetch>()

        for (const url of ['https://attacker.example/v4/x', 'http://169.254.170.2/v4/x?query=y', 'http://user:secret@169.254.170.2/v4/x', 'http://169.254.170.2/credentials'])
            await expect(new AccountProcessIdentity({
                ECS_CONTAINER_METADATA_URI_V4: url,
                ENVIRONMENT: 'local',
            }, () => 'a'.repeat(12), request).read()).rejects.toThrow()

        expect(request).not.toHaveBeenCalled()
        request.mockResolvedValue(new Response('unavailable', { status: 503 }))
        await expect(new AccountProcessIdentity({
            ECS_CONTAINER_METADATA_URI_V4: 'http://169.254.170.2/v4/x',
            ENVIRONMENT: 'local',
        }, () => 'a'.repeat(12), request).read()).rejects.toThrow('unavailable')
    })

    it('bounds metadata bodies', async () => {
        const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(128 * 1024 + 1)))
        await expect(new AccountProcessIdentity({ ECS_CONTAINER_METADATA_URI_V4: 'http://169.254.170.2/v4/x' }, () => '', request).read()).rejects.toThrow('exceeds its limit')
    })
})
