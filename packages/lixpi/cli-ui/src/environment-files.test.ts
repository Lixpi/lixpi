import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest'
import { listEnvironmentFiles } from './environment-files.ts'

describe('environment files', () => {
    let directory: string

    beforeEach(() => void (directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-ui-'))))

    afterEach(() => {
        fs.rmSync(directory, {
            recursive: true,
            force: true,
        })
    })

    it('lists sorted .env.* files and skips other names', () => {
        for (const name of ['.env.bob-dev', '.env.alice-local', 'env.lixpi'])
            fs.writeFileSync(path.join(directory, name), '')

        expect(listEnvironmentFiles(directory)).toEqual(['.env.alice-local', '.env.bob-dev'])
    })

    it('skips directories and broken links', () => {
        fs.mkdirSync(path.join(directory, '.env.directory'))
        fs.symlinkSync('missing', path.join(directory, '.env.broken'))

        expect(listEnvironmentFiles(directory)).toEqual([])
    })
})
