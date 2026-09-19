import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NatsDeploymentAdapter } from './adapter.ts'

const directories: string[] = []
const fixture = async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nats-adapter-'))
    directories.push(directory)
    const secrets = { send: vi.fn().mockResolvedValue({ SecretString: JSON.stringify({
        certificate: 'certificate-one',
        private_key: 'key-one',
    }) }) }
    const metrics = { send: vi.fn().mockResolvedValue({}) }
    const storage = { send: vi.fn().mockResolvedValue({}) }
    const request = vi.fn().mockImplementation(async (url: string) => new Response(url.endsWith('/api/token') ? 'token' : url.endsWith('local-ipv4') ? '192.0.2.4' : 'zone-a'))
    const upload = vi.fn().mockResolvedValue(undefined)
    const adapter = new NatsDeploymentAdapter({
        directory,
        cluster: 'test',
        certificateSecret: 'certificate',
        bucket: 'backup',
        admissionToken: 'synthetic',
    }, secrets as any, metrics as any, storage as any, request, upload)

    return {
        directory,
        adapter,
        secrets,
        metrics,
        storage,
        request,
        upload,
    }
}

afterEach(async () => void (await Promise.all(directories.splice(0).map(directory => rm(directory, {
    recursive: true,
    force: true,
})))))

describe('AWS deployment outside the native broker', () => {
    it('delivers portable node settings and a complete certificate pair as files', async () => {
        const {
            directory,
            adapter,
            request,
        } = await fixture()
        await adapter.prepare()
        expect(JSON.parse(await readFile(join(directory, 'node.json'), 'utf8'))).toEqual({
            zone: 'zone-a',
            advertiseIP: '192.0.2.4',
        })
        expect(await readFile(join(directory, 'current/certificate.pem'), 'utf8')).toBe('certificate-one')
        expect(await readFile(join(directory, 'current/private-key.pem'), 'utf8')).toBe('key-one')
        expect(request.mock.calls[1][1].headers).toEqual({ 'X-aws-ec2-metadata-token': 'token' })
    })

    it('preserves mounted files on source failure and replaces complete pairs together', async () => {
        const {
            directory,
            adapter,
            secrets,
        } = await fixture()
        await adapter.refreshCertificate()
        secrets.send.mockRejectedValueOnce(new Error('unavailable'))
        await expect(adapter.refreshCertificate()).rejects.toThrow('unavailable')
        expect(await readFile(join(directory, 'current/certificate.pem'), 'utf8')).toBe('certificate-one')
        secrets.send.mockResolvedValue({ SecretString: JSON.stringify({
            certificate: 'certificate-two',
            private_key: 'key-two',
        }) })
        await adapter.refreshCertificate()
        expect(await readFile(join(directory, 'current/certificate.pem'), 'utf8')).toBe('certificate-two')
        expect(await readFile(join(directory, 'current/private-key.pem'), 'utf8')).toBe('key-two')
        expect((await readdir(directory)).filter(name => name.startsWith('certificate-'))).toHaveLength(1)
    })

    it('rejects unavailable instance metadata before publishing node settings', async () => {
        const {
            directory,
            adapter,
            request,
        } = await fixture()
        request.mockResolvedValue(new Response('', { status: 500 }))
        await expect(adapter.prepare()).rejects.toThrow('metadata token')
        await expect(readFile(join(directory, 'node.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('publishes snapshot data before completion markers and reports success last', async () => {
        const {
            directory,
            adapter,
            storage,
            upload,
            metrics,
        } = await fixture()
        await mkdir(join(directory, 'snapshot/stream'), { recursive: true })
        await writeFile(join(directory, 'LATEST'), 'snapshot\n')
        await writeFile(join(directory, 'snapshot/COMPLETE'), 'snapshot\n')
        await writeFile(join(directory, 'snapshot/SHA256SUMS'), 'checksums')
        await writeFile(join(directory, 'snapshot/stream/stream.tar.s2'), 'native snapshot')
        await adapter.publishBackup()
        expect(upload.mock.calls.map(call => call[0])).toEqual(['jetstream/snapshot/SHA256SUMS', 'jetstream/snapshot/stream/stream.tar.s2'])
        expect(storage.send.mock.calls.map(call => call[0].input.Key)).toEqual(['jetstream/snapshot/COMPLETE', 'jetstream/LATEST'])
        expect(Math.max(...upload.mock.invocationCallOrder)).toBeLessThan(storage.send.mock.invocationCallOrder[0])
        expect(metrics.send.mock.invocationCallOrder[0]).toBeGreaterThan(storage.send.mock.invocationCallOrder[1])
        upload.mockRejectedValueOnce(new Error('transfer failed'))
        storage.send.mockClear()
        metrics.send.mockClear()
        await expect(adapter.publishBackup()).rejects.toThrow('transfer failed')
        expect(storage.send).not.toHaveBeenCalled()
        expect(metrics.send).not.toHaveBeenCalled()
    })

    it('rejects an incomplete snapshot without sending data', async () => {
        const {
            directory,
            adapter,
            storage,
            upload,
        } = await fixture()
        await mkdir(join(directory, 'snapshot'))
        await writeFile(join(directory, 'LATEST'), 'snapshot\n')
        await writeFile(join(directory, 'snapshot/COMPLETE'), 'different\n')
        await expect(adapter.publishBackup()).rejects.toThrow('incomplete')
        expect(upload).not.toHaveBeenCalled()
        expect(storage.send).not.toHaveBeenCalled()
    })

    it('reports delivery failure even if the broker still serves a valid certificate', async () => {
        const {
            adapter,
            request,
            metrics,
        } = await fixture()
        request.mockResolvedValue(Response.json({
            certificateRefreshHealthy: true,
            certificateValidBeyondSevenDays: true,
            serverName: 'broker-one',
        }))
        await adapter.reportCertificates(false)
        expect(metrics.send.mock.calls[0][0].input.MetricData.map((metric: any) => [metric.MetricName, metric.Value])).toEqual([
            ['CertificateRefreshHealthy', 0],
            ['CertificateRefreshHealthy', 0],
            ['CertificateValidBeyondSevenDays', 1],
            ['CertificateValidBeyondSevenDays', 1],
        ])
        expect(metrics.send.mock.calls[0][0].input.MetricData[1].Dimensions).toEqual([
            {
                Name: 'Cluster',
                Value: 'test',
            },
            {
                Name: 'Server',
                Value: 'broker-one',
            },
        ])
    })
})
