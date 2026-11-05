import * as fs from 'node:fs'
import * as path from 'node:path'
import {
    type ServiceGroup,
} from './service-tree.ts'

export const CONSOLE_CONFIG_PATH = 'dev-tools/dev-console/console.config.json'

export type ConsoleChoice = {
    value: string
    label: string
    hint?: string
}

export type ConsoleOption = {
    name: string
    label: string
    choices: ConsoleChoice[]
}

export type ConsoleStep =
    | { type: 'env-file' }
    | { type: 'docker-prune' }
    | {
        type: 'confirm'
        message: string
    }
    | {
        type: 'choices'
        message: string
        options?: ConsoleOption[]
        services?: {
            composeFile: string
            baseProfile?: string
            groups: ServiceGroup[]
        }
    }

export type ConsoleAction = {
    id: string
    label: string
    hint?: string

    // `shared:<name>` runs Lixpi's actions/<name>.sh, `local:<name>` runs the launching
    // repository's own.
    script: string

    // Fixed values for the script. run-console.sh exports each as
    // LIXPI_CONSOLE_OPTION_<NAME>.
    params?: Record<string, string>

    // Comes back to the menu after the script finishes, for an action that prepares
    // something the next action uses. Every other action ends the console.
    returnToMenu?: boolean

    // An environment file every run uses, instead of asking for one.
    envFile?: string
    steps?: ConsoleStep[]
}

export type ConsoleConfig = {
    title: string
    actions: ConsoleAction[]
}

const SCRIPT_PATTERN = /^(?:shared|local):[a-z0-9-]+$/u

// A typo here would otherwise surface only when someone picks that menu entry.
export const parseConsoleConfig = (text: string): ConsoleConfig => {
    const config = JSON.parse(text) as ConsoleConfig

    if (
        typeof config.title !== 'string'
        || !Array.isArray(config.actions)
        || !config.actions.length
    )
        throw new Error('The console config needs a title and at least one action.')

    for (const action of config.actions) {
        if (
            !action.id
            || !action.label
        )
            throw new Error('Every console action needs an id and a label.')

        if (!SCRIPT_PATTERN.test(action.script ?? ''))
            throw new Error(`Console action ${action.id} needs a script named shared:<name> or local:<name>.`)
    }

    return config
}

export const readConsoleConfig = (workspacePath: string): ConsoleConfig => parseConsoleConfig(
    fs.readFileSync(
        path.join(workspacePath, CONSOLE_CONFIG_PATH),
        'utf8',
    ),
)
