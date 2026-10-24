import { randomBytes } from 'node:crypto'
import {
    lstatSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
    existsSync,
} from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { registrationEnvironment } from '@lixpi/nats-subject-registry/registration'
import {
    EnvFileUpdates,
    envLiteral,
} from './environment-file.ts'

// Preparing the file does not restart any service. During release, restart the
// enforcing API/brokers first and the browser last, after Auth0 is configured.
export class LocalAccountAuthConfiguration {
    static render(source: string): string {
        const values = parseEnv(source)

        if (values.ENVIRONMENT !== 'local')
            throw new Error('This cutover command accepts only a local environment')

        const tenant = values.AUTH0_TENANT_DOMAIN

        if (
            !tenant
            || !/^[a-z0-9-]+(?:\.[a-z]{2})?\.auth0\.com$/.test(tenant)
            || !values.DOMAIN_NAME
            || !values.VITE_AUTH0_CLIENT_ID
            || !values.NATS_REGISTRATION_AUTHORITY_SEED
            || !values.NATS_APPLICATION_REGISTRATION
            || !values.ACCOUNT_ADMISSION_STREAM
        )
            throw new Error('Complete local Auth0, signed NATS registration and admission stream configuration first')

        if (
            values.AUTH0_USE_DEVELOPER_KEYS
            && !['true', 'false'].includes(values.AUTH0_USE_DEVELOPER_KEYS)
        )
            throw new Error('AUTH0_USE_DEVELOPER_KEYS must be true or false')

        const domain = values.AUTH0_USE_DEVELOPER_KEYS === 'false' ? `auth.${values.DOMAIN_NAME}` : tenant
        const updates = new EnvFileUpdates(source)

        for (const [name, value] of Object.entries({
            MOCK_AUTH0: 'false',
            VITE_MOCK_AUTH: 'false',
            ACCOUNT_ADMISSION_ENABLED: 'true',
            AUTH0_DOMAIN: `https://${domain}`,
            VITE_AUTH0_DOMAIN: domain,
        }))
            updates.setValue(
                name,
                envLiteral(value),
            )

        const configured = parseEnv(
            updates.render(),
        )
        const registration = registrationEnvironment(configured)
        const envelope = JSON.parse(registration.NATS_APPLICATION_REGISTRATION)
        const manifest = JSON.parse(
            Buffer.from(envelope.payload, 'base64').toString('utf8'),
        )
        const browser = manifest.browsers?.find((profile: { issuer: string }) => profile.issuer === `https://${domain}/`)

        if (
            !browser?.admission
            || browser.admission.stream !== configured.ACCOUNT_ADMISSION_STREAM
            || browser.audience !== configured.AUTH0_API_IDENTIFIER
        )
            throw new Error('The configuration image generated an incomplete account policy. Rebuild lixpi-config-utils before retrying; no environment changes were saved')

        for (const [name, value] of Object.entries(registration))
            updates.setValue(
                name,
                envLiteral(value),
            )

        return updates.render()
    }

    static run(
        command: 'preview-local-account-auth' | 'setup-local-account-auth',
        filename: string,
        workspace = '/workspace',
    ): void {
        if (!/^\.env\.[A-Za-z0-9_-]+$/.test(filename))
            throw new Error('Select an explicit .env.<name> file')

        const target = join(workspace, filename)
        const stat = lstatSync(target)

        if (
            !stat.isFile()
            || stat.isSymbolicLink()
            || stat.size > 2 * 1024 * 1024
        )
            throw new Error('Local account configuration requires a bounded regular file')

        const source = readFileSync(target, 'utf8')
        const desired = this.render(source)

        if (
            command === 'setup-local-account-auth'
            && desired !== source
        ) {
            const temporary = `${target}.${randomBytes(12).toString('hex')}.tmp`

            try {
                writeFileSync(
                    temporary,
                    desired,
                    {
                        mode: 0o600,
                        flag: 'wx',
                    },
                )

                if (readFileSync(target, 'utf8') !== source)
                    throw new Error('Configuration changed during preparation; retry without overwriting it')

                renameSync(temporary, target)
            } finally {
                if (existsSync(temporary))
                    unlinkSync(temporary)
            }
        }

        const values = parseEnv(desired)
        process.stdout.write(
            `${JSON.stringify({
                command,
                configuration: filename,
                changed: desired !== source,
                saved: command === 'setup-local-account-auth',
                loginDomain: values.VITE_AUTH0_DOMAIN,
                accountAdmissionEnabled: true,
                servicesRestarted: false,
            })}\n`,
        )
    }
}
