import process from 'process'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { err } from '@lixpi/debug-tools'
import { endOutputSession } from './outputFormatter.ts'

import {
    blockedReason,
    buildCatalog,
    PULUMI_COMMANDS,
} from './pulumi-commands.ts'
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
    .command('catalog', 'Print the commands and deployment target as JSON')
    .example('$0 init --stack=dev', 'Init stack named "dev"')
    .demandCommand(1, 'Please supply a valid command.')
    .help()
    .alias('help', 'h')

for (const command of PULUMI_COMMANDS)
    cli.command(command.name, command.description)

const execCommand = async () => {
    const argv = await cli.parseAsync()
    const name = argv._[0] as string

    if (name === 'catalog') {
        process.stdout.write(`${JSON.stringify(
            buildCatalog(),
        )}\n`)

        return
    }

    const command = PULUMI_COMMANDS.find(candidate => candidate.name === name)

    if (!command) {
        err('Invalid command', name)
        process.exit(1)
    }

    const blocked = blockedReason(command)

    if (blocked) {
        err('Pulumi Command Refused', blocked)
        process.exit(1)
    }

    try {
        await command.run(
            new StackManager(argv.stack, argv.region),
            argv._.slice(1).map(String),
        )
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
