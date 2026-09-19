import {
    log as debugLog,
    err as debugError,
} from '@lixpi/debug-tools'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { parseEnv } from 'node:util'
import { registrationEnvironment } from '@lixpi/nats-subject-registry/registration'
import * as prompts from '@clack/prompts'
import {
    createAccount,
    createCurve,
    createUser,
    fromSeed,
} from '@nats-io/nkeys'
import c from 'chalk'

const WORKSPACE_DIR = '/workspace'
const TEMPLATES_DIR = new URL('./templates', import.meta.url).pathname

// ============================================================================
// Types
// ============================================================================

type EnvironmentType = 'local' | 'dev' | 'production'

type EnvConfig = {
    edits?: WizardFields
    envFilePath?: string
    existingEnvContent?: string
    // General
    developerName: string
    orgName: string
    environment: EnvironmentType
    domainName: string
    certificateEmail: string

    // Database
    useLocalDynamoDB: boolean
    dynamodbEndpoint: string

    // Authentication
    useLocalAuth0Mock: boolean
    auth0Domain: string
    auth0ClientId: string
    auth0Audience: string

    // NATS (auto-generated)
    natsAuthNkeySeed: string
    natsAuthNkeyPublic: string
    natsAuthXkeySeed: string
    natsAuthXkeyPublic: string
    natsLlmServiceNkeySeed: string
    natsLlmServiceNkeyPublic: string
    natsNexNodeNkeySeed: string
    natsNexNodeNkeyPublic: string
    natsApiNkeySeed: string
    natsApiNkeyPublic: string
    natsFileConversionNkeySeed: string
    natsFileConversionNkeyPublic: string
    natsCharacterFidelityNkeySeed: string
    natsCharacterFidelityNkeyPublic: string
    natsBackupNkeySeed: string
    natsBackupNkeyPublic: string
    natsOperatorNkeySeed: string
    natsOperatorNkeyPublic: string
    natsSysUserPassword: string
    natsCalloutPassword: string

    // AWS SSO (optional)
    configureAwsSso: boolean
    awsSsoSessionName: string
    awsSsoStartUrl: string
    awsRegion: string
    awsProfileName: string
    awsAccountId: string
    awsRoleName: string

    // AWS Deployment (optional)
    configureAwsDeployment: boolean
    hostedZoneDnsRoleArn: string
    hostedZoneName: string
    awsRoute53ParentHostedZoneId: string

    // CloudWatch Logging
    cloudwatchLogRetentionDays: number
    cloudwatchContainerInsightsEnabled: boolean

    // API Keys
    openaiApiKey: string
    anthropicApiKey: string
    // When true, anthropicApiKey is ignored and inference goes through AWS Bedrock.
    anthropicUseAwsBedrockInference: boolean
    googleApiKey: string
    // Veo person-generation policy profile for the deployment's region. `standard`
    // is the least restrictive profile Google accepts and is the default.
    googleVeoPersonGenerationProfile: 'standard' | 'restricted'
    stableDiffusionApiKey: string
    // When true, stableDiffusionApiKey is ignored and inference goes through AWS Bedrock.
    stabilityUseAwsBedrockInference: boolean
    arkApiKey: string
    stripePublicKey: string
}

type CliArgs = {
    nonInteractive: boolean
    name?: string
    env?: EnvironmentType
    help: boolean
}

// Keep the original assignments so partial updates don't discard comments,
// custom variables, quoting, interpolation, or multiline values.
export class EnvFileUpdates {
    private readonly source: string
    private readonly entries: Map<string, string>
    private readonly changes = new Map<string, string>()
    private readonly assignment = /^([\t ]*(?:export[\t ]+)?([A-Za-z_][A-Za-z0-9_]*)[\t ]*=[\t ]*)('(\\[\s\S]|[^'\\])*'|"(\\[\s\S]|[^"\\])*"|[^\r\n]*)([^\r\n]*)(\r?\n|$)/gm

    constructor(source: string) {
        this.source = source
        this.entries = new Map(
            Array.from(
                source.matchAll(this.assignment),
                match => [match[2], this.splitComment(match[3], match[6]).literal],
            ),
        )
    }

    getValues(): Map<string, string> {
        return new Map(this.entries)
    }

    private splitComment(
        value: string,
        trailing: string,
    ): {
        literal: string
        comment: string
    } {
        const commentIndex = /^["']/.test(value) ? -1 : value.search(/(?:^|[\t ]+)#/)
        const literal = commentIndex === -1 ? value : value.slice(0, commentIndex)
        const comment = `${literal.slice(literal.trimEnd().length)}${commentIndex === -1 ? '' : value.slice(commentIndex)}${trailing}`

        return {
            literal: literal.trimEnd(),
            comment,
        }
    }

    setValue(
        name: string,
        literal: string,
    ): void {
        const assignment = `${name}=${literal}\n`
        const matches = Array.from(
            assignment.matchAll(this.assignment),
        )
        const match = matches[0]

        if (
            !match
            || matches.length !== 1
            || match[0] !== assignment
            || match[2] !== name
        )
            throw new Error(`Invalid environment assignment for ${name}`)

        // A quoted value must close before any optional inline comment.
        const value = match[3].trimEnd()

        if (
            /^["']/.test(value)
            && !new RegExp(`^${value[0]}(?:\\\\[\\s\\S]|[^${value[0]}\\\\])*${value[0]}$`).test(value)
        )
            throw new Error(`Unclosed quoted value for ${name}`)

        if (
            match[6].trim()
            && !match[6].trimStart().startsWith('#')
        )
            throw new Error(`Unexpected text after ${name}`)

        this.changes.set(name, literal)
    }

    render(): string {
        let content = this.source.replace(this.assignment, (
            assignment,
            prefix,
            name,
            value,
            _single,
            _double,
            comment,
            ending,
        ) => {
            if (!this.changes.has(name))
                return assignment

            const suffix = this.splitComment(value, comment).comment
            const spacing = suffix.startsWith('#') ? ' ' : ''

            return `${prefix}${this.changes.get(name)}${spacing}${suffix}${ending}`
        })
        const newline = this.source.includes('\r\n') ? '\r\n' : '\n'

        for (const [name, literal] of this.changes) {
            if (this.entries.has(name))
                continue

            if (
                content
                && !content.endsWith('\n')
            )
                content += newline

            content += `${name}=${literal}${newline}`
        }

        return content
    }
}

const fieldVariables: Partial<Record<keyof EnvConfig, string[]>> = {
    developerName: ['STAGE', 'STATE_STORAGE_URL'],
    environment: ['ENVIRONMENT', 'STAGE', 'STATE_STORAGE_URL', 'NATS_DEBUG_MODE', 'NATS_ALLOWED_ORIGINS', 'ORIGIN_HOST_URL', 'API_HOST_URL', 'VITE_API_URL', 'VITE_AUTH0_LOGIN_URL', 'VITE_AUTH0_REDIRECT_URI', 'VITE_USER_PORTAL_URL', 'VITE_NATS_SERVER', 'SAVE_LLM_RESPONSES_TO_DEBUG_DIR'],
    orgName: ['ORG_NAME'],
    domainName: ['DOMAIN_NAME', 'NATS_ALLOWED_ORIGINS', 'ORIGIN_HOST_URL', 'API_HOST_URL', 'VITE_API_URL', 'VITE_AUTH0_LOGIN_URL', 'VITE_AUTH0_REDIRECT_URI', 'VITE_USER_PORTAL_URL', 'VITE_NATS_SERVER'],
    certificateEmail: ['CERTIFICATE_VALIDATION_EMAIL'],
    useLocalDynamoDB: ['DYNAMODB_ENDPOINT'],
    dynamodbEndpoint: ['DYNAMODB_ENDPOINT'],
    useLocalAuth0Mock: ['MOCK_AUTH0', 'VITE_MOCK_AUTH', 'MOCK_AUTH0_DOMAIN', 'MOCK_AUTH0_JWKS_URI', 'VITE_MOCK_AUTH0_DOMAIN'],
    auth0Domain: ['AUTH0_DOMAIN', 'VITE_AUTH0_DOMAIN'],
    auth0ClientId: ['VITE_AUTH0_CLIENT_ID'],
    auth0Audience: ['AUTH0_API_IDENTIFIER', 'VITE_AUTH0_AUDIENCE'],
    natsAuthNkeySeed: ['NATS_AUTH_NKEY_ISSUER_SEED'],
    natsAuthNkeyPublic: ['NATS_AUTH_NKEY_ISSUER_PUBLIC'],
    natsAuthXkeySeed: ['NATS_AUTH_XKEY_ISSUER_SEED'],
    natsAuthXkeyPublic: ['NATS_AUTH_XKEY_ISSUER_PUBLIC'],
    natsLlmServiceNkeySeed: ['NATS_LLM_SERVICE_NKEY_SEED'],
    natsLlmServiceNkeyPublic: ['NATS_LLM_SERVICE_NKEY_PUBLIC'],
    natsNexNodeNkeySeed: ['NATS_NEX_NODE_NKEY_SEED'],
    natsNexNodeNkeyPublic: ['NATS_NEX_NODE_NKEY_PUBLIC'],
    natsApiNkeySeed: ['NATS_API_NKEY_SEED'],
    natsApiNkeyPublic: ['NATS_API_NKEY_PUBLIC'],
    natsFileConversionNkeySeed: ['NATS_FILE_CONVERSION_NKEY_SEED'],
    natsFileConversionNkeyPublic: ['NATS_FILE_CONVERSION_NKEY_PUBLIC'],
    natsCharacterFidelityNkeySeed: ['NATS_CHARACTER_FIDELITY_NKEY_SEED'],
    natsCharacterFidelityNkeyPublic: ['NATS_CHARACTER_FIDELITY_NKEY_PUBLIC'],
    natsBackupNkeySeed: ['NATS_BACKUP_NKEY_SEED'],
    natsBackupNkeyPublic: ['NATS_BACKUP_NKEY_PUBLIC'],
    natsOperatorNkeySeed: ['NATS_OPERATOR_NKEY_SEED'],
    natsOperatorNkeyPublic: ['NATS_OPERATOR_NKEY_PUBLIC'],
    natsSysUserPassword: ['NATS_SYS_USER_PASSWORD'],
    natsCalloutPassword: ['NATS_CALLOUT_PASSWORD'],
    awsRegion: ['AWS_REGION'],
    awsProfileName: ['AWS_PROFILE'],
    hostedZoneDnsRoleArn: ['HOSTED_ZONE_DNS_ROLE_ARN'],
    hostedZoneName: ['HOSTED_ZONE_NAME'],
    awsRoute53ParentHostedZoneId: ['AWS_ROUTE53_PARENT_HOSTED_ZONE_ID'],
    cloudwatchLogRetentionDays: ['CLOUDWATCH_LOG_RETENTION_DAYS'],
    cloudwatchContainerInsightsEnabled: ['CLOUDWATCH_CONTAINER_INSIGHTS_ENABLED'],
    openaiApiKey: ['OPENAI_API_KEY'],
    anthropicApiKey: ['ANTHROPIC_API_KEY'],
    anthropicUseAwsBedrockInference: ['ANTHROPIC_USE_AWS_BEDROCK_INFERENCE'],
    googleApiKey: ['GOOGLE_API_KEY'],
    googleVeoPersonGenerationProfile: ['GOOGLE_VEO_PERSON_GENERATION_PROFILE'],
    stableDiffusionApiKey: ['STABLE_DIFFUSION_API_KEY'],
    stabilityUseAwsBedrockInference: ['STABILITY_USE_AWS_BEDROCK_INFERENCE'],
    arkApiKey: ['ARK_API_KEY'],
    stripePublicKey: ['VITE_STRIPE_PUBLIC_KEY'],
}

class SetupCancelled extends Error {}

// Creation and editing use the same field prompts and branches. This class adds
// group selection, reuse choices, and a record of explicitly changed fields.
class WizardFields {
    readonly source: string | undefined
    readonly partial: boolean
    readonly changed = new Set<keyof EnvConfig>()
    private enabled = true
    private readonly stored = new Map<keyof EnvConfig, string>()
    readonly awsSource: string | undefined

    constructor(source?: string) {
        this.source = source
        this.partial = source !== undefined
        const values = parseEnv(source ?? '')

        for (const [field, variables] of Object.entries(fieldVariables)) {
            if (Object.hasOwn(values, variables[0]))
                this.stored.set(field as keyof EnvConfig, values[variables[0]])
        }

        if (
            values.STAGE
            && values.ENVIRONMENT
        )
            this.stored.set(
                'developerName',
                values.STAGE.replace(
                    new RegExp(`-${values.ENVIRONMENT}$`),
                    '',
                ),
            )

        if (Object.hasOwn(values, 'DYNAMODB_ENDPOINT'))
            this.stored.set(
                'useLocalDynamoDB',
                String(values.DYNAMODB_ENDPOINT === 'http://lixpi-dynamodb:8000'),
            )

        if (
            !this.stored.has('useLocalAuth0Mock')
            && Object.hasOwn(values, 'VITE_MOCK_AUTH')
        )
            this.stored.set('useLocalAuth0Mock', values.VITE_MOCK_AUTH)

        const awsPath = path.join(
            WORKSPACE_DIR,
            '.aws',
            'config',
        )

        if (
            this.partial
            && fs.existsSync(awsPath)
        ) {
            this.awsSource = fs.readFileSync(awsPath, 'utf-8')
            const profile = this.iniSection(`profile ${values.AWS_PROFILE ?? ''}`)
            const session = this.iniSection(`sso-session ${profile.sso_session ?? ''}`)

            for (const [field, value] of Object.entries({
                awsSsoSessionName: profile.sso_session,
                awsSsoStartUrl: session.sso_start_url,
                awsAccountId: profile.sso_account_id,
                awsRoleName: profile.sso_role_name,
            })) {
                if (value !== undefined)
                    this.stored.set(field as keyof EnvConfig, value)
            }
        }
    }

    private iniSection(name: string): Record<string, string> {
        const result: Record<string, string> = {}
        let active = false

        for (const line of (this.awsSource ?? '').split(/\r?\n/)) {
            if (line.trim().startsWith('['))
                active = line.trim() === `[${name}]`
            else if (active) {
                const match = line.match(/^\s*([^#;=]+?)\s*=\s*(.*?)\s*$/)

                if (match)
                    result[match[1]] = match[2].replace(/\s+[;#].*$/, '').trimEnd()
            }
        }

        return result
    }

    read<T extends string | boolean | number>(
        field: keyof EnvConfig,
        fallback: T,
    ): T {
        const value = this.stored.get(field)

        if (value === undefined)
            return fallback

        if (typeof fallback === 'boolean')
            return (value === 'true') as T

        if (typeof fallback === 'number')
            return Number(value) as T

        return value as T
    }

    async group(name: string): Promise<void> {
        this.enabled = !this.partial || this.unwrap(await prompts.confirm({
            message: `Edit ${name}?`,
            initialValue: false,
        }))

        if (this.enabled)
            prompts.log.step(
                c.bold(
                    c.blue(name),
                ),
            )
    }

    private unwrap<T>(value: T | symbol): T {
        if (prompts.isCancel(value))
            throw new SetupCancelled()

        return value as T
    }

    private async replace(
        field: keyof EnvConfig,
        message: string,
    ): Promise<boolean> {
        if (!this.enabled)
            return false

        if (!this.partial)
            return true

        const exists = this.stored.has(field)
        const action = this.unwrap(
            await prompts.select({
                message,
                options: exists ? [
                    {
                        value: 'keep',
                        label: this.stored.get(field) === '' ? 'Keep empty' : 'Use existing value',
                    },
                    {
                        value: 'override',
                        label: 'Override value',
                    },
                ] : [{
                    value: 'override',
                    label: 'Set new value',
                }],
                initialValue: exists ? 'keep' : 'override',
            }),
        )

        return action === 'override'
    }

    async text(
        field: keyof EnvConfig,
        options: Parameters<typeof prompts.text>[0],
    ): Promise<string> {
        const current = this.read(field, options.defaultValue ?? '')

        if (!(await this.replace(field, options.message)))
            return current

        const value = this.unwrap(await prompts.text({
            ...options,
            defaultValue: current,
        }))
        this.changed.add(field)

        return value
    }

    async confirm(
        field: keyof EnvConfig,
        options: Parameters<typeof prompts.confirm>[0],
    ): Promise<boolean> {
        const current = this.read(field, options.initialValue ?? false)

        if (!(await this.replace(field, options.message)))
            return current

        const value = this.unwrap(await prompts.confirm({
            ...options,
            initialValue: current,
        }))
        this.changed.add(field)

        return value
    }

    async select<T extends string | number>(
        field: keyof EnvConfig,
        options: {
            message: string
            options: {
                value: T
                label: string
                hint?: string
            }[]
            initialValue?: T
        },
    ): Promise<T> {
        const current = this.read(field, options.initialValue ?? options.options[0].value)

        if (!(await this.replace(field, options.message)))
            return current

        const value = this.unwrap(await prompts.select({
            ...options,
            initialValue: current,
        }))
        this.changed.add(field)

        return value
    }

    async optionalGroup(options: Parameters<typeof prompts.confirm>[0]): Promise<boolean> {
        return this.enabled && this.unwrap(await prompts.confirm(options))
    }

    async keyPair(
        seedField: keyof EnvConfig,
        publicField: keyof EnvConfig,
        factory: typeof createUser,
    ): Promise<{
        seed: string
        public: string
    }> {
        const existing = {
            seed: this.read(seedField, ''),
            public: this.read(publicField, ''),
        }

        if (!this.enabled)
            return existing

        if (
            this.partial
            && existing.seed
            && existing.public
            && !(await this.replace(seedField, fieldVariables[seedField][0]))
        )
            return existing

        if (
            this.partial
            && (!existing.seed || !existing.public)
        )
            this.unwrap(
                await prompts.select({
                    message: fieldVariables[seedField][0],
                    options: [{
                        value: 'generate',
                        label: existing.seed ? 'Generate missing public key' : 'Generate new key pair',
                    }],
                }),
            )

        const key = existing.seed
            && !existing.public
            ? fromSeed(
                new TextEncoder().encode(existing.seed),
            )
            : factory()

        try {
            const pair = {
                seed: new TextDecoder().decode(
                    key.getSeed(),
                ),
                public: key.getPublicKey(),
            }
            this.changed.add(seedField)
            this.changed.add(publicField)

            return pair
        } finally {
            key.clear()
        }
    }

    async password(field: keyof EnvConfig): Promise<string> {
        if (!(await this.replace(field, fieldVariables[field][0])))
            return this.read(field, '')

        this.changed.add(field)

        return generateSecurePassword(28)
    }

    render(config: EnvConfig): string {
        const updates = new EnvFileUpdates(this.source ?? '')
        const generated = new EnvFileUpdates(
            generateEnvFileContent(config),
        ).getValues()

        for (const field of this.changed) {
            for (const name of fieldVariables[field] ?? []) {
                if (generated.has(name))
                    updates.setValue(
                        name,
                        generated.get(name),
                    )
            }
        }

        return updates.render()
    }

    renderAws(config: EnvConfig): string {
        let content = this.awsSource ?? ''
        const sections: {
            name: string
            fields: Record<string, keyof EnvConfig>
        }[] = [
            {
                name: `sso-session ${config.awsSsoSessionName}`,
                fields: {
                    sso_start_url: 'awsSsoStartUrl',
                    sso_region: 'awsRegion',
                },
            },
            {
                name: `profile ${config.awsProfileName}`,
                fields: {
                    sso_session: 'awsSsoSessionName',
                    sso_account_id: 'awsAccountId',
                    sso_role_name: 'awsRoleName',
                    region: 'awsRegion',
                },
            },
        ]
        const newline = content.includes('\r\n') ? '\r\n' : '\n'

        for (const section of sections) {
            const lines = content.split(/(?<=\n)/)
            let start = lines.findIndex(line => line.trim() === `[${section.name}]`)

            if (start === -1) {
                if (
                    content
                    && !content.endsWith('\n')
                )
                    content += newline

                content += `${newline}[${section.name}]${newline}`
                content += Object.entries(section.fields).map(([key, field]) => `${key} = ${config[field]}${newline}`)
                    .join('')

                continue
            }

            start += 1
            let end = start

            while (
                end < lines.length
                && !lines[end].trim().startsWith('[')
            )
                end += 1

            for (const [key, field] of Object.entries(section.fields)) {
                if (!this.changed.has(field))
                    continue

                const value = config[field]
                const index = lines.findIndex((line, i) => i >= start && i < end && new RegExp(`^\\s*${key}\\s*=`).test(line))

                if (index === -1) {
                    if (
                        end > 0
                        && !lines[end - 1].endsWith('\n')
                    )
                        lines[end - 1] += newline

                    lines.splice(
                        end,
                        0,
                        `${key} = ${value}${newline}`,
                    )
                    end += 1
                } else
                    lines[index] = lines[index].replace(
                        /^(\s*[^=]+?\s*=\s*)[^\r\n]*?(\s+[;#][^\r\n]*)?(\r?\n|$)$/,
                        (
                            _line,
                            prefix,
                            comment,
                            ending,
                        ) => `${prefix}${value}${comment ?? ''}${ending}`,
                    )
            }

            content = lines.join('')
        }

        return content
    }
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

const parseCliArgs = (): CliArgs => {
    const args = process.argv.slice(2)
    const result: CliArgs = {
        nonInteractive: false,
        help: false,
    }

    for (const arg of args) {
        if (
            arg === '--help'
            || arg === '-h'
        )
            result.help = true
        else if (arg === '--non-interactive')
            result.nonInteractive = true
        else if (arg.startsWith('--name='))
            result.name = arg.split('=')[1]
        else if (arg.startsWith('--env=')) {
            const env = arg.split('=')[1]

            if (
                env === 'local'
                || env === 'dev'
                || env === 'production'
            )
                result.env = env
        }
    }

    return result
}

const printHelp = (): void => {
    debugLog(
        `
            ${c.bold(
                c.cyan('Lixpi Environment Setup'),
            )}

            ${c.bold('Usage:')}
            ${c.dim('# Interactive mode')}
            docker run -it --rm -v "$(pwd):/workspace" lixpi/setup

            ${c.dim('# Non-interactive mode (CI/automation)')}
            docker run --rm -v "$(pwd):/workspace" lixpi/setup --non-interactive --name=<name> --env=<env>

            ${c.bold('Options:')}
            -h, --help              Show this help message
            --non-interactive       Run without prompts (requires --name and --env)
            --name=<name>           Developer name (e.g., "kitty")
            --env=<environment>     Environment type: local, dev, production

            ${c.bold('Examples:')}
            docker run -it --rm -v "$(pwd):/workspace" lixpi/setup
            docker run --rm -v "$(pwd):/workspace" lixpi/setup --non-interactive --name=kitty --env=local

            ${c.bold('Windows CMD:')}
            docker run -it --rm -v "%cd%:/workspace" lixpi/setup

            ${c.bold('Windows PowerShell:')}
            docker run -it --rm -v "\${PWD}:/workspace" lixpi/setup

            ${c.bold('Output:')}
            Creates .env.<name>-<env> file in the project root
            Optionally creates .aws/config file
            `,
    )
}

// ============================================================================
// Key Generation
// ============================================================================

const generateNatsKeys = (): {
    apiNkey: {
        seed: string
        public: string
    }
    fileConversionNkey: {
        seed: string
        public: string
    }
    characterFidelityNkey: {
        seed: string
        public: string
    }
    backupNkey: {
        seed: string
        public: string
    }
    operatorNkey: {
        seed: string
        public: string
    }
    authNkey: {
        seed: string
        public: string
    }
    authXkey: {
        seed: string
        public: string
    }
    llmServiceNkey: {
        seed: string
        public: string
    }
    nexNodeNkey: {
        seed: string
        public: string
    }
} => {
    // createAccount() for NATS_AUTH_NKEY_* (seeds start with SA)
    const accountKey = createAccount()
    const authNkey = {
        seed: new TextDecoder().decode(
            accountKey.getSeed(),
        ),
        public: accountKey.getPublicKey(),
    }
    accountKey.clear()

    // createCurve() for NATS_AUTH_XKEY_* (seeds start with SX)
    const curveKey = createCurve()
    const authXkey = {
        seed: new TextDecoder().decode(
            curveKey.getSeed(),
        ),
        public: curveKey.getPublicKey(),
    }
    curveKey.clear()

    // createUser() for NATS_LLM_SERVICE_NKEY_* (seeds start with SU)
    const userKey = createUser()
    const llmServiceNkey = {
        seed: new TextDecoder().decode(
            userKey.getSeed(),
        ),
        public: userKey.getPublicKey(),
    }
    userKey.clear()

    // createUser() for NATS_NEX_NODE_NKEY_* (seeds start with SU) — the NEX
    // execution-engine node connects to the NEX account with this user nkey.
    const nexNodeKey = createUser()
    const nexNodeNkey = {
        seed: new TextDecoder().decode(
            nexNodeKey.getSeed(),
        ),
        public: nexNodeKey.getPublicKey(),
    }
    nexNodeKey.clear()

    const createIdentity = () => {
        const key = createUser()
        const pair = {
            seed: new TextDecoder().decode(
                key.getSeed(),
            ),
            public: key.getPublicKey(),
        }
        key.clear()

        return pair
    }

    return {
        apiNkey: createIdentity(),
        fileConversionNkey: createIdentity(),
        characterFidelityNkey: createIdentity(),
        backupNkey: createIdentity(),
        operatorNkey: createIdentity(),
        authNkey,
        authXkey,
        llmServiceNkey,
        nexNodeNkey,
    }
}

const generateSecurePassword = (length: number = 32): string => {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const bytes = crypto.randomBytes(length)
    let password = ''

    for (let i = 0; i < length; i++) {
        password += charset[bytes[i] % charset.length]
    }

    return password
}

// ============================================================================
// Prompts
// ============================================================================

const chooseConfigUpdate = async (envFilePath: string): Promise<'partial' | 'overwrite' | null> => {
    const mode = await prompts.select({
        message: `How do you want to update ${path.basename(envFilePath)}?`,
        options: [
            {
                value: 'partial',
                label: 'Partial update',
                hint: 'Choose existing or replacement for each value',
            },
            {
                value: 'overwrite',
                label: 'Override completely',
                hint: 'Run setup with fresh values and NATS credentials',
            },
        ],
    })

    if (prompts.isCancel(mode)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    return mode as 'partial' | 'overwrite'
}

const selectConfiguration = async (): Promise<EnvConfig | null> => {
    prompts.intro(
        c.bgCyan(
            c.black(' Lixpi Environment Setup '),
        ),
    )

    const action = await prompts.select({
        message: 'Generate a new configuration or edit an existing one?',
        options: [
            {
                value: 'new',
                label: 'Generate new',
            },
            {
                value: 'edit',
                label: 'Edit existing',
            },
        ],
    })

    if (prompts.isCancel(action)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    let envFilePath: string | undefined
    let existingEnvContent: string | undefined
    let partial = false

    if (action === 'edit') {
        const configs = fs.readdirSync(WORKSPACE_DIR).filter(name => name.startsWith('.env.')).filter(name => {
            const filePath = path.join(WORKSPACE_DIR, name)

            return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
        })
            .sort()

        if (!configs.length) {
            prompts.cancel('No existing .env configurations found. Run setup again and choose Generate new.')

            return null
        }

        const selected = await prompts.select({
            message: 'Select a configuration to edit',
            options: configs.map(
                name => ({
                    value: name,
                    label: name,
                }),
            ),
        })

        if (prompts.isCancel(selected)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        envFilePath = path.join(WORKSPACE_DIR, selected)
        existingEnvContent = fs.readFileSync(envFilePath, 'utf-8')

        const mode = await chooseConfigUpdate(envFilePath)

        if (!mode)
            return null

        partial = mode === 'partial'
    }

    return collectConfiguration(
        envFilePath,
        existingEnvContent,
        partial,
    )
}

export const runInteractivePrompts = async (): Promise<EnvConfig | null> => {
    try {
        return await selectConfiguration()
    } catch (error) {
        if (!(error instanceof SetupCancelled))
            throw error

        prompts.cancel('Setup cancelled')

        return null
    }
}

const collectConfiguration = async (
    envFilePath?: string,
    existingEnvContent?: string,
    partial = false,
): Promise<EnvConfig | null> => {
    const fields = new WizardFields(partial ? existingEnvContent : undefined)
    // -------------------------------------------------------------------------
    // General Section
    // -------------------------------------------------------------------------
    await fields.group('General Configuration')

    const developerName = await fields.text(
        'developerName',
        {
            message: 'Developer name (used in stage name, e.g., "kitty")',
            placeholder: 'kitty',
            validate: value => {
                if (!value)
                    return 'Developer name is required'

                if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(value))
                    return 'Name must start with a letter and contain only letters, numbers, and hyphens'
            },
        },
    )

    if (prompts.isCancel(developerName)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    const environment = await fields.select(
        'environment',
        {
            message: 'Environment type',
            options: [
                {
                    value: 'local',
                    label: 'Local',
                    hint: 'Local development with Docker',
                },
                {
                    value: 'dev',
                    label: 'Dev',
                    hint: 'Development AWS deployment',
                },
                {
                    value: 'production',
                    label: 'Production',
                    hint: 'Production AWS deployment',
                },
            ],
        },
    )

    if (prompts.isCancel(environment)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    const isLocal = environment === 'local'
    const stageName = `${developerName}-${environment}`

    if (!envFilePath) {
        envFilePath = path.join(WORKSPACE_DIR, `.env.${stageName}`)

        if (fs.existsSync(envFilePath)) {
            existingEnvContent = fs.readFileSync(envFilePath, 'utf-8')

            const mode = await chooseConfigUpdate(envFilePath)

            if (!mode)
                return null

            if (mode === 'partial')
                return collectConfiguration(
                    envFilePath,
                    existingEnvContent,
                    true,
                )
        }
    }

    const orgName = await fields.text(
        'orgName',
        {
            message: 'Organization name (used for Pulumi)',
            placeholder: 'Lixpi',
            defaultValue: 'Lixpi',
        },
    )

    if (prompts.isCancel(orgName)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    prompts.log.info(`Stage: ${c.cyan(stageName)}`)

    let domainName = fields.read('domainName', '')
    let certificateEmail = fields.read('certificateEmail', '')

    if (!isLocal) {
        const domain = await fields.text(
            'domainName',
            {
                message: 'Domain name',
                placeholder: 'example.com',
            },
        )

        if (prompts.isCancel(domain)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        domainName = domain as string

        prompts.log.info(`Domain: ${c.cyan(domainName)}`)

        const email = await fields.text(
            'certificateEmail',
            {
                message: 'Email for SSL certificate validation',
                placeholder: `${developerName}@mail.com`,
                defaultValue: `${developerName}@mail.com`,
            },
        )

        if (prompts.isCancel(email)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        certificateEmail = email as string
    }

    // -------------------------------------------------------------------------
    // Database Section
    // -------------------------------------------------------------------------
    await fields.group('Database Configuration')

    const useLocalDynamoDB = await fields.confirm(
        'useLocalDynamoDB',
        {
            message: 'Use local DynamoDB (Docker)?',
            initialValue: environment === 'local',
        },
    )

    if (prompts.isCancel(useLocalDynamoDB)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    let dynamodbEndpoint = useLocalDynamoDB ? 'http://lixpi-dynamodb:8000' : fields.read('dynamodbEndpoint', '')

    if (!useLocalDynamoDB) {
        const endpoint = await fields.text(
            'dynamodbEndpoint',
            {
                message: 'DynamoDB endpoint URL',
                placeholder: 'https://dynamodb.us-east-1.amazonaws.com',
            },
        )

        if (prompts.isCancel(endpoint)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        dynamodbEndpoint = endpoint as string
    }

    // -------------------------------------------------------------------------
    // Authentication Section
    // -------------------------------------------------------------------------
    await fields.group('Authentication Configuration')

    const useLocalAuth0Mock = await fields.confirm(
        'useLocalAuth0Mock',
        {
            message: 'Use LocalAuth0 mock (for local development)?',
            initialValue: environment === 'local',
        },
    )

    if (prompts.isCancel(useLocalAuth0Mock)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    let auth0Domain = fields.read('auth0Domain', '')
    let auth0ClientId = fields.read('auth0ClientId', '')
    let auth0Audience = fields.read('auth0Audience', 'http://localhost:3005')

    if (!useLocalAuth0Mock) {
        const domain = await fields.text(
            'auth0Domain',
            {
                message: 'Auth0 domain (e.g., https://your-tenant.us.auth0.com)',
                placeholder: 'https://your-tenant.us.auth0.com',
            },
        )

        if (prompts.isCancel(domain)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        auth0Domain = domain as string

        const clientId = await fields.text(
            'auth0ClientId',
            {
                message: 'Auth0 Client ID',
                placeholder: 'your-client-id',
            },
        )

        if (prompts.isCancel(clientId)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        auth0ClientId = clientId as string

        const audience = await fields.text(
            'auth0Audience',
            {
                message: 'Auth0 API Identifier (audience)',
                placeholder: 'https://api.your-domain.com',
            },
        )

        if (prompts.isCancel(audience)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        auth0Audience = audience as string
    }

    // -------------------------------------------------------------------------
    // NATS Section (Auto-generated)
    // -------------------------------------------------------------------------
    await fields.group('NATS Configuration')

    const natsKeys = {
        apiNkey: await fields.keyPair(
            'natsApiNkeySeed',
            'natsApiNkeyPublic',
            createUser,
        ),
        fileConversionNkey: await fields.keyPair(
            'natsFileConversionNkeySeed',
            'natsFileConversionNkeyPublic',
            createUser,
        ),
        characterFidelityNkey: await fields.keyPair(
            'natsCharacterFidelityNkeySeed',
            'natsCharacterFidelityNkeyPublic',
            createUser,
        ),
        backupNkey: await fields.keyPair(
            'natsBackupNkeySeed',
            'natsBackupNkeyPublic',
            createUser,
        ),
        operatorNkey: await fields.keyPair(
            'natsOperatorNkeySeed',
            'natsOperatorNkeyPublic',
            createUser,
        ),
        authNkey: await fields.keyPair(
            'natsAuthNkeySeed',
            'natsAuthNkeyPublic',
            createAccount,
        ),
        authXkey: await fields.keyPair(
            'natsAuthXkeySeed',
            'natsAuthXkeyPublic',
            createCurve,
        ),
        llmServiceNkey: await fields.keyPair(
            'natsLlmServiceNkeySeed',
            'natsLlmServiceNkeyPublic',
            createUser,
        ),
        nexNodeNkey: await fields.keyPair(
            'natsNexNodeNkeySeed',
            'natsNexNodeNkeyPublic',
            createUser,
        ),
    }
    const natsSysUserPassword = await fields.password('natsSysUserPassword')
    const natsCalloutPassword = await fields.password('natsCalloutPassword')

    // -------------------------------------------------------------------------
    // AWS SSO Section
    // -------------------------------------------------------------------------
    await fields.group('AWS SSO Configuration')

    const configureAwsSso = await fields.optionalGroup({
        message: 'Configure AWS SSO profile?',
        initialValue: false,
    })

    if (prompts.isCancel(configureAwsSso)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    let awsSsoSessionName = fields.read('awsSsoSessionName', '')
    let awsSsoStartUrl = fields.read('awsSsoStartUrl', '')
    let awsRegion = fields.read('awsRegion', 'us-east-1')
    let awsProfileName = fields.read('awsProfileName', '')
    let awsAccountId = fields.read('awsAccountId', '')
    let awsRoleName = fields.read('awsRoleName', 'AdministratorAccess')

    if (configureAwsSso) {
        const ssoSessionName = await fields.text(
            'awsSsoSessionName',
            {
                message: 'AWS SSO session name',
                placeholder: 'my-sso',
            },
        )

        if (prompts.isCancel(ssoSessionName)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        awsSsoSessionName = ssoSessionName as string

        const ssoStartUrl = await fields.text(
            'awsSsoStartUrl',
            {
                message: 'AWS SSO start URL',
                placeholder: 'https://my-org.awsapps.com/start',
            },
        )

        if (prompts.isCancel(ssoStartUrl)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        awsSsoStartUrl = ssoStartUrl as string

        const region = await fields.text(
            'awsRegion',
            {
                message: 'AWS region',
                placeholder: 'us-east-1',
                defaultValue: 'us-east-1',
            },
        )

        if (prompts.isCancel(region)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        awsRegion = region as string

        const profileName = await fields.text(
            'awsProfileName',
            {
                message: 'AWS profile name',
                placeholder: `${developerName}-dev`,
            },
        )

        if (prompts.isCancel(profileName)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        awsProfileName = profileName as string

        const accountId = await fields.text(
            'awsAccountId',
            {
                message: 'AWS Account ID',
                placeholder: '',
                validate: value => {
                    if (!value)
                        return 'Account ID is required'

                    if (!/^\d{12}$/.test(value))
                        return 'Account ID must be 12 digits'
                },
            },
        )

        if (prompts.isCancel(accountId)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        awsAccountId = accountId as string

        const roleName = await fields.text(
            'awsRoleName',
            {
                message: 'AWS IAM Role name',
                placeholder: 'AdministratorAccess',
                defaultValue: 'AdministratorAccess',
            },
        )

        if (prompts.isCancel(roleName)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        awsRoleName = roleName as string
    }

    // -------------------------------------------------------------------------
    // AWS Deployment Section
    // -------------------------------------------------------------------------
    await fields.group('AWS Deployment Configuration')

    const configureAwsDeployment = await fields.optionalGroup({
        message: 'Configure AWS deployment settings?',
        initialValue: false,
    })

    if (prompts.isCancel(configureAwsDeployment)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    let hostedZoneDnsRoleArn = fields.read('hostedZoneDnsRoleArn', '')
    let hostedZoneName = fields.read('hostedZoneName', '')
    let awsRoute53ParentHostedZoneId = fields.read('awsRoute53ParentHostedZoneId', '')
    let cloudwatchLogRetentionDays = fields.read('cloudwatchLogRetentionDays', 7)
    let cloudwatchContainerInsightsEnabled = fields.read('cloudwatchContainerInsightsEnabled', false)

    if (configureAwsDeployment) {
        const hostedZoneDns = await fields.text(
            'hostedZoneDnsRoleArn',
            {
                message: 'Hosted Zone DNS Role ARN (optional)',
                placeholder: 'arn:aws:iam::<account-id>:role/<role-name>',
            },
        )

        if (prompts.isCancel(hostedZoneDns)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        hostedZoneDnsRoleArn = (hostedZoneDns as string) || ''

        const hostedZone = await fields.text(
            'hostedZoneName',
            {
                message: 'Hosted Zone name (optional)',
                placeholder: 'example.com',
            },
        )

        if (prompts.isCancel(hostedZone)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        hostedZoneName = (hostedZone as string) || ''

        const useParentHostedZone = await fields.optionalGroup({
            message: 'Use parent hosted zone for DNS delegation?',
            initialValue: false,
        })

        if (prompts.isCancel(useParentHostedZone)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        if (useParentHostedZone) {
            const parentHostedZone = await fields.text(
                'awsRoute53ParentHostedZoneId',
                {
                    message: 'Parent Hosted Zone ID',
                    placeholder: '',
                    validate: value => {
                        if (!value)
                            return 'Parent Hosted Zone ID is required'
                    },
                },
            )

            if (prompts.isCancel(parentHostedZone)) {
                prompts.cancel('Setup cancelled')

                return null
            }

            awsRoute53ParentHostedZoneId = parentHostedZone as string
        }

        const logRetentionDays = await fields.select(
            'cloudwatchLogRetentionDays',
            {
                message: 'CloudWatch log retention period',
                options: [
                    {
                        value: 1,
                        label: '1 day',
                    },
                    {
                        value: 3,
                        label: '3 days',
                    },
                    {
                        value: 5,
                        label: '5 days',
                    },
                    {
                        value: 7,
                        label: '7 days',
                        hint: 'Recommended for development',
                    },
                    {
                        value: 14,
                        label: '14 days',
                    },
                    {
                        value: 30,
                        label: '30 days',
                        hint: 'Recommended for staging',
                    },
                    {
                        value: 60,
                        label: '60 days',
                    },
                    {
                        value: 90,
                        label: '90 days',
                        hint: 'Recommended for production',
                    },
                    {
                        value: 120,
                        label: '120 days',
                    },
                    {
                        value: 150,
                        label: '150 days',
                    },
                    {
                        value: 180,
                        label: '180 days (6 months)',
                    },
                    {
                        value: 365,
                        label: '365 days (1 year)',
                    },
                    {
                        value: 400,
                        label: '400 days',
                    },
                    {
                        value: 545,
                        label: '545 days (18 months)',
                    },
                    {
                        value: 731,
                        label: '731 days (2 years)',
                    },
                    {
                        value: 1096,
                        label: '1096 days (3 years)',
                    },
                    {
                        value: 1827,
                        label: '1827 days (5 years)',
                    },
                    {
                        value: 2192,
                        label: '2192 days (6 years)',
                    },
                    {
                        value: 2557,
                        label: '2557 days (7 years)',
                    },
                    {
                        value: 2922,
                        label: '2922 days (8 years)',
                    },
                    {
                        value: 3288,
                        label: '3288 days (9 years)',
                    },
                    {
                        value: 3653,
                        label: '3653 days (10 years)',
                    },
                ],
                initialValue: isLocal ? 7 : 30,
            },
        )

        if (prompts.isCancel(logRetentionDays)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        cloudwatchLogRetentionDays = logRetentionDays as number

        const containerInsightsEnabled = await fields.confirm(
            'cloudwatchContainerInsightsEnabled',
            {
                message: 'Enable ECS Container Insights?',
                initialValue: false,
            },
        )

        if (prompts.isCancel(containerInsightsEnabled)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        cloudwatchContainerInsightsEnabled = containerInsightsEnabled as boolean
    }

    // -------------------------------------------------------------------------
    // API Keys Section
    // -------------------------------------------------------------------------
    await fields.group('API Keys')

    prompts.log.info(
        c.dim('Leave empty to configure later'),
    )

    const openaiApiKey = await fields.text(
        'openaiApiKey',
        {
            message: 'OpenAI API Key',
            placeholder: 'sk-...',
        },
    )

    if (prompts.isCancel(openaiApiKey)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    const anthropicUseAwsBedrockInference = await fields.confirm(
        'anthropicUseAwsBedrockInference',
        {
            message: 'Run Anthropic inference through AWS Bedrock (uses your AWS SSO profile instead of an API key)?',
            initialValue: false,
        },
    )

    if (prompts.isCancel(anthropicUseAwsBedrockInference)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    let anthropicApiKey: string | symbol = fields.read('anthropicApiKey', '')

    if (!anthropicUseAwsBedrockInference) {
        anthropicApiKey = await fields.text(
            'anthropicApiKey',
            {
                message: 'Anthropic API Key',
                placeholder: 'sk-ant-...',
            },
        )

        if (prompts.isCancel(anthropicApiKey)) {
            prompts.cancel('Setup cancelled')

            return null
        }
    }

    const googleApiKey = await fields.text(
        'googleApiKey',
        {
            message: 'Google API Key',
            placeholder: 'AIza...',
        },
    )

    if (prompts.isCancel(googleApiKey)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    const googleVeoPersonGenerationProfile = await fields.select(
        'googleVeoPersonGenerationProfile',
        {
            message: 'Veo person-generation profile for your Google region',
            options: [
                {
                    value: 'standard',
                    label: 'Standard',
                    hint: 'Least restrictive Google allows: allow_all for text and extension, allow_adult for frame-conditioned',
                },
                {
                    value: 'restricted',
                    label: 'Restricted',
                    hint: 'For regions where Google only permits allow_adult',
                },
            ],
            initialValue: 'standard',
        },
    )

    if (prompts.isCancel(googleVeoPersonGenerationProfile)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    const stabilityUseAwsBedrockInference = await fields.confirm(
        'stabilityUseAwsBedrockInference',
        {
            message: 'Run Stability image generation through AWS Bedrock (uses your AWS SSO profile instead of an API key)?',
            initialValue: false,
        },
    )

    if (prompts.isCancel(stabilityUseAwsBedrockInference)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    let stableDiffusionApiKey: string | symbol = fields.read('stableDiffusionApiKey', '')

    if (!stabilityUseAwsBedrockInference) {
        stableDiffusionApiKey = await fields.text(
            'stableDiffusionApiKey',
            {
                message: 'Stable Diffusion API Key',
                placeholder: 'sk-...',
            },
        )

        if (prompts.isCancel(stableDiffusionApiKey)) {
            prompts.cancel('Setup cancelled')

            return null
        }
    }

    const arkApiKey = await fields.text(
        'arkApiKey',
        {
            message: 'BytePlus ModelArk API Key (ARK_API_KEY — for Seedance video; leave blank to skip)',
            placeholder: '...',
        },
    )

    if (prompts.isCancel(arkApiKey)) {
        prompts.cancel('Setup cancelled')

        return null
    }

    // Only ask for Stripe key if not using LocalAuth0 mock (real Auth0 = real payments)
    let stripePublicKey = fields.read('stripePublicKey', '')

    if (!useLocalAuth0Mock) {
        const stripeKey = await fields.text(
            'stripePublicKey',
            {
                message: 'Stripe Public Key',
                placeholder: 'pk_test_...',
            },
        )

        if (prompts.isCancel(stripeKey)) {
            prompts.cancel('Setup cancelled')

            return null
        }

        stripePublicKey = stripeKey as string
    }

    return {
        edits: partial ? fields : undefined,
        envFilePath,
        existingEnvContent,
        developerName: developerName as string,
        orgName: orgName as string,
        environment: environment as EnvironmentType,
        domainName,
        certificateEmail: certificateEmail as string,
        useLocalDynamoDB: useLocalDynamoDB as boolean,
        dynamodbEndpoint,
        useLocalAuth0Mock: useLocalAuth0Mock as boolean,
        auth0Domain,
        auth0ClientId,
        auth0Audience,
        natsApiNkeySeed: natsKeys.apiNkey.seed,
        natsApiNkeyPublic: natsKeys.apiNkey.public,
        natsFileConversionNkeySeed: natsKeys.fileConversionNkey.seed,
        natsFileConversionNkeyPublic: natsKeys.fileConversionNkey.public,
        natsCharacterFidelityNkeySeed: natsKeys.characterFidelityNkey.seed,
        natsCharacterFidelityNkeyPublic: natsKeys.characterFidelityNkey.public,
        natsBackupNkeySeed: natsKeys.backupNkey.seed,
        natsBackupNkeyPublic: natsKeys.backupNkey.public,
        natsOperatorNkeySeed: natsKeys.operatorNkey.seed,
        natsOperatorNkeyPublic: natsKeys.operatorNkey.public,
        natsAuthNkeySeed: natsKeys.authNkey.seed,
        natsAuthNkeyPublic: natsKeys.authNkey.public,
        natsAuthXkeySeed: natsKeys.authXkey.seed,
        natsAuthXkeyPublic: natsKeys.authXkey.public,
        natsLlmServiceNkeySeed: natsKeys.llmServiceNkey.seed,
        natsLlmServiceNkeyPublic: natsKeys.llmServiceNkey.public,
        natsNexNodeNkeySeed: natsKeys.nexNodeNkey.seed,
        natsNexNodeNkeyPublic: natsKeys.nexNodeNkey.public,
        natsSysUserPassword,
        natsCalloutPassword,
        configureAwsSso: configureAwsSso as boolean,
        awsSsoSessionName,
        awsSsoStartUrl,
        awsRegion,
        awsProfileName,
        awsAccountId,
        awsRoleName,
        configureAwsDeployment: configureAwsDeployment as boolean,
        hostedZoneDnsRoleArn,
        hostedZoneName,
        awsRoute53ParentHostedZoneId,
        cloudwatchLogRetentionDays,
        cloudwatchContainerInsightsEnabled,
        openaiApiKey: (openaiApiKey as string) || '',
        anthropicApiKey: (anthropicApiKey as string) || '',
        anthropicUseAwsBedrockInference: anthropicUseAwsBedrockInference as boolean,
        googleApiKey: (googleApiKey as string) || '',
        googleVeoPersonGenerationProfile: googleVeoPersonGenerationProfile as 'standard' | 'restricted',
        stableDiffusionApiKey: (stableDiffusionApiKey as string) || '',
        stabilityUseAwsBedrockInference: stabilityUseAwsBedrockInference as boolean,
        arkApiKey: (arkApiKey as string) || '',
        stripePublicKey: (stripePublicKey as string) || '',
    }
}

// ============================================================================
// File Generation
// ============================================================================

const withNatsRegistration = (content: string): string => {
    const updates = new EnvFileUpdates(content)

    for (const [name, value] of Object.entries(
        registrationEnvironment(
            parseEnv(content),
        ),
    ))
        updates.setValue(name, `'${value}'`)

    return updates.render()
}

const generateEnvFileContent = (config: EnvConfig): string => {
    const stageName = `${config.developerName}-${config.environment}`
    const isLocal = config.environment === 'local'

    const template = fs.readFileSync(
        path.join(TEMPLATES_DIR, 'env.template'),
        'utf-8',
    )

    const replacements: Record<string, string> = {
        '{{DOMAIN_NAME}}': config.domainName,
        '{{CERTIFICATE_EMAIL}}': config.certificateEmail,
        '{{STAGE}}': stageName.charAt(0).toUpperCase() + stageName.slice(1),
        '{{ORG_NAME}}': config.orgName,
        '{{ENVIRONMENT}}': config.environment,
        '{{STATE_STORAGE_URL}}': isLocal ? 'file:///var/opt/lixpi/.pulumi-local-state' : `s3://${config.developerName}-pulumi-${stageName}`,
        '{{AWS_PROFILE}}': config.edits
            ? config.awsProfileName
            : isLocal
                ? ''
                : (config.awsProfileName || `${config.developerName}-dev`),
        '{{AWS_REGION}}': config.awsRegion,
        '{{DYNAMODB_ENDPOINT}}': config.dynamodbEndpoint,
        '{{HOSTED_ZONE_DNS_ROLE_ARN}}': config.hostedZoneDnsRoleArn,
        '{{HOSTED_ZONE_NAME}}': config.hostedZoneName,
        '{{AWS_ROUTE53_PARENT_HOSTED_ZONE_ID}}': config.awsRoute53ParentHostedZoneId,
        '{{NATS_DEBUG_MODE}}': isLocal ? 'true' : 'false',
        '{{NATS_API_NKEY_SEED}}': config.natsApiNkeySeed,
        '{{NATS_API_NKEY_PUBLIC}}': config.natsApiNkeyPublic,
        '{{NATS_FILE_CONVERSION_NKEY_SEED}}': config.natsFileConversionNkeySeed,
        '{{NATS_FILE_CONVERSION_NKEY_PUBLIC}}': config.natsFileConversionNkeyPublic,
        '{{NATS_CHARACTER_FIDELITY_NKEY_SEED}}': config.natsCharacterFidelityNkeySeed,
        '{{NATS_CHARACTER_FIDELITY_NKEY_PUBLIC}}': config.natsCharacterFidelityNkeyPublic,
        '{{NATS_BACKUP_NKEY_SEED}}': config.natsBackupNkeySeed,
        '{{NATS_BACKUP_NKEY_PUBLIC}}': config.natsBackupNkeyPublic,
        '{{NATS_OPERATOR_NKEY_SEED}}': config.natsOperatorNkeySeed,
        '{{NATS_OPERATOR_NKEY_PUBLIC}}': config.natsOperatorNkeyPublic,
        '{{NATS_SYS_USER_PASSWORD}}': config.natsSysUserPassword,
        '{{NATS_CALLOUT_PASSWORD}}': config.natsCalloutPassword,
        '{{NATS_AUTH_NKEY_SEED}}': config.natsAuthNkeySeed,
        '{{NATS_AUTH_NKEY_PUBLIC}}': config.natsAuthNkeyPublic,
        '{{NATS_AUTH_XKEY_SEED}}': config.natsAuthXkeySeed,
        '{{NATS_AUTH_XKEY_PUBLIC}}': config.natsAuthXkeyPublic,
        '{{NATS_LLM_SERVICE_NKEY_SEED}}': config.natsLlmServiceNkeySeed,
        '{{NATS_LLM_SERVICE_NKEY_PUBLIC}}': config.natsLlmServiceNkeyPublic,
        '{{NATS_NEX_NODE_NKEY_SEED}}': config.natsNexNodeNkeySeed,
        '{{NATS_NEX_NODE_NKEY_PUBLIC}}': config.natsNexNodeNkeyPublic,
        '{{NATS_CORS_COMMENT}}': isLocal ? ' (local development - allow all origins)' : '',
        '{{NATS_ALLOWED_ORIGINS}}': isLocal
            ? '[]'
            : `["https://${config.domainName}","https://user-portal.${config.domainName}"]`,
        '{{ORIGIN_HOST_URL}}': isLocal ? 'http://localhost:3001' : `https://${config.domainName}`,
        '{{API_HOST_URL}}': isLocal ? 'http://localhost:3005' : `https://api.${config.domainName}`,
        '{{AUTH0_DOMAIN}}': config.auth0Domain,
        '{{AUTH0_AUDIENCE}}': config.auth0Audience,
        '{{MOCK_AUTH0}}': String(config.useLocalAuth0Mock),
        '{{MOCK_AUTH0_DOMAIN}}': config.useLocalAuth0Mock ? 'localhost:3000' : '',
        '{{MOCK_AUTH0_JWKS_URI}}': config.useLocalAuth0Mock ? 'http://lixpi-localauth0:3000/.well-known/jwks.json' : '',
        '{{SAVE_LLM_RESPONSES_TO_DEBUG_DIR}}': String(isLocal),
        '{{METRICS_ENABLED}}': 'false',
        '{{OPENAI_API_KEY}}': config.openaiApiKey,
        '{{ANTHROPIC_API_KEY}}': config.anthropicApiKey,
        '{{ANTHROPIC_USE_AWS_BEDROCK_INFERENCE}}': String(config.anthropicUseAwsBedrockInference),
        '{{GOOGLE_API_KEY}}': config.googleApiKey,
        '{{GOOGLE_VEO_PERSON_GENERATION_PROFILE}}': config.googleVeoPersonGenerationProfile,
        '{{STABLE_DIFFUSION_API_KEY}}': config.stableDiffusionApiKey,
        '{{STABILITY_USE_AWS_BEDROCK_INFERENCE}}': String(config.stabilityUseAwsBedrockInference),
        '{{ARK_API_KEY}}': config.arkApiKey,
        '{{VITE_MOCK_AUTH}}': String(config.useLocalAuth0Mock),
        '{{VITE_MOCK_AUTH0_DOMAIN}}': config.useLocalAuth0Mock ? 'localhost:3000' : '',
        '{{VITE_API_URL}}': isLocal ? 'http://localhost:3005' : `https://api.${config.domainName}`,
        '{{VITE_AUTH0_LOGIN_URL}}': isLocal ? 'http://localhost:3001/login' : `https://${config.domainName}/login`,
        '{{VITE_AUTH0_DOMAIN}}': config.auth0Domain.replace('https://', ''),
        '{{VITE_AUTH0_CLIENT_ID}}': config.auth0ClientId,
        '{{VITE_AUTH0_AUDIENCE}}': config.auth0Audience,
        '{{VITE_AUTH0_REDIRECT_URI}}': isLocal ? 'http://localhost:3001' : `https://${config.domainName}`,
        '{{VITE_USER_PORTAL_URL}}': isLocal ? 'http://localhost:3002' : `https://user-portal.${config.domainName}`,
        '{{VITE_STRIPE_PUBLIC_KEY}}': config.stripePublicKey,
        '{{VITE_NATS_SERVER}}': isLocal ? 'wss://localhost:9222' : `wss://nats.${config.domainName}`,
        '{{CLOUDWATCH_LOG_RETENTION_DAYS}}': String(config.cloudwatchLogRetentionDays),
        '{{CLOUDWATCH_CONTAINER_INSIGHTS_ENABLED}}': String(config.cloudwatchContainerInsightsEnabled),
    }

    let result = template

    for (const [placeholder, value] of Object.entries(replacements)) {
        result = result.replaceAll(placeholder, value)
    }

    return result
}

const generateAwsConfigContent = (config: EnvConfig): string => {
    const template = fs.readFileSync(
        path.join(TEMPLATES_DIR, 'aws-config.template'),
        'utf-8',
    )

    const replacements: Record<string, string> = {
        '{{SSO_SESSION_NAME}}': config.awsSsoSessionName,
        '{{SSO_START_URL}}': config.awsSsoStartUrl,
        '{{AWS_REGION}}': config.awsRegion,
        '{{AWS_PROFILE_NAME}}': config.awsProfileName,
        '{{AWS_ACCOUNT_ID}}': config.awsAccountId,
        '{{AWS_ROLE_NAME}}': config.awsRoleName,
    }

    let result = template

    for (const [placeholder, value] of Object.entries(replacements)) {
        result = result.replaceAll(placeholder, value)
    }

    return result
}

// ============================================================================
// File Writing
// ============================================================================

export const writeFiles = async (config: EnvConfig): Promise<void> => {
    const stageName = `${config.developerName}-${config.environment}`
    const envFilePath = config.envFilePath ?? path.join(WORKSPACE_DIR, `.env.${stageName}`)
    const awsConfigPath = path.join(
        WORKSPACE_DIR,
        '.aws',
        'config',
    )

    // Replacement was selected before collecting configuration values.
    const currentContent = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf-8') : undefined

    if (currentContent !== config.existingEnvContent)
        throw new Error('The configuration changed during setup. No updates were written; run setup again.')

    if (
        config.configureAwsSso
        && config.edits
    ) {
        const currentAws = fs.existsSync(awsConfigPath) ? fs.readFileSync(awsConfigPath, 'utf-8') : undefined

        if (currentAws !== config.edits.awsSource)
            throw new Error('The AWS configuration changed during setup. No updates were written; run setup again.')
    }

    const content = withNatsRegistration(config.edits ? config.edits.render(config) : generateEnvFileContent(config))

    if (content !== currentContent)
        fs.writeFileSync(envFilePath, content)

    prompts.log.success(`Saved ${c.green(
        path.basename(envFilePath),
    )}`)

    // Write AWS config if configured
    if (config.configureAwsSso) {
        if (config.edits) {
            const updatedAws = config.edits.renderAws(config)

            if (updatedAws !== config.edits.awsSource) {
                fs.mkdirSync(
                    path.dirname(awsConfigPath),
                    { recursive: true },
                )
                fs.writeFileSync(awsConfigPath, updatedAws)
            }

            return
        }

        const awsDir = path.dirname(awsConfigPath)

        if (!fs.existsSync(awsDir))
            fs.mkdirSync(awsDir, { recursive: true })

        if (fs.existsSync(awsConfigPath)) {
            const overwrite = await prompts.confirm({
                message: `File ${c.yellow('.aws/config')} already exists. Overwrite?`,
                initialValue: false,
            })

            if (
                prompts.isCancel(overwrite)
                || !overwrite
            )
                prompts.log.warn('Skipping .aws/config file generation')
            else {
                fs.writeFileSync(
                    awsConfigPath,
                    generateAwsConfigContent(config),
                )
                prompts.log.success(`Created ${c.green('.aws/config')}`)
            }
        } else {
            fs.writeFileSync(
                awsConfigPath,
                generateAwsConfigContent(config),
            )
            prompts.log.success(`Created ${c.green('.aws/config')}`)
        }
    }
}

// ============================================================================
// Main
// ============================================================================

const main = async (): Promise<void> => {
    const args = parseCliArgs()

    if (args.help) {
        printHelp()
        process.exit(0)
    }

    if (args.nonInteractive) {
        // Non-interactive mode
        if (
            !args.name
            || !args.env
        ) {
            debugError(
                c.red('Error: --name and --env are required in non-interactive mode'),
            )
            debugError('Run with --help for usage information')
            process.exit(1)
        }

        if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(args.name))
            throw new Error('Invalid developer name')

        const targetPath = path.join(WORKSPACE_DIR, `.env.${args.name}-${args.env}`)

        if (fs.existsSync(targetPath))
            throw new Error('Configuration already exists. Run interactive setup to choose a partial update or complete replacement.')

        const natsKeys = generateNatsKeys()

        const isLocalEnv = args.env === 'local'

        const config: EnvConfig = {
            developerName: args.name,
            orgName: 'Lixpi',
            environment: args.env,
            domainName: '',
            certificateEmail: isLocalEnv ? '' : `${args.name}@mail.com`,
            useLocalDynamoDB: args.env === 'local',
            dynamodbEndpoint: args.env === 'local' ? 'http://lixpi-dynamodb:8000' : '',
            useLocalAuth0Mock: args.env === 'local',
            auth0Domain: '',
            auth0ClientId: '',
            auth0Audience: 'http://localhost:3005',
            natsApiNkeySeed: natsKeys.apiNkey.seed,
            natsApiNkeyPublic: natsKeys.apiNkey.public,
            natsFileConversionNkeySeed: natsKeys.fileConversionNkey.seed,
            natsFileConversionNkeyPublic: natsKeys.fileConversionNkey.public,
            natsCharacterFidelityNkeySeed: natsKeys.characterFidelityNkey.seed,
            natsCharacterFidelityNkeyPublic: natsKeys.characterFidelityNkey.public,
            natsBackupNkeySeed: natsKeys.backupNkey.seed,
            natsBackupNkeyPublic: natsKeys.backupNkey.public,
            natsOperatorNkeySeed: natsKeys.operatorNkey.seed,
            natsOperatorNkeyPublic: natsKeys.operatorNkey.public,
            natsAuthNkeySeed: natsKeys.authNkey.seed,
            natsAuthNkeyPublic: natsKeys.authNkey.public,
            natsAuthXkeySeed: natsKeys.authXkey.seed,
            natsAuthXkeyPublic: natsKeys.authXkey.public,
            natsLlmServiceNkeySeed: natsKeys.llmServiceNkey.seed,
            natsLlmServiceNkeyPublic: natsKeys.llmServiceNkey.public,
            natsNexNodeNkeySeed: natsKeys.nexNodeNkey.seed,
            natsNexNodeNkeyPublic: natsKeys.nexNodeNkey.public,
            natsSysUserPassword: generateSecurePassword(28),
            natsCalloutPassword: generateSecurePassword(28),
            configureAwsSso: false,
            awsSsoSessionName: '',
            awsSsoStartUrl: '',
            awsRegion: 'us-east-1',
            awsProfileName: '',
            awsAccountId: '',
            awsRoleName: '',
            configureAwsDeployment: false,
            hostedZoneDnsRoleArn: '',
            hostedZoneName: '',
            awsRoute53ParentHostedZoneId: '',
            cloudwatchLogRetentionDays: 7,
            cloudwatchContainerInsightsEnabled: false,
            openaiApiKey: '',
            anthropicApiKey: '',
            googleApiKey: '',
            googleVeoPersonGenerationProfile: 'standard',
            stableDiffusionApiKey: '',
            arkApiKey: '',
            stripePublicKey: '',
        }

        await writeFiles(config)
        process.exit(0)
    }

    // Interactive mode
    const config = await runInteractivePrompts()

    if (!config)
        process.exit(1)

    // Summary
    prompts.log.step(
        c.bold(
            c.blue('Summary'),
        ),
    )

    const stageName = `${config.developerName}-${config.environment}`
    const isLocal = config.environment === 'local'
    debugLog()
    debugLog(`  ${c.dim('Stage:')}          ${c.cyan(stageName)}`)

    if (!isLocal)
        debugLog(`  ${c.dim('Domain:')}         ${c.cyan(config.domainName)}`)

    debugLog(`  ${c.dim('Environment:')}    ${c.cyan(config.environment)}`)
    debugLog(`  ${c.dim('Local DynamoDB:')} ${config.useLocalDynamoDB ? c.green('Yes') : c.yellow('No')}`)
    debugLog(`  ${c.dim('LocalAuth0:')}     ${config.useLocalAuth0Mock ? c.green('Yes') : c.yellow('No')}`)
    debugLog(`  ${c.dim('AWS SSO:')}        ${config.configureAwsSso ? c.green('Yes') : c.yellow('No')}`)
    debugLog(`  ${c.dim('AWS Deployment:')} ${config.configureAwsDeployment ? c.green('Yes') : c.yellow('No')}`)
    debugLog(`  ${c.dim('Log Retention:')} ${c.cyan(`${config.cloudwatchLogRetentionDays} days`)}`)
    debugLog(`  ${c.dim('Container Insights:')} ${config.cloudwatchContainerInsightsEnabled ? c.yellow('Enabled') : c.green('Disabled')}`)
    debugLog()

    const confirmed = await prompts.confirm({
        message: 'Create configuration files?',
        initialValue: true,
    })

    if (
        prompts.isCancel(confirmed)
        || !confirmed
    ) {
        prompts.cancel('Setup cancelled')
        process.exit(1)
    }

    await writeFiles(config)

    prompts.outro(
        c.green('Setup complete! 🎉'),
    )

    debugLog()
    debugLog(
        c.bold('Next steps:'),
    )
    const envFileName = config.envFilePath ? path.basename(config.envFilePath) : `.env.${stageName}`
    debugLog(`  1. Run ${c.cyan(`docker compose --env-file ${envFileName} up`)}`)

    if (config.configureAwsSso)
        debugLog(`  2. Run ${c.cyan('pnpm run aws-login')} to authenticate with AWS`)

    debugLog()
}

if (import.meta.main) {
    try {
        await main()
    } catch (error) {
        debugError(
            c.red('Error:'),
            error.message,
        )
        process.exit(1)
    }
}
