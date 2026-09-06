import process from 'process'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { err } from '@lixpi/debug-tools'
import { endOutputSession } from './outputFormatter.ts'

import { StackManager } from './stackManager.ts'

const {
    AWS_REGION,
    STAGE,
} = process.env

const cli = yargs(
    hideBin(process.argv),
)
    .usage('Usage: $0 <command> [options]')
    .option(
        'stack',
        {
            alias: 's',
            describe: 'Stack name',
            default: STAGE,
            type: 'string',
        },
    )
    .option(
        'region',
        {
            alias: 'r',
            describe: 'AWS region',
            default: AWS_REGION,
            type: 'string',
        },
    )
    .command('init', 'Initialize stack')
    .command('up', 'Update stack')
    .command('preview', 'Preview stack changes')
    .command('destroy', 'Destroy stack')
    .command('force-destroy', 'Force destroy stack resources')
    .command('clean-ecr', 'Delete all images from ECR repositories before destroying')
    .command('refresh', 'Refresh the stack state')
    .command('outputs', 'Show stack outputs')
    .command('list-stacks', 'List stacks')
    .command('create-stack', 'Create a stack explicitly')
    .command('remove-stack', 'Explicitly remove stack')
    .command('cancel', 'Cancel ongoing Pulumi operation')
    .example('$0 init --stack=dev', 'Init stack named "dev"')
    .demandCommand(1, 'Please supply a valid command.')
    .help()
    .alias('help', 'h')

const execCommand = async () => {
    const argv = await cli.parseAsync()
    const command = argv._[0] as string
    const manager = new StackManager(argv.stack, argv.region)

    try {
        switch (command) {
            case 'init':
                await manager.init()

                break
            case 'up':
                await manager.up()

                break
            case 'preview':
                await manager.preview()

                break
            case 'destroy':
                await manager.destroy()

                break
            case 'force-destroy':
                await manager.cleanEcrRepositories()
                await manager.destroy({ destroy: true })

                break
            case 'clean-ecr':
                await manager.cleanEcrRepositories()

                break
            case 'refresh':
                await manager.refresh({
                    clearPendingCreates: true,
                })

                break
            case 'outputs':
                await manager.outputs()

                break
            case 'list-stacks':
                await manager.listStacks()

                break
            case 'create-stack':
                await manager.createStack()

                break
            case 'remove-stack':
                await manager.removeStack()

                break
            case 'cancel':
                await manager.cancel()

                break
            default:
                err('Invalid command', command)
                process.exit(1)
        }
    } catch (error) {
        // End any dedupe session so next command starts fresh
        endOutputSession()
        const msg = (error as Error)?.message?.split('\n')[0] || String(error)
        err('Pulumi Command Failed', msg)
        process.exit(1)
    }
}

try {
    await execCommand()
} catch (e) {
    const msg = (e as Error)?.message?.split('\n')[0] || String(e)
    err('Unexpected Error', msg)
    process.exit(1)
}
