import { createInfrastructure } from './pulumiProgram.ts'

export const getStackArgs = (stackName: string): InlineProgramArgs => ({
    stackName,
    projectName: 'lixpi.ai',
    program: createInfrastructure,
})

export const getWorkspaceOptions = (): LocalWorkspaceOptions => ({
    projectSettings: {
        name: 'lixpi.ai',
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
})

export const awsConfig = (region: string) => ({
    'aws:region': { value: region },
})
