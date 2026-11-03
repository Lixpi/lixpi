import {
    type ConfigMap,
    type InlineProgramArgs,
    type LocalWorkspaceOptions,
} from '@pulumi/pulumi/automation/index.js'

export const getProgramName = (): 'application' | 'static-website' => {
    const program = process.env.PULUMI_PROGRAM ?? 'application'

    if (
        program !== 'application'
        && program !== 'static-website'
    )
        throw new Error(`Unsupported PULUMI_PROGRAM: ${program}`)

    return program
}

const getProjectName = (): string => {
    const project = process.env.PULUMI_PROJECT_NAME

    if (project)
        return project

    if (getProgramName() === 'static-website')
        throw new Error('PULUMI_PROJECT_NAME is required for a static website deployment')

    return 'lixpi.ai'
}

export const requiresExistingStack = (): boolean => {
    const value = process.env.PULUMI_REQUIRE_EXISTING_STACK

    if (
        value
        && value !== 'true'
        && value !== 'false'
    )
        throw new Error('PULUMI_REQUIRE_EXISTING_STACK must be true or false')

    return !value ? getProgramName() === 'static-website' : value === 'true'
}

export const getStackArgs = (stackName: string): InlineProgramArgs => ({
    stackName,
    projectName: getProjectName(),
    program: async () => {
        if (getProgramName() === 'static-website') {
            const { createStaticWebsiteInfrastructure } = await import('./static-website/program.ts')

            return createStaticWebsiteInfrastructure()
        }

        const { createInfrastructure } = await import('./pulumiProgram.ts')

        return createInfrastructure()
    },
})

export const getWorkspaceOptions = (): LocalWorkspaceOptions => {
    if (
        getProgramName() === 'static-website'
        && !process.env.STATE_STORAGE_URL
    )
        throw new Error('STATE_STORAGE_URL is required for a static website deployment')

    return {
        projectSettings: {
            name: getProjectName(),
            runtime: {
                name: 'nodejs',
                options: {
                    typescript: true,
                    packagemanager: 'pnpm',
                },
            },
            backend: {
                url: process.env.STATE_STORAGE_URL,
            },
        },
    }
}

export const awsConfig = (region: string): ConfigMap => {
    const config: ConfigMap = {
        'aws:region': { value: region },
    }
    const accountId = process.env.AWS_EXPECTED_ACCOUNT_ID

    if (
        getProgramName() === 'static-website'
        && !accountId
    )
        throw new Error('AWS_EXPECTED_ACCOUNT_ID is required for a static website deployment')

    if (accountId) {
        if (!/^\d{12}$/.test(accountId))
            throw new Error('AWS_EXPECTED_ACCOUNT_ID must contain twelve digits')

        config['aws:allowedAccountIds'] = { value: JSON.stringify([accountId]) }
    }

    return config
}
