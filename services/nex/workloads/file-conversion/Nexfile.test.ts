import { readFileSync } from 'node:fs'
import {
    describe,
    it,
    expect,
} from 'vitest'
import { withoutLayout } from '@lixpi/test-utils'

const source = readFileSync(new URL('./Nexfile', import.meta.url), 'utf-8')

const expectSourceToContain = (snippet: string, label: string): void => {
    expect(
        withoutLayout(source).includes(withoutLayout(snippet)),
        `${label} should be present in Nexfile
${snippet}`,
    ).toBe(true)
}

describe('Nexfile — file-conversion workload contract', () => {
    it('declares a native workload bound to index.ts with TypeScript entrypoint', () => {
        expectSourceToContain('name: file-conversion', 'workload name')
        expectSourceToContain('description: Heavy media transcoding (sharp/ffmpeg/libreoffice/poppler) off the API', 'description')
        expectSourceToContain('type: native', 'workload type')
        expectSourceToContain('lifecycle: service', 'lifecycle')
        expectSourceToContain('uri: "file:///usr/local/bin/node"', 'node runtime URI')
        expectSourceToContain('/usr/src/service/workloads/file-conversion/index.ts', 'service entrypoint')
    })

    it('does not include runtime secrets and documents startup env injection', () => {
        expectSourceToContain('environment: {}', 'runtime env injection map')
        expectSourceToContain('NATS_SERVERS, NATS_REGULAR_USER_PASSWORD, HOME, PATH', 'commented env contract')
    })
})
