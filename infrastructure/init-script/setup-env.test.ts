import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { parseEnv } from 'node:util'
import * as prompts from '@clack/prompts'
import * as nkeys from '@nats-io/nkeys'
import { registrationEnvironment } from '@lixpi/nats-subject-registry/registration'
import { EnvFileUpdates, runInteractivePrompts, writeFiles } from './setup-env.ts'

vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof fs>() }))
vi.mock('@lixpi/nats-subject-registry/registration', () => ({ registrationEnvironment: vi.fn(() => ({})) }))
vi.mock('@nats-io/nkeys', async importOriginal => ({ ...await importOriginal<typeof nkeys>() }))
vi.mock('@clack/prompts', () => ({
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    text: vi.fn(),
    password: vi.fn(),
    select: vi.fn(),
    confirm: vi.fn(),
    isCancel: (value: unknown) => typeof value === 'symbol',
    log: {
        info: vi.fn(),
        step: vi.fn(),
        success: vi.fn(),
        warn: vi.fn(),
    },
}))

describe('partial environment updates', () => {
    it('keeps comments, custom values, empty values, interpolation and credentials byte for byte', () => {
        const source = '# config\r\nexport CUSTOM = "${OTHER}#literal" # comment\r\nEMPTY=\r\nSEED=SU_EXISTING\r\nMULTILINE="first\r\nsecond"\r\n'
        expect(new EnvFileUpdates(source).render()).toBe(source)
    })

    it('changes only the selected value, preserving comments and CRLF', () => {
        const updates = new EnvFileUpdates('# config\r\nexport CUSTOM = old  # keep\r\nSECRET="unchanged"\r\n')
        updates.setValue('CUSTOM', '"new # literal"')
        expect(updates.render()).toBe('# config\r\nexport CUSTOM = "new # literal"  # keep\r\nSECRET="unchanged"\r\n')
    })

    it('can explicitly clear a value and append an absent setting', () => {
        const updates = new EnvFileUpdates('API_KEY=old')
        updates.setValue('API_KEY', '""')
        updates.setValue('NEW_VALUE', "'${LITERAL}'")
        expect(updates.render()).toBe('API_KEY=""\nNEW_VALUE=\'${LITERAL}\'\n')
    })

    it('replaces an unquoted hash as part of the value but keeps a spaced inline comment', () => {
        const updates = new EnvFileUpdates('PASSWORD=old#literal # comment\n')
        expect(updates.getValues().get('PASSWORD')).toBe('old#literal')
        updates.setValue('PASSWORD', 'new#literal')
        expect(updates.render()).toBe('PASSWORD=new#literal # comment\n')
    })

    it('keeps a comment separate when overriding an empty assignment', () => {
        const updates = new EnvFileUpdates('VALUE= # comment\n')
        updates.setValue('VALUE', 'new')
        expect(updates.render()).toBe('VALUE= new # comment\n')
    })

    it('replaces every duplicate assignment without changing other values', () => {
        const updates = new EnvFileUpdates('VALUE=first\nOTHER=keep\nVALUE=last\n')
        expect(updates.getValues().get('VALUE')).toBe('last')
        updates.setValue('VALUE', 'updated')
        expect(updates.render()).toBe('VALUE=updated\nOTHER=keep\nVALUE=updated\n')
    })

    it('replaces multiline values without interpreting embedded assignment text', () => {
        const updates = new EnvFileUpdates('CERT="first\nFAKE=value\nlast" # keep\nREAL=original\n')
        expect([...updates.getValues().keys()]).toEqual(['CERT', 'REAL'])
        updates.setValue('CERT', '"replacement"')
        expect(updates.render()).toBe('CERT="replacement" # keep\nREAL=original\n')
    })

    it.each(['"unterminated', "'unterminated", '"quoted" trailing', 'first\nOTHER=injected'])('rejects an invalid replacement: %s', literal => {
        const updates = new EnvFileUpdates('VALUE=original\n')
        expect(() => updates.setValue('VALUE', literal)).toThrow()
        expect(updates.render()).toBe('VALUE=original\n')
    })
})


describe('shared grouped wizard', () => {
    const envPath = '/workspace/.env.test-local'
    const awsPath = '/workspace/.aws/config'
    const fixture = [
        '# untouched comment',
        'STAGE=Test-local',
        'ENVIRONMENT=local',
        'ORG_NAME=Existing',
        'DOMAIN_NAME=',
        'CERTIFICATE_VALIDATION_EMAIL=',
        'STATE_STORAGE_URL=file:///var/opt/lixpi/.pulumi-local-state',
        'PULUMI_CONFIG_PASSPHRASE=""',
        'DYNAMODB_ENDPOINT=http://lixpi-dynamodb:8000',
        'MOCK_AUTH0=true',
        'VITE_MOCK_AUTH=true',
        'AUTH0_DOMAIN=""',
        'VITE_AUTH0_CLIENT_ID=""',
        'AUTH0_API_IDENTIFIER=http://localhost:3005',
        'HOSTED_ZONE_DNS_ROLE_ARN=""',
        'HOSTED_ZONE_NAME=',
        'AWS_ROUTE53_HOSTED_ZONE_ID="" # create a zone',
        'AWS_ROUTE53_PARENT_HOSTED_ZONE_ID=',
        'AWS_REGION=us-east-1',
        'AWS_PROFILE=test-dev',
        'CLOUDWATCH_LOG_RETENTION_DAYS=7',
        'CLOUDWATCH_CONTAINER_INSIGHTS_ENABLED=false',
        'NATS_AUTH_NKEY_ISSUER_SEED=SAexisting',
        'NATS_AUTH_NKEY_ISSUER_PUBLIC=Aexisting',
        'NATS_AUTH_XKEY_ISSUER_SEED=SXexisting',
        'NATS_AUTH_XKEY_ISSUER_PUBLIC=Xexisting',
        'NATS_LLM_SERVICE_NKEY_SEED=SUllm',
        'NATS_LLM_SERVICE_NKEY_PUBLIC=Ullm',
        'NATS_NEX_NODE_NKEY_SEED=SUnex',
        'NATS_NEX_NODE_NKEY_PUBLIC=Unex',
        'NATS_SYS_USER_PASSWORD=keep-system-password',
        'NATS_CALLOUT_PASSWORD=keep-callout-password',
        ...['API', 'FILE_CONVERSION', 'CHARACTER_FIDELITY', 'BACKUP', 'OPERATOR'].flatMap(name => [
            `NATS_${name}_NKEY_SEED=SU${name}`,
            `NATS_${name}_NKEY_PUBLIC=U${name}`,
        ]),
        'OPENAI_API_KEY=keep-openai',
        'ANTHROPIC_USE_AWS_BEDROCK_INFERENCE=true',
        'ANTHROPIC_API_KEY=""',
        'GOOGLE_API_KEY=keep-google',
        'GOOGLE_VEO_PERSON_GENERATION_PROFILE=standard',
        'STABILITY_USE_AWS_BEDROCK_INFERENCE=true',
        'STABLE_DIFFUSION_API_KEY=""',
        'ARK_API_KEY=keep-ark',
        'CUSTOM_PRIVATE_VALUE="leave this alone"',
        '',
    ].join('\n')
    let original: string | undefined
    let awsOriginal: string | undefined
    let mode: 'new' | 'edit'
    let updateMode: 'partial' | 'overwrite'
    let selectedFile: string
    const groups = new Set<string>()
    const selects = new Map<string, unknown>()
    const confirms = new Map<string, boolean | symbol>()
    const texts = new Map<string, string | symbol>()
    let write: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(registrationEnvironment).mockReset().mockReturnValue({})
        groups.clear()
        selects.clear()
        confirms.clear()
        texts.clear()
        original = fixture
        awsOriginal = undefined
        mode = 'edit'
        updateMode = 'partial'
        selectedFile = '.env.test-local'
        const readFile = fs.readFileSync
        vi.spyOn(fs, 'readdirSync').mockReturnValue(['README.md', '.env.test-local', '.env.development', '.env.directory'] as never)
        vi.spyOn(fs, 'existsSync').mockImplementation(file => file === awsPath ? awsOriginal !== undefined : String(file).startsWith('/workspace/.env.') && original !== undefined)
        vi.spyOn(fs, 'statSync').mockImplementation(file => ({ isFile: () => file !== '/workspace/.env.directory' }) as fs.Stats)
        vi.spyOn(fs, 'readFileSync').mockImplementation((file, options) => {
            if (file === awsPath)
                return awsOriginal as never

            if (String(file).startsWith('/workspace/.env.'))
                return original as never

            return readFile(file, options)
        })
        write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
        vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
        vi.spyOn(nkeys, 'createAccount')
        vi.spyOn(nkeys, 'createCurve')
        vi.spyOn(nkeys, 'createUser')
        vi.mocked(prompts.select).mockImplementation(async options => {
            if (selects.has(options.message))
                return selects.get(options.message) as never

            if (options.message === 'Generate a new configuration or edit an existing one?')
                return mode

            if (options.message === 'Select a configuration to edit')
                return selectedFile

            if (options.message.startsWith('How do you want to update '))
                return updateMode

            return (options.options.find(option => option.value === 'keep')?.value ?? options.initialValue ?? options.options[0].value) as never
        })
        vi.mocked(prompts.confirm).mockImplementation(async options => {
            if (confirms.has(options.message))
                return confirms.get(options.message) as never

            if (options.message.startsWith('Edit '))
                return groups.has(options.message.slice(5, -1))

            return options.initialValue ?? false
        })
        vi.mocked(prompts.text).mockImplementation(async options => {
            if (texts.has(options.message))
                return texts.get(options.message) as never

            if (options.message.startsWith('Developer name'))
                return 'test'

            return options.defaultValue ?? ''
        })
    })

    afterEach(() => vi.restoreAllMocks())

    const collect = async () => {
        const config = await runInteractivePrompts()
        expect(config).not.toBeNull()

        return config!
    }
    const assertNoKeysGenerated = () => {
        expect(nkeys.createAccount).not.toHaveBeenCalled()
        expect(nkeys.createCurve).not.toHaveBeenCalled()
        expect(nkeys.createUser).not.toHaveBeenCalled()
    }

    describe('NATS registration during normal saves', () => {
        beforeEach(async () => {
            const actual = await vi.importActual<typeof import('@lixpi/nats-subject-registry/registration')>('@lixpi/nats-subject-registry/registration')
            vi.mocked(registrationEnvironment).mockImplementation(actual.registrationEnvironment)
            const updates = new EnvFileUpdates(fixture)

            for (const name of ['API', 'FILE_CONVERSION', 'CHARACTER_FIDELITY', 'BACKUP', 'OPERATOR', 'NEX_NODE']) {
                const key = nkeys.createUser()
                updates.setValue(`NATS_${name}_NKEY_SEED`, new TextDecoder().decode(key.getSeed()))
                updates.setValue(`NATS_${name}_NKEY_PUBLIC`, key.getPublicKey())
                key.clear()
            }

            updates.setValue('MOCK_AUTH0_DOMAIN', 'lixpi-localauth0:3000')
            updates.setValue('MOCK_AUTH0_JWKS_URI', 'http://lixpi-localauth0:3000/.well-known/jwks.json')
            original = updates.render()
            vi.mocked(nkeys.createUser).mockClear()
        })

        const savedContent = () => {
            expect(write).toHaveBeenCalledTimes(1)
            expect(write.mock.calls[0][0]).toBe(envPath)

            return String(write.mock.calls[0][1])
        }

        const readRegistration = (content: string) => {
            const env = parseEnv(content)
            const signed = JSON.parse(env.NATS_APPLICATION_REGISTRATION)
            const payload = Buffer.from(signed.payload, 'base64')
            const manifest = JSON.parse(payload.toString())
            const key = nkeys.fromSeed(new TextEncoder().encode(env.NATS_REGISTRATION_AUTHORITY_SEED))

            try {
                expect(signed.issuer).toBe(key.getPublicKey())
                expect(key.verify(payload, Buffer.from(signed.signature, 'base64'))).toBe(true)
                expect(JSON.parse(env.NATS_REGISTRATION_AUTHORITIES)).toEqual([{
                    publicKey: key.getPublicKey(),
                    owner: 'lixpi',
                    accounts: ['AUTH', 'NEX'],
                }])
            } finally {
                key.clear()
            }

            expect(env.NATS_REGISTRATION_PASSWORD).toMatch(/^[a-f0-9]{64}$/)
            expect(manifest.schema).toBe(1)
            expect(manifest.services.find(service => service.userId === 'svc:api').publicKey).toBe(env.NATS_API_NKEY_PUBLIC)

            return {
                env,
                manifest,
            }
        }

        const saveExistingRegistration = async () => {
            await writeFiles(await collect())
            original = savedContent()
            write.mockClear()

            return readRegistration(original)
        }

        it.each(['new', 'overwrite'] as const)('signs the application declaration when saving a %s configuration', async operation => {
            if (operation === 'new') {
                mode = 'new'
                original = undefined
            } else
                updateMode = 'overwrite'

            await writeFiles(await collect())
            const { manifest } = readRegistration(savedContent())
            expect(manifest.version).toBe(1)
            expect(manifest.browsers[0].issuer).toBe('http://localhost:3000/')
        })

        it('adds missing registration settings during a partial save with every group skipped', async () => {
            const before = original!
            await writeFiles(await collect())
            const content = savedContent()
            const { manifest } = readRegistration(content)
            expect(content.startsWith(before), 'existing assignments must remain byte for byte').toBe(true)
            expect(manifest.version).toBe(1)
            expect(prompts.text).not.toHaveBeenCalled()
            expect(nkeys.createUser).not.toHaveBeenCalled()
            expect(nkeys.createCurve).not.toHaveBeenCalled()
        })

        it('keeps an unchanged registration and avoids rewriting the file on a repeated partial save', async () => {
            await saveExistingRegistration()
            await writeFiles(await collect())
            expect(write).not.toHaveBeenCalled()
        })

        it('preserves registration and credentials when a partial update changes an unrelated setting', async () => {
            const before = await saveExistingRegistration()
            groups.add('General Configuration')
            selects.set('Organization name (used for Pulumi)', 'override')
            texts.set('Organization name (used for Pulumi)', 'Renamed')
            await writeFiles(await collect())
            const after = readRegistration(savedContent())
            expect(after.env.ORG_NAME).toBe('Renamed')
            expect(after.env.NATS_APPLICATION_REGISTRATION).toBe(before.env.NATS_APPLICATION_REGISTRATION)
            expect(after.env.NATS_REGISTRATION_AUTHORITY_SEED).toBe(before.env.NATS_REGISTRATION_AUTHORITY_SEED)
            expect(after.env.NATS_REGISTRATION_PASSWORD).toBe(before.env.NATS_REGISTRATION_PASSWORD)
        })

        it('signs a higher version with the replacement service key selected in the NATS group', async () => {
            const before = await saveExistingRegistration()
            groups.add('NATS Configuration')
            selects.set('NATS_API_NKEY_SEED', 'override')
            await writeFiles(await collect())
            const after = readRegistration(savedContent())
            expect(after.manifest.version).toBe(before.manifest.version + 1)
            expect(after.env.NATS_API_NKEY_PUBLIC).not.toBe(before.env.NATS_API_NKEY_PUBLIC)
            expect(after.env.NATS_BACKUP_NKEY_SEED).toBe(before.env.NATS_BACKUP_NKEY_SEED)
            expect(after.env.NATS_REGISTRATION_AUTHORITY_SEED).toBe(before.env.NATS_REGISTRATION_AUTHORITY_SEED)
            expect(after.env.NATS_REGISTRATION_PASSWORD).toBe(before.env.NATS_REGISTRATION_PASSWORD)
        })

        it('signs updated browser verification settings when only the authentication group changes', async () => {
            const before = await saveExistingRegistration()
            groups.add('Authentication Configuration')
            selects.set('Use LocalAuth0 mock (for local development)?', 'override')
            confirms.set('Use LocalAuth0 mock (for local development)?', false)
            const domainPrompt = 'Auth0 domain (e.g., https://your-tenant.us.auth0.com)'
            selects.set(domainPrompt, 'override')
            texts.set(domainPrompt, 'https://tenant.auth.test')
            await writeFiles(await collect())
            const after = readRegistration(savedContent())
            expect(after.manifest.version).toBe(before.manifest.version + 1)
            expect(after.manifest.browsers[0]).toMatchObject({
                issuer: 'https://tenant.auth.test/',
                jwksUrl: 'https://tenant.auth.test/.well-known/jwks.json',
                audience: before.env.AUTH0_API_IDENTIFIER,
            })
            expect(after.env.NATS_API_NKEY_SEED).toBe(before.env.NATS_API_NKEY_SEED)
            expect(after.env.NATS_REGISTRATION_AUTHORITY_SEED).toBe(before.env.NATS_REGISTRATION_AUTHORITY_SEED)
        })

        it('does not write a partial update when the existing registration cannot be verified', async () => {
            await saveExistingRegistration()
            const updates = new EnvFileUpdates(original!)
            const signed = JSON.parse(parseEnv(original!).NATS_APPLICATION_REGISTRATION)
            signed.signature = Buffer.alloc(64).toString('base64')
            updates.setValue('NATS_APPLICATION_REGISTRATION', `'${JSON.stringify(signed)}'`)
            original = updates.render()
            await expect(writeFiles(await collect())).rejects.toThrow('Existing registration does not match its authority')
            expect(write).not.toHaveBeenCalled()
        })
    })

    it('offers new or edit first and lists existing files before group questions', async () => {
        selects.set('Select a configuration to edit', Symbol('cancel'))
        expect(await runInteractivePrompts()).toBeNull()
        expect(vi.mocked(prompts.select).mock.calls[0][0].options).toEqual([
            {
                value: 'new',
                label: 'Generate new',
            },
            {
                value: 'edit',
                label: 'Edit existing',
            },
        ])
        expect(vi.mocked(prompts.select).mock.calls[1][0].options).toEqual([
            {
                value: '.env.development',
                label: '.env.development',
            },
            {
                value: '.env.test-local',
                label: '.env.test-local',
            },
        ])
        expect(prompts.confirm).not.toHaveBeenCalled()
        expect(prompts.text).not.toHaveBeenCalled()
        expect(write).not.toHaveBeenCalled()
    })

    it('reports no existing configurations without offering an empty picker', async () => {
        vi.spyOn(fs, 'readdirSync').mockReturnValue([])
        expect(await runInteractivePrompts()).toBeNull()
        expect(prompts.select).toHaveBeenCalledTimes(1)
    })

    it('skips every child prompt and preserves the complete file when no groups are selected', async () => {
        const config = await collect()
        await writeFiles(config)
        expect(prompts.select).toHaveBeenCalledTimes(3)
        expect(prompts.text).not.toHaveBeenCalled()
        expect(prompts.confirm).toHaveBeenCalledTimes(7)
        expect(vi.mocked(prompts.confirm).mock.calls.map(([options]) => options.message)).toEqual([
            'Edit General Configuration?',
            'Edit Database Configuration?',
            'Edit Authentication Configuration?',
            'Edit NATS Configuration?',
            'Edit AWS SSO Configuration?',
            'Edit AWS Deployment Configuration?',
            'Edit API Keys?',
        ])
        expect(write).not.toHaveBeenCalled()
        assertNoKeysGenerated()
    })

    it.each([
        ['AWS SSO Configuration', 'Configure AWS SSO profile?'],
        ['AWS Deployment Configuration', 'Configure AWS deployment settings?'],
    ])('does not enter the disabled %s subgroup', async (group, question) => {
        groups.add(group)
        confirms.set(question, false)
        await writeFiles(await collect())
        expect(prompts.select).toHaveBeenCalledTimes(3)
        expect(prompts.text).not.toHaveBeenCalled()
        expect(write).not.toHaveBeenCalled()
        assertNoKeysGenerated()
    })

    it('does not prompt for an endpoint when keeping local DynamoDB', async () => {
        groups.add('Database Configuration')
        await writeFiles(await collect())
        expect(prompts.select).toHaveBeenCalledWith(expect.objectContaining({ message: 'Use local DynamoDB (Docker)?' }))
        expect(prompts.select).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'DynamoDB endpoint URL' }))
        expect(prompts.text).not.toHaveBeenCalled()
        expect(write).not.toHaveBeenCalled()
    })

    it('uses the existing database branch when switching to a custom endpoint', async () => {
        groups.add('Database Configuration')
        selects.set('Use local DynamoDB (Docker)?', 'override')
        confirms.set('Use local DynamoDB (Docker)?', false)
        selects.set('DynamoDB endpoint URL', 'override')
        texts.set('DynamoDB endpoint URL', 'https://dynamodb.example.test')
        await writeFiles(await collect())
        expect(write).toHaveBeenCalledExactlyOnceWith(envPath, fixture.replace('http://lixpi-dynamodb:8000', 'https://dynamodb.example.test'))
        assertNoKeysGenerated()
    })

    it('does not show real Auth0 fields when retaining LocalAuth0', async () => {
        groups.add('Authentication Configuration')
        await writeFiles(await collect())
        expect(prompts.select).toHaveBeenCalledWith(expect.objectContaining({ message: 'Use LocalAuth0 mock (for local development)?' }))
        expect(prompts.select).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Auth0 domain') }))
        expect(prompts.text).not.toHaveBeenCalled()
        expect(write).not.toHaveBeenCalled()
    })

    it('opens the real Auth0 child prompts when mock authentication is disabled', async () => {
        groups.add('Authentication Configuration')
        selects.set('Use LocalAuth0 mock (for local development)?', 'override')
        confirms.set('Use LocalAuth0 mock (for local development)?', false)
        const domainPrompt = 'Auth0 domain (e.g., https://your-tenant.us.auth0.com)'
        selects.set(domainPrompt, 'override')
        texts.set(domainPrompt, 'https://tenant.auth.test')
        const config = await collect()
        const result = config.edits!.render(config)
        expect(result).toContain('MOCK_AUTH0=false')
        expect(result).toContain('AUTH0_DOMAIN=https://tenant.auth.test')
        expect(result).toContain('VITE_AUTH0_DOMAIN=tenant.auth.test')
        expect(prompts.select).toHaveBeenCalledWith(expect.objectContaining({ message: 'Auth0 Client ID' }))
        assertNoKeysGenerated()
    })

    it('does not ask for a parent zone when DNS delegation is not selected', async () => {
        groups.add('AWS Deployment Configuration')
        confirms.set('Configure AWS deployment settings?', true)
        confirms.set('Use parent hosted zone for DNS delegation?', false)
        await writeFiles(await collect())
        expect(prompts.select).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'Parent Hosted Zone ID' }))
        expect(prompts.text).not.toHaveBeenCalled()
        expect(write).not.toHaveBeenCalled()
    })

    it('does not ask for inactive provider credentials or Stripe with LocalAuth0', async () => {
        groups.add('API Keys')
        await writeFiles(await collect())

        for (const message of ['Anthropic API Key', 'Stable Diffusion API Key', 'Stripe Public Key'])
            expect(prompts.select).not.toHaveBeenCalledWith(expect.objectContaining({ message }))

        expect(prompts.text).not.toHaveBeenCalled()
        expect(write).not.toHaveBeenCalled()
    })

    it('only asks for a missing active field inside a selected group', async () => {
        original = fixture.replace('ORG_NAME=Existing\n', '')
        groups.add('General Configuration')
        texts.set('Organization name (used for Pulumi)', 'NewOrg')
        const config = await collect()
        expect(prompts.select).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Organization name (used for Pulumi)',
            options: [{
                value: 'override',
                label: 'Set new value',
            }],
        }))
        expect(prompts.text).toHaveBeenCalledTimes(1)
        expect(config.edits!.render(config)).toBe(`${original  }ORG_NAME=NewOrg\n`)
    })

    it('can keep an empty applicable field without exposing unrelated raw variables', async () => {
        groups.add('AWS Deployment Configuration')
        confirms.set('Configure AWS deployment settings?', true)
        await writeFiles(await collect())
        expect(prompts.select).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Hosted Zone DNS Role ARN (optional)',
            options: [{
                value: 'keep',
                label: 'Keep empty',
            }, {
                value: 'override',
                label: 'Override value',
            }],
        }))

        for (const message of ['PULUMI_CONFIG_PASSPHRASE', 'AWS_ROUTE53_HOSTED_ZONE_ID', 'CUSTOM_PRIVATE_VALUE'])
            expect(prompts.select).not.toHaveBeenCalledWith(expect.objectContaining({ message }))

        expect(write).not.toHaveBeenCalled()
    })

    it('preserves all NATS credentials when their group is selected but values are kept', async () => {
        groups.add('NATS Configuration')
        await writeFiles(await collect())
        assertNoKeysGenerated()
        expect(write).not.toHaveBeenCalled()
    })

    it('regenerates only the selected NATS key pair', async () => {
        groups.add('NATS Configuration')
        selects.set('NATS_AUTH_NKEY_ISSUER_SEED', 'override')
        const config = await collect()
        const rendered = new EnvFileUpdates(config.edits!.render(config)).getValues()
        expect(nkeys.createAccount).toHaveBeenCalledTimes(1)
        expect(nkeys.createCurve).not.toHaveBeenCalled()
        expect(nkeys.createUser).not.toHaveBeenCalled()
        const pair = nkeys.fromSeed(new TextEncoder().encode(rendered.get('NATS_AUTH_NKEY_ISSUER_SEED')))
        expect(pair.getPublicKey()).toBe(rendered.get('NATS_AUTH_NKEY_ISSUER_PUBLIC'))
        pair.clear()
        expect(rendered.get('NATS_SYS_USER_PASSWORD')).toBe('keep-system-password')
        expect(rendered.get('NATS_AUTH_XKEY_ISSUER_SEED')).toBe('SXexisting')
    })

    it('generates a missing public key from the existing seed without rotating the seed', async () => {
        const key = nkeys.createAccount()
        const seed = new TextDecoder().decode(key.getSeed())
        const publicKey = key.getPublicKey()
        key.clear()
        vi.mocked(nkeys.createAccount).mockClear()
        original = fixture.replace('SAexisting', seed).replace('NATS_AUTH_NKEY_ISSUER_PUBLIC=Aexisting\n', '')
        groups.add('NATS Configuration')
        const config = await collect()
        const result = new EnvFileUpdates(config.edits!.render(config)).getValues()
        expect(result.get('NATS_AUTH_NKEY_ISSUER_SEED')).toBe(seed)
        expect(result.get('NATS_AUTH_NKEY_ISSUER_PUBLIC')).toBe(publicKey)
        assertNoKeysGenerated()
    })

    it('creates a missing key pair only when its NATS group is selected', async () => {
        original = fixture.replace('NATS_AUTH_NKEY_ISSUER_SEED=SAexisting\n', '').replace('NATS_AUTH_NKEY_ISSUER_PUBLIC=Aexisting\n', '')
        groups.add('NATS Configuration')
        const config = await collect()
        expect(config.natsAuthNkeySeed).toMatch(/^SA/)
        expect(nkeys.createAccount).toHaveBeenCalledTimes(1)
        expect(nkeys.createCurve).not.toHaveBeenCalled()
    })

    it('cancelling a group or child prompt writes nothing', async () => {
        confirms.set('Edit Database Configuration?', Symbol('cancel'))
        expect(await runInteractivePrompts()).toBeNull()
        expect(write).not.toHaveBeenCalled()
        assertNoKeysGenerated()
    })

    it('edits the selected filename rather than deriving another destination', async () => {
        selectedFile = '.env.development'
        groups.add('General Configuration')
        selects.set('Organization name (used for Pulumi)', 'override')
        texts.set('Organization name (used for Pulumi)', 'Renamed')
        await writeFiles(await collect())
        expect(write).toHaveBeenCalledExactlyOnceWith('/workspace/.env.development', fixture.replace('ORG_NAME=Existing', 'ORG_NAME=Renamed'))
    })

    it('merges selected SSO settings while retaining unrelated AWS profiles', async () => {
        awsOriginal = '[sso-session existing]\nsso_start_url = https://sso.example.test/start\nsso_region = us-east-1\n\n[profile test-dev]\nsso_session = existing\nsso_account_id = 123456789012\nsso_role_name = Developer\nregion = us-east-1\ncustom = retain\n\n[profile other]\nregion = eu-west-1\n'
        groups.add('AWS SSO Configuration')
        confirms.set('Configure AWS SSO profile?', true)
        selects.set('AWS IAM Role name', 'override')
        texts.set('AWS IAM Role name', 'AdministratorAccess')
        await writeFiles(await collect())
        expect(write).toHaveBeenCalledExactlyOnceWith(awsPath, awsOriginal.replace('sso_role_name = Developer', 'sso_role_name = AdministratorAccess'))
    })

    it('uses the same subgroup branches when creating a fresh configuration', async () => {
        mode = 'new'
        original = undefined
        const config = await collect()
        expect(config.edits).toBeUndefined()
        expect(config.useLocalDynamoDB).toBe(true)
        expect(config.useLocalAuth0Mock).toBe(true)
        expect(config.configureAwsSso).toBe(false)
        expect(config.configureAwsDeployment).toBe(false)
        expect(prompts.text).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'DynamoDB endpoint URL' }))
        expect(prompts.text).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'AWS SSO session name' }))
        expect(prompts.text).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'Hosted Zone DNS Role ARN (optional)' }))
        expect(nkeys.createAccount).toHaveBeenCalledTimes(1)
        expect(nkeys.createCurve).toHaveBeenCalledTimes(1)
        expect(nkeys.createUser).toHaveBeenCalledTimes(7)
    })

    it('preserves kept AWS fields including comments and spacing', async () => {
        awsOriginal = '[sso-session existing]\r\nsso_start_url=https://sso.example.test/start  # keep\r\nsso_region=us-east-1\r\n[profile test-dev]\r\nsso_session=existing # shared\r\nsso_account_id=123456789012\r\nsso_role_name=Developer\r\nregion=eu-west-1 # intentionally different\r\n'
        groups.add('AWS SSO Configuration')
        confirms.set('Configure AWS SSO profile?', true)
        selects.set('AWS IAM Role name', 'override')
        texts.set('AWS IAM Role name', 'AdministratorAccess')
        await writeFiles(await collect())
        expect(write).toHaveBeenCalledExactlyOnceWith(awsPath, awsOriginal.replace('sso_role_name=Developer', 'sso_role_name=AdministratorAccess'))
    })

    it('does not write either file when the AWS configuration changes during editing', async () => {
        groups.add('General Configuration')
        selects.set('Organization name (used for Pulumi)', 'override')
        texts.set('Organization name (used for Pulumi)', 'Changed')
        groups.add('AWS SSO Configuration')
        confirms.set('Configure AWS SSO profile?', true)
        const config = await collect()
        awsOriginal = '# written by another process\n'
        await expect(writeFiles(config)).rejects.toThrow('AWS configuration changed')
        expect(write).not.toHaveBeenCalled()
    })
})
