import * as prompts from '@clack/prompts'
import { readConsoleConfig } from './console-config.ts'
import {
    DevConsoleWizard,
    renderConsolePlan,
} from './dev-console-wizard.ts'

const WORKSPACE_PATH = '/workspace'

// Neither stream is a terminal here: stdout carries the plan and stderr is piped
// through Compose. Clack measures both, so they take the host terminal's size.
const adoptHostTerminalSize = (): void => {
    const columns = Number(process.env.LIXPI_TERMINAL_COLUMNS)
    const rows = Number(process.env.LIXPI_TERMINAL_ROWS)

    for (const stream of [process.stdout, process.stderr]) {
        if (columns > 0)
            stream.columns = columns

        if (rows > 0)
            stream.rows = rows
    }
}

try {
    adoptHostTerminalSize()

    const plan = await new DevConsoleWizard(
        WORKSPACE_PATH,
        readConsoleConfig(WORKSPACE_PATH),
        {
            entry: process.env.LIXPI_CONSOLE_ENTRY,
            dockerUsage: process.env.LIXPI_DOCKER_USAGE,
        },
    ).run()

    process.stdout.write(
        renderConsolePlan(plan),
    )
} catch (error) {
    prompts.cancel(error instanceof Error ? error.message : String(error), { output: process.stderr })
    process.exitCode = 1
} finally {
    process.stdin.destroy()
}
