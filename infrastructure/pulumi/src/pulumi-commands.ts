import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import {
    type StackManager,
} from './stackManager.ts'
import {
    getProgramName,
    requiresExistingStack,
} from './workspace.ts'

// What a command does to the deployment. The dev console asks for confirmation before
// a change, and only `read` commands may run against a profile the project rejects.
export type CommandEffect = 'read' | 'change' | 'destroy'

export type CommandArgument = {
    name: string
    prompt: string
}

type PulumiCommand = {
    name: string
    label: string
    description: string
    effect: CommandEffect
    localOnly?: boolean
    applicationOnly?: boolean
    needsNewStacks?: boolean
    arguments?: CommandArgument[]
    run: (
        manager: StackManager,
        args: string[],
    ) => Promise<void> | void
}

const runLocalScript = (
    script: string,
    args: string[] = [],
): void => {
    const result = spawnSync(
        process.execPath,
        [script, ...args],
        { stdio: 'inherit' },
    )

    if (result.status !== 0)
        throw new Error(`${script} stopped with exit status ${result.status}`)
}

// Everything this service can do. The CLI and the dev console both read this list, so
// a new command only needs adding here.
export const PULUMI_COMMANDS: PulumiCommand[] = [
    {
        name: 'preview',
        label: 'Preview changes',
        description: 'Test run that shows what would change',
        effect: 'read',
        run: manager => manager.preview(),
    },
    {
        name: 'up',
        label: 'Deploy',
        description: 'Apply the changes',
        effect: 'change',
        run: manager => manager.up(),
    },
    {
        name: 'refresh',
        label: 'Sync state',
        description: 'Reconcile Pulumi state with what actually exists',
        effect: 'change',
        run: manager => manager.refresh({ clearPendingCreates: true }),
    },
    {
        name: 'outputs',
        label: 'Show outputs',
        description: 'Endpoint URLs and IDs of the stack',
        effect: 'read',
        run: manager => manager.outputs(),
    },
    {
        name: 'list-stacks',
        label: 'List stacks',
        description: 'Stacks in the configured state backend',
        effect: 'read',
        run: manager => manager.listStacks(),
    },
    {
        name: 'init',
        label: 'Initialize Pulumi config',
        description: 'Select the stack and write its AWS settings',
        effect: 'change',
        run: manager => manager.init(),
    },
    {
        name: 'create-stack',
        label: 'Create stack',
        description: 'Create the stack explicitly',
        effect: 'change',
        needsNewStacks: true,
        run: manager => manager.createStack(),
    },
    {
        name: 'cancel',
        label: 'Cancel running operation',
        description: 'Stop a Pulumi operation that is in progress',
        effect: 'change',
        run: manager => manager.cancel(),
    },
    {
        name: 'clean-ecr',
        label: 'Clean ECR images',
        description: 'Not implemented yet, so this currently deletes nothing',
        effect: 'change',
        applicationOnly: true,
        run: manager => manager.cleanEcrRepositories(),
    },
    {
        name: 'destroy',
        label: 'Destroy stack',
        description: 'Delete every resource in the stack',
        effect: 'destroy',
        run: manager => manager.destroy(),
    },
    {
        name: 'force-destroy',
        label: 'Force destroy stack',
        description: 'Clean ECR images, then delete every resource in the stack',
        effect: 'destroy',
        run: async manager => {
            await manager.cleanEcrRepositories()
            await manager.destroy({ destroy: true })
        },
    },
    {
        name: 'remove-stack',
        label: 'Remove stack',
        description: 'Remove the stack record from the state backend',
        effect: 'destroy',
        needsNewStacks: true,
        run: manager => manager.removeStack(),
    },
    {
        name: 'local-init',
        label: 'Initialize local DynamoDB tables',
        description: 'Create the tables in the local Docker database',
        effect: 'change',
        localOnly: true,
        applicationOnly: true,
        run: () => runLocalScript('src/local-dynamodb-init.ts'),
    },
    {
        name: 'local-fixture-load',
        label: 'Load the local mock account',
        description: 'Write the mock account fixture to local DynamoDB',
        effect: 'change',
        localOnly: true,
        applicationOnly: true,
        run: () => runLocalScript('src/local-mock-account-cli.ts', ['load']),
    },
    {
        name: 'local-fixture-validate',
        label: 'Validate the local mock account',
        description: 'Check the mock account fixture in local DynamoDB',
        effect: 'read',
        localOnly: true,
        applicationOnly: true,
        run: () => runLocalScript('src/local-mock-account-cli.ts', ['validate']),
    },
    {
        name: 'local-fixture-repair',
        label: 'Repair the local mock account',
        description: 'Repair the mock account fixture for one organization',
        effect: 'change',
        localOnly: true,
        applicationOnly: true,
        arguments: [{
            name: 'organization',
            prompt: 'Which organization ID, or "new"?',
        }],
        run: (_manager, args) => runLocalScript('src/local-mock-account-cli.ts', ['repair', ...args]),
    },
]

const allowedAwsProfiles = (env: NodeJS.ProcessEnv): string[] =>
    (env.PULUMI_ALLOWED_AWS_PROFILES ?? '')
        .split(',').map(profile => profile.trim()).filter(Boolean)

// Why this command can't run with the selected configuration, if it can't. This is the
// one place that decides, so a direct CLI call is refused the same way as the console.
export const blockedReason = (
    command: PulumiCommand,
    env: NodeJS.ProcessEnv = process.env,
): string | undefined => {
    const isLocal = env.ENVIRONMENT === 'local'

    if (
        command.localOnly
        && !isLocal
    )
        return 'Only for a local environment'

    if (
        command.needsNewStacks
        && requiresExistingStack()
    )
        return 'This project only uses its existing stack'

    if (command.effect === 'read')
        return undefined

    const allowed = allowedAwsProfiles(env)

    if (
        allowed.length
        && !allowed.includes(env.AWS_PROFILE ?? '')
    )
        return `This project only deploys to AWS profile ${allowed.join(' or ')}, and this configuration uses ${env.AWS_PROFILE || 'no profile'}`

    return undefined
}

const configuredAccount = (
    profile: string | undefined,
    configPath: string,
): string | undefined => {
    if (
        !profile
        || !fs.existsSync(configPath)
    )
        return undefined

    const section = fs
        .readFileSync(configPath, 'utf8')
        .split(/^\[/mu).find(part => part.startsWith(`profile ${profile}]`))

    return section?.match(/^sso_account_id\s*=\s*(\d+)/mu)?.[1]
}

export const describeTarget = (
    env: NodeJS.ProcessEnv = process.env,
    configPath = '/root/.aws/config',
): {
    summary: string
    rows: {
        label: string
        value: string
    }[]
} => {
    const program = getProgramName()
    const account = env.AWS_EXPECTED_ACCOUNT_ID || configuredAccount(env.AWS_PROFILE, configPath)
    const isLocal = env.ENVIRONMENT === 'local' && program === 'application'
    const place = isLocal
        ? 'local Docker resources only, nothing in AWS'
        : `AWS account ${account ?? 'unknown'} (profile ${env.AWS_PROFILE || 'not set'})`
    const rows = [
        ['Deploys to', place],
        ['Environment', env.ENVIRONMENT],
        ['Program', program],
        ['Project', env.PULUMI_PROJECT_NAME],
        ['Stack', env.STAGE],
        ['Region', env.AWS_REGION],
        ['Domain', env.DOMAIN_NAME],
        ['State backend', env.STATE_STORAGE_URL],
    ].filter((row): row is [string, string] => Boolean(row[1]))

    return {
        summary: `stack ${env.STAGE ?? 'unknown'} in ${place}`,
        rows: rows.map(
            ([label, value]) => ({
                label,
                value,
            }),
        ),
    }
}

// The service's own description of itself, which the dev console renders as a menu.
// Commands that can't apply to this program at all are left out.
export const buildCatalog = (env: NodeJS.ProcessEnv = process.env) => ({
    target: describeTarget(env),
    commands: PULUMI_COMMANDS.filter(command => !command.applicationOnly || getProgramName() === 'application').map(command => {
        const blocked = blockedReason(command, env)

        return {
            name: command.name,
            label: command.label,
            description: command.description,
            effect: command.effect,
            arguments: command.arguments ?? [],
            available: !blocked,
            blockedReason: blocked,
        }
    }),
})
