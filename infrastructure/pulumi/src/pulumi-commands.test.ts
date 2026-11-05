import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    blockedReason,
    buildCatalog,
    describeFailure,
    describeTarget,
    PULUMI_COMMANDS,
} from './pulumi-commands.ts'

const command = (name: string) => PULUMI_COMMANDS.find(candidate => candidate.name === name)!

describe('pulumi commands', () => {
    beforeEach(() => {
        vi.stubEnv('PULUMI_PROGRAM', 'application')
        vi.stubEnv('PULUMI_REQUIRE_EXISTING_STACK', 'false')
    })

    afterEach(() => vi.unstubAllEnvs())

    it('offers every command with a unique name and an effect', () => {
        const names = PULUMI_COMMANDS.map(candidate => candidate.name)

        expect(new Set(names).size).toBe(names.length)
        expect(names).toEqual(expect.arrayContaining(['init', 'preview', 'up', 'refresh', 'destroy', 'outputs']))
    })

    it('marks a dry run as read and a deploy as a change', () => {
        expect(command('preview').effect).toBe('read')
        expect(command('up').effect).toBe('change')
        expect(command('destroy').effect).toBe('destroy')
    })

    it('allows any profile when the project restricts none', () => void expect(blockedReason(command('up'), { AWS_PROFILE: 'shelby.carter' })).toBeUndefined())

    it('refuses a change on a profile the project rejects, naming both', () => {
        const reason = blockedReason(command('up'), {
            AWS_PROFILE: 'development',
            PULUMI_ALLOWED_AWS_PROFILES: 'production',
        })

        expect(reason).toContain('production')
        expect(reason).toContain('development')
    })

    it('refuses a change when the configuration names no profile', () => void expect(blockedReason(command('up'), { PULUMI_ALLOWED_AWS_PROFILES: 'production' })).toContain('no profile'))

    it('accepts a change on an allowed profile', () => {
        expect(blockedReason(command('up'), {
            AWS_PROFILE: 'production',
            PULUMI_ALLOWED_AWS_PROFILES: 'production',
        })).toBeUndefined()
    })

    it('still allows read commands on a rejected profile', () => {
        expect(blockedReason(command('preview'), {
            AWS_PROFILE: 'development',
            PULUMI_ALLOWED_AWS_PROFILES: 'production',
        })).toBeUndefined()
    })

    it('limits local commands to a local environment', () => {
        expect(blockedReason(command('local-init'), { ENVIRONMENT: 'dev' })).toContain('local')
        expect(blockedReason(command('local-init'), { ENVIRONMENT: 'local' })).toBeUndefined()
    })

    it('refuses stack creation and removal for a project on an existing stack', () => {
        vi.stubEnv('PULUMI_REQUIRE_EXISTING_STACK', 'true')

        expect(blockedReason(command('create-stack'), {})).toContain('existing stack')
        expect(blockedReason(command('remove-stack'), {})).toContain('existing stack')
    })

    it('states the AWS account and profile a stack deploys to', () => {
        const target = describeTarget({
            AWS_EXPECTED_ACCOUNT_ID: '529088280712',
            AWS_PROFILE: 'production',
            STAGE: 'production',
        })

        expect(target.summary).toBe('stack production in AWS account 529088280712 (profile production)')
    })

    it('finds the account for a profile in the AWS config', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulumi-commands-'))
        const config = path.join(directory, 'config')

        fs.writeFileSync(config, '[profile other]\nsso_account_id = 111111111111\n\n[profile dev]\nsso_account_id = 222222222222\n')

        expect(describeTarget({ AWS_PROFILE: 'dev' }, config).summary).toContain('222222222222')

        fs.rmSync(directory, {
            recursive: true,
            force: true,
        })
    })

    it('says plainly when an application stack stays local', () => {
        expect(describeTarget({
            ENVIRONMENT: 'local',
            AWS_PROFILE: 'dev',
        }).summary).toContain('nothing in AWS')
    })

    it('never exposes secrets in the target', () => {
        const text = JSON.stringify(buildCatalog({
            AWS_PROFILE: 'dev',
            PULUMI_CONFIG_PASSPHRASE: 'do-not-show',
        }))

        expect(text).not.toContain('do-not-show')
    })

    it('leaves out commands that cannot apply to a static website', () => {
        vi.stubEnv('PULUMI_PROGRAM', 'static-website')

        const names = buildCatalog({}).commands.map(candidate => candidate.name)

        expect(names).toContain('up')
        expect(names).not.toContain('clean-ecr')
        expect(names).not.toContain('local-init')
    })

    it('reports an expired AWS session instead of the bare exit code', () => {
        const error = new Error('code: -2\n stdout: \n stderr: error: read ".pulumi/meta.yaml": get credentials: failed to refresh cached credentials, refresh cached SSO token failed for profile production')

        expect(describeFailure(error)).toBe('The AWS session has expired or is missing.')
    })

    it('shows the real cause of another failure, without identities', () => {
        const error = new Error('code: 255\n stdout: \n stderr: Command failed\nerror: no stack named dev in s3://private-bucket for account 529088280712')

        expect(describeFailure(error)).toBe('no stack named dev in <state backend> for account <account>')
    })

    it('never answers with only an exit code', () => {
        expect(describeFailure(new Error('code: -2\nsomething else broke'))).toBe('something else broke')
        expect(describeFailure(new Error('code: -2'))).toBe('The command failed.')
    })

    it('reports blocked commands with their reason in the catalog', () => {
        const up = buildCatalog({
            AWS_PROFILE: 'development',
            PULUMI_ALLOWED_AWS_PROFILES: 'production',
        }).commands.find(candidate => candidate.name === 'up')

        expect(up?.available).toBe(false)
        expect(up?.blockedReason).toContain('production')
    })
})
