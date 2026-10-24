import {
    localMockConfiguration,
    LocalMockAccount,
} from './local-mock-account.ts'

const [command = 'load', organizationId, ...extra] = process.argv.slice(2)

if (
    !['load', 'validate', 'repair'].includes(command)
    || extra.length
    || (command === 'repair' ? !organizationId : organizationId)
)
    throw new Error('Usage: fixture:local [load|validate|repair <existing-organization-id|new>]')

const configuration = localMockConfiguration(process.env)

if (configuration) {
    const fixture = new LocalMockAccount(configuration)

    try {
        if (command === 'validate')
            await fixture.validate()
        else
            await fixture.load(command === 'repair' ? organizationId : undefined)

        process.stdout.write('Local mock account fixture is complete.\n')
    } finally {
        fixture.destroy()
    }
} else
    process.stdout.write('Real Auth0 mode selected; mock fixture skipped.\n')
