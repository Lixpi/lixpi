import * as fs from 'node:fs'
import * as path from 'node:path'

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

    // Whether the row can change depends on the host, such as what a Docker volume
    // holds, which the console can't see. Before the step, the console asks the action's
    // script, and a row the script reports as unavailable stays on its first choice.
    reported?: true
}

export type ConsoleStep =
    | { type: 'env-file' }
    | { type: 'docker-prune' }
    | { type: 'service-commands' }
    | {
        type: 'confirm'
        message: string
    }
    | {
        type: 'choices'
        message: string
        options?: ConsoleOption[]

        // Shows the service tree, read from infrastructure/docker. The selection
        // starts that directory's stack with its base profile.
        services?: true
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

// A repository action can inherit one of Lixpi's own actions instead of copying it.
// It keeps the parent's script and steps, may replace the label and hint, adds params,
// and adds rows to the parent's choices step.
export type InheritingConsoleAction = {
    id: string
    extends: string
    label?: string
    hint?: string
    params?: Record<string, string>
    returnToMenu?: boolean
    envFile?: string
    options?: ConsoleOption[]
}

export type ConsoleConfig = {
    title: string
    actions: ConsoleAction[]
}

type ConsoleConfigSource = {
    title: string
    actions: (ConsoleAction | InheritingConsoleAction)[]
}

const SCRIPT_PATTERN = /^(?:shared|local):[a-z0-9-]+$/u
const EXTENDS_PATTERN = /^shared:[a-z0-9-]+$/u
const SHARED_PREFIX = 'shared:'

const isInheriting = (action: ConsoleAction | InheritingConsoleAction): action is InheritingConsoleAction => 'extends' in action

const readSource = (text: string): ConsoleConfigSource => {
    const config = JSON.parse(text) as ConsoleConfigSource

    if (
        typeof config.title !== 'string'
        || !Array.isArray(config.actions)
        || !config.actions.length
    )
        throw new Error('The console config needs a title and at least one action.')

    return config
}

const validateAction = (action: ConsoleAction): void => {
    if (
        !action.id
        || !action.label
    )
        throw new Error('Every console action needs an id and a label.')

    if (!SCRIPT_PATTERN.test(action.script ?? ''))
        throw new Error(`Console action ${action.id} needs a script named shared:<name> or local:<name>.`)

    for (const step of action.steps ?? []) {
        if (
            step.type === 'choices'
            && step.services !== undefined
            && step.services !== true
        )
            throw new Error(`Console action ${action.id} must set "services": true. The service tree comes from infrastructure/docker.`)

        if (
            step.type === 'choices'
            && step.options?.some(option => option.reported !== undefined && option.reported !== true)
        )
            throw new Error(`Console action ${action.id} must set "reported": true on an option the script reports.`)
    }
}

const inheritAction = (
    action: InheritingConsoleAction,
    shared: ConsoleConfig | undefined,
): ConsoleAction => {
    if (!EXTENDS_PATTERN.test(action.extends ?? ''))
        throw new Error(`Console action ${action.id} must extend an action named shared:<id>.`)

    if (
        'script' in action
        || 'steps' in action
    )
        throw new Error(`Console action ${action.id} extends ${action.extends}, so its script and steps come from Lixpi's action.`)

    const parent = shared?.actions.find(candidate => candidate.id === action.extends.slice(SHARED_PREFIX.length))

    if (!parent)
        throw new Error(`Console action ${action.id} extends ${action.extends}, which Lixpi's console doesn't define.`)

    const added = action.options ?? []
    const choiceSteps = (parent.steps ?? []).filter(step => step.type === 'choices')

    if (
        added.length
        && choiceSteps.length !== 1
    )
        throw new Error(`Console action ${action.id} adds options, so ${action.extends} needs exactly one choices step.`)

    return {
        ...parent,
        id: action.id,
        label: action.label ?? parent.label,
        hint: action.hint ?? parent.hint,
        params: {
            ...parent.params,
            ...action.params,
        },
        returnToMenu: action.returnToMenu ?? parent.returnToMenu,
        envFile: action.envFile ?? parent.envFile,
        steps: parent.steps?.map(step => {
            if (
                step.type !== 'choices'
                || !added.length
            )
                return step

            const inherited = step.options ?? []
            const duplicate = added.find(option => inherited.some(candidate => candidate.name === option.name))

            if (duplicate)
                throw new Error(`Console action ${action.id} adds the option ${duplicate.name}, which ${action.extends} already has.`)

            return {
                ...step,
                options: [
                    ...inherited,
                    ...added,
                ],
            }
        }),
    }
}

// A typo here would otherwise surface only when someone picks that menu entry. An
// action that extends a shared one needs Lixpi's own config to resolve it.
export const parseConsoleConfig = (
    text: string,
    sharedText?: string,
): ConsoleConfig => {
    const source = readSource(text)
    const inherits = source.actions.some(isInheriting)
    const shared = inherits
        && sharedText !== undefined
        ? parseConsoleConfig(sharedText)
        : undefined
    const actions = source.actions.map(action => (isInheriting(action) ? inheritAction(action, shared) : action))

    for (const action of actions)
        validateAction(action)

    return {
        title: source.title,
        actions,
    }
}

// The console container mounts the Lixpi checkout at lixpiPath, which holds the
// actions a repository can extend.
export const readConsoleConfig = (
    workspacePath: string,
    lixpiPath: string,
): ConsoleConfig => {
    const text = fs.readFileSync(
        path.join(workspacePath, CONSOLE_CONFIG_PATH),
        'utf8',
    )
    const sharedPath = path.join(lixpiPath, CONSOLE_CONFIG_PATH)

    return parseConsoleConfig(text, fs.existsSync(sharedPath) ? fs.readFileSync(sharedPath, 'utf8') : undefined)
}
