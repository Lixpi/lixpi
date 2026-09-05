import chalk from 'chalk'
import ora from 'ora'
import {
    LocalWorkspace,
    type Stack,
    type Deployment,
} from '@pulumi/pulumi/automation/index.js'
import * as aws from '@pulumi/aws'
import { info } from '@lixpi/debug-tools'
import {
    startOutputSession,
    printPulumiLine,
} from './outputFormatter.ts'

import {
    getStackArgs,
    getWorkspaceOptions,
    awsConfig,
} from './workspace.ts'

export class StackManager {
    private stackName: string
    private region: string
    private stack: Stack | null = null

    constructor(stackName: string, region: string) {
        this.stackName = stackName
        this.region = region
    }

    // Initialize the Pulumi stack if not already initialized
    async init() {
        if (this.stack) return

        const workspaceOptions = getWorkspaceOptions()
        const stackArgs = getStackArgs(this.stackName)
        this.stack = await LocalWorkspace.createOrSelectStack(stackArgs, workspaceOptions)

        await this.stack.workspace.installPlugin('aws', 'v4.0.0')
        const config = awsConfig(this.region)

        await Promise.all(
            Object.entries(config).map(([key, val]) => this.stack!.setConfig(key, val)),
        )

        info('Pulumi initialized', `Stack: ${chalk.cyan(this.stackName)} | Region: ${chalk.cyan(this.region)}`)
    }

    // Apply infrastructure update
    async up() {
        await this.init()
        startOutputSession()

        const spinner = ora({
            text: chalk.blue('Applying stack changes...'),
            spinner: 'dots',
            color: 'cyan',
        }).start()

        try {
            const res = await this.stack!.up({
                onOutput: text => {
                    spinner.stop()
                    printPulumiLine(text)
                    spinner.start()
                },
            })
            spinner.succeed(chalk.green('Pulumi Update Completed'))
            this.printChangesSummary(res.summary.resourceChanges)
        } catch (error) {
            spinner.fail(chalk.red('Pulumi Update Failed'))
            // Bubble up without re-printing the full diagnostics (already streamed)
            throw error
        }
    }

    // Preview infrastructure update
    async preview() {
        await this.init()
        startOutputSession()

        const spinner = ora({
            text: chalk.blue('Gathering preview changes...'),
            spinner: 'dots',
            color: 'cyan',
        }).start()

        try {
            const res = await this.stack!.preview({
                onOutput: text => {
                    spinner.stop()
                    printPulumiLine(text)
                    spinner.start()
                },
            })
            spinner.succeed(chalk.green('Preview Completed Successfully'))
            this.printChangesSummary(res.changeSummary)
        } catch (error) {
            spinner.fail(chalk.red('Preview Failed'))
            throw error
        }
    }

    // Destroy Pulumi stack resources
    async destroy(options?: { destroy?: boolean }) {
        await this.init()
        startOutputSession()

        const force = options?.destroy === true
        const spinner = ora({
            text: chalk.red(force ? 'Force destroying stack resources...' : 'Destroying stack resources...'),
            spinner: 'dots',
            color: 'red',
        }).start()

        try {
            if (force) {
                info('Force Destroy', chalk.red('Force destroy flag enabled.'))
            }
            const res = await this.stack!.destroy({
                onOutput: text => {
                    spinner.stop()
                    printPulumiLine(text)
                    spinner.start()
                },
                ...(force ? { destroy: true } : {}),
            })
            spinner.succeed(chalk.green('Pulumi Destroy Completed Successfully'))
            this.printChangesSummary(res.summary.resourceChanges)
        } catch (error) {
            spinner.fail(chalk.red('Pulumi Destroy Failed'))
            throw error
        }
    }

    // Refresh stack state
    async refresh(options?: { clearPendingCreates?: boolean }) {
        await this.init()
        startOutputSession()

        const spinner = ora({
            text: chalk.blue('Refreshing stack state...'),
            spinner: 'dots',
            color: 'cyan',
        }).start()

        try {
            await this.stack!.refresh({
                onOutput: text => {
                    spinner.stop()
                    printPulumiLine(text)
                    spinner.start()
                },
                ...(options?.clearPendingCreates ? { clearPendingCreates: true } : {}),
            })
            spinner.succeed(chalk.green('Pulumi Refresh Completed Successfully'))
        } catch (error) {
            spinner.fail(chalk.red('Pulumi Refresh Failed'))
            throw error
        }
    }

    // Cancel ongoing Pulumi operation
    async cancel() {
        await this.init()
        try {
            await this.stack!.cancel()
            info('Pulumi Cancel', chalk.green('Operation cancelled successfully.'))
        } catch (error) {
            // Bubble up
            throw error
        }
    }

    // Display stack outputs
    async outputs() {
        await this.init()
        const outs = await this.stack!.outputs()

        console.log(chalk.bold('\nStack Outputs:'))
        console.log(chalk.gray('─'.repeat(50)))

        Object.entries(outs).forEach(([key, output]) => {
            console.log(`${chalk.cyan(key)}: ${chalk.yellow(output.value)}`)
        })

        console.log(chalk.gray('─'.repeat(50)))
    }

    // Export current stack state
    async exportStack(): Promise<string> {
        await this.init()
        const deployment = await this.stack!.exportStack()

        return JSON.stringify(deployment.deployment, null, 2)
    }

    // Import stack state
    async importStack(state: string) {
        await this.init()
        // Import expects a Deployment shape; accept JSON string and parse
        const deployment: Deployment = JSON.parse(state)
        await this.stack!.importStack(deployment)

        info('Pulumi Import Stack', chalk.green('Successfully imported stack state.'))
    }

    // Create new Pulumi Stack explicitly
    async createStack() {
        const workspace = await LocalWorkspace.create(getWorkspaceOptions())
        const created = await workspace.createStack(this.stackName)
        // Some type defs may mark createStack as void; cast defensively
        this.stack = created as unknown as Stack

        info('Stack Created', chalk.green(this.stackName))
    }

    // Remove existing Pulumi Stack explicitly
    async removeStack() {
        const workspace = await LocalWorkspace.create(getWorkspaceOptions())
        await workspace.removeStack(this.stackName)

        info('Stack Removed', chalk.red(this.stackName))
    }

    // List available Pulumi stacks
    async listStacks(): Promise<void> {
        const workspace = await LocalWorkspace.create(getWorkspaceOptions())
        const stacks = await workspace.listStacks()

        console.log(chalk.bold('\nAvailable Stacks:'))
        console.log(chalk.gray('─'.repeat(50)))

        stacks.forEach(s => {
            console.log(`- ${chalk.cyan(s.name)}`)
        })

        console.log(chalk.gray('─'.repeat(50)))
    }

    // Clean all images from ECR repositories (not supported in Pulumi Automation API)
    async cleanEcrRepositories() {
        // TODO
    }

    // Helper to print Pulumi change summary in formatted style
    private printChangesSummary(changes: any) {
        console.log(chalk.bold('\nResource Changes:'))
        console.log(chalk.gray('─'.repeat(50)))

        if (changes) {
            if (changes.create) console.log(chalk.green(`✓ Created: ${changes.create}`))
            if (changes.update) console.log(chalk.yellow(`↻ Updated: ${changes.update}`))
            if (changes.delete) console.log(chalk.red(`✗ Deleted: ${changes.delete}`))
            if (changes.replace) console.log(chalk.magenta(`↺ Replaced: ${changes.replace}`))
            if (changes.same) console.log(chalk.blue(`≡ Unchanged: ${changes.same}`))
        }

        console.log(chalk.gray('─'.repeat(50)))
    }
}
