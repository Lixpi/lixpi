import * as prompts from '@clack/prompts'
import { listEnvironmentFiles } from '@lixpi/cli-ui/environment-files'
import {
    PromptCancelled,
    showWizardIntro,
    unwrapPrompt,
} from '@lixpi/cli-ui/prompt-session'
import { selectMenu } from '@lixpi/cli-ui/select-menu'
import { TreeMultiSelectPrompt } from '@lixpi/cli-ui/tree-multiselect-prompt'
import {
    type TreeNode,
} from '@lixpi/cli-ui/tree-selection'
import { ComposeCatalog } from './compose-catalog.ts'
import {
    type ConsoleAction,
    type ConsoleConfig,
    type ConsoleOption,
    type ConsoleStep,
} from './console-config.ts'
import {
    DATA_LOSS_PRUNE_TARGET,
    PRUNE_TREE,
} from './docker-prune-tree.ts'
import {
    addUsageToTree,
    parseDockerUsage,
    renderDockerUsage,
} from './docker-usage.ts'
import { ServiceTree } from './service-tree.ts'
import { parseServiceCatalog } from './service-catalog.ts'

// What run-console.sh does next. It validates every field and acts on the host, so
// the container only ever describes values and never a command line.
export type ConsolePlan =
    | { action: 'exit' }
    | { action: 'menu' }
    | {
        // Ask the action's own script for its catalog, then reopen this action with it.
        action: 'query'
        entry: string
        script: string
        envFile?: string
    }
    | {
        action: 'measure-docker'
        entry: string
    }
    | {
        action: 'run'
        script: string
        envFile?: string
        returnToMenu?: boolean
        options: Record<string, string>
        selected: string[]
        arguments?: string[]
    }

type WizardOptions = {
    output?: NodeJS.WritableStream

    // Opens this action directly. The host measures Docker disk usage after the menu
    // chooses pruning, then starts the console again on that action.
    entry?: string
    dockerUsage?: string
    catalog?: string
    entryEnvFile?: string
}

type StepAnswers = {
    envFile?: string
    options: Record<string, string>
    selected: string[]
    arguments: string[]
    leadingEnvFile?: boolean
}

// start-services.sh and the other scripts enforce this same shape on the host.
const ENV_FILE_PATTERN = /^\.env\.[A-Za-z0-9._-]+$/u

// The committed template is not a runnable configuration.
const ENV_TEMPLATE_FILE = '.env.example'

const OPTION_ROW_PREFIX = 'option:'
const OPTION_VALUE_SEPARATOR = '='
const EXIT_ACTION = 'exit'
const MENU_INSTRUCTIONS = 'Arrows move, Enter confirms, Esc exits'
const STEP_INSTRUCTIONS = 'Arrows move, Enter confirms, Esc returns to the main menu'
const TREE_INSTRUCTIONS = 'Up and Down move, Left and Right switch or fold, Space toggles, Enter confirms, Esc returns to the main menu'
const BACK_TO_MENU = 'back-to-main-menu'
const BACK_OPTION = {
    value: BACK_TO_MENU,
    label: 'Back to main menu',
}

export const readEnvironmentFiles = (workspacePath: string): string[] => listEnvironmentFiles(workspacePath).filter(
    name => ENV_FILE_PATTERN.test(name) && name !== ENV_TEMPLATE_FILE,
)

export const renderConsolePlan = (plan: ConsolePlan): string => {
    const lines = [`ACTION=${plan.action}`]

    if (plan.action === 'query')
        lines.push(
            `ENTRY=${plan.entry}`,
            `SCRIPT=${plan.script}`,
            ...(plan.envFile ? [`ENV_FILE=${plan.envFile}`] : []),
        )

    if (plan.action === 'measure-docker')
        lines.push(`ENTRY=${plan.entry}`)

    if (plan.action === 'run') {
        lines.push(`SCRIPT=${plan.script}`)

        if (plan.envFile)
            lines.push(`ENV_FILE=${plan.envFile}`)

        if (plan.returnToMenu)
            lines.push('RETURN_TO_MENU=true')

        lines.push(
            ...Object.entries(plan.options).map(([name, value]) => `OPTION=${name}${OPTION_VALUE_SEPARATOR}${value}`),
            ...plan.selected.map(value => `SELECTED=${value}`),
            ...(plan.arguments ?? []).map(value => `ARGUMENT=${value}`),
        )
    }

    return `${lines.join('\n')}\n`
}

// Esc, Ctrl+C or "Back to main menu" abandons the current action from any of its steps
// and comes back to the menu. Submitting an action ends the console once its script
// finishes, unless the action sets returnToMenu.
export class DevConsoleWizard {
    private readonly output: NodeJS.WritableStream

    constructor(
        private readonly workspacePath: string,
        private readonly config: ConsoleConfig,
        private readonly options: WizardOptions = {},
    ) {
        this.output = options.output ?? process.stderr
    }

    async run(): Promise<ConsolePlan> {
        showWizardIntro(this.config.title, this.output)

        const entry = this.config.actions.find(action => action.id === this.options.entry)

        if (entry)
            return this.planEntry(entry)

        while (true) {
            const action = await this.askAction()

            if (!action)
                return { action: EXIT_ACTION }

            if (action.steps?.some(step => step.type === 'docker-prune'))
                return {
                    action: 'measure-docker',
                    entry: action.id,
                }

            try {
                return await this.planAction(action)
            } catch (error) {
                if (!(error instanceof PromptCancelled))
                    throw error
            }
        }
    }

    private async planEntry(action: ConsoleAction): Promise<ConsolePlan> {
        try {
            return await this.planAction(action)
        } catch (error) {
            if (error instanceof PromptCancelled)
                return { action: 'menu' }

            throw error
        }
    }

    private async askAction(): Promise<ConsoleAction | undefined> {
        const answer = await selectMenu<string>({
            message: 'What do you want to do?',
            instructions: MENU_INSTRUCTIONS,
            options: [
                ...this.config.actions.map(
                    action => ({
                        value: action.id,
                        label: action.label,
                        hint: action.hint,
                    }),
                ),
                {
                    value: EXIT_ACTION,
                    label: 'Exit',
                },
            ],
            output: this.output,
        })

        return prompts.isCancel(answer)
            ? undefined
            : this.config.actions.find(action => action.id === answer)
    }

    private async planAction(action: ConsoleAction): Promise<ConsolePlan> {
        const reopened = action.id === this.options.entry
        const answers: StepAnswers = {
            envFile: action.envFile ?? (reopened ? this.options.entryEnvFile : undefined),
            options: { ...action.params },
            selected: [],
            arguments: [],
        }

        for (const step of action.steps ?? []) {
            if (
                step.type === 'env-file'
                && reopened
                && answers.envFile
            )
                continue

            if (
                step.type === 'service-commands'
                && !reopened
            )
                return {
                    action: 'query',
                    entry: action.id,
                    script: action.script,
                    envFile: answers.envFile,
                }

            await this.runStep(step, answers)
        }

        return {
            action: 'run',
            script: action.script,
            envFile: answers.envFile,
            returnToMenu: action.returnToMenu,
            options: answers.options,
            selected: answers.selected,
            arguments: answers.leadingEnvFile
                && answers.envFile
                ? [answers.envFile, ...answers.arguments]
                : answers.arguments,
        }
    }

    private async runStep(
        step: ConsoleStep,
        answers: StepAnswers,
    ): Promise<void> {
        switch (step.type) {
            case 'env-file':
                answers.envFile = await this.askEnvironmentFile()

                break
            case 'confirm':
                await this.askConfirmation(step.message)

                break
            case 'docker-prune':
                answers.selected = await this.askPruneTargets()

                break
            case 'service-commands':
                await this.askServiceCommand(answers)

                break
            case 'choices':
                await this.askChoices(step, answers)

                break
            default:
                break
        }
    }

    private async askEnvironmentFile(): Promise<string> {
        const files = readEnvironmentFiles(this.workspacePath)

        if (!files.length) {
            prompts.log.warn(
                'No environment files exist yet, so this action has nothing to use. Create a configuration first.',
                { output: this.output },
            )

            throw new PromptCancelled()
        }

        const answer = unwrapPrompt<string>(
            await selectMenu<string>({
                message: 'Which environment file should be used?',
                instructions: STEP_INSTRUCTIONS,
                options: [
                    ...files.map(
                        file => ({
                            value: file,
                            label: file,
                        }),
                    ),
                    BACK_OPTION,
                ],
                output: this.output,
            }),
        )

        if (answer === BACK_TO_MENU)
            throw new PromptCancelled()

        return answer
    }

    private async askConfirmation(message: string): Promise<void> {
        const confirmed = unwrapPrompt<boolean>(
            await prompts.confirm({
                message,
                initialValue: false,
                output: this.output,
            }),
        )

        if (!confirmed)
            throw new PromptCancelled()
    }

    private async askPruneTargets(): Promise<string[]> {
        const usage = parseDockerUsage(this.options.dockerUsage ?? '')

        if (usage.length)
            prompts.note(
                renderDockerUsage(usage),
                'Docker disk usage',
                { output: this.output },
            )

        const targets = unwrapPrompt<string[]>(
            await new TreeMultiSelectPrompt({
                message: 'What should be pruned?',
                roots: addUsageToTree(PRUNE_TREE, usage),
                initialValues: [],
                instructions: TREE_INSTRUCTIONS,
                requiredMessage: 'Select at least one thing to prune.',
                output: this.output,
            }).prompt(),
        )

        if (targets.includes(DATA_LOSS_PRUNE_TARGET))
            prompts.log.warn(
                'All unused volumes includes named volumes, so any stack that is stopped and removed loses its stored data.',
                { output: this.output },
            )

        await this.askConfirmation('This affects every project on this Docker host, not only this repository. Prune now?')

        return targets
    }

    private async askServiceCommand(answers: StepAnswers): Promise<void> {
        const catalog = parseServiceCatalog(this.options.catalog ?? '')

        if (!catalog) {
            prompts.log.warn('The service did not report its commands, so there is nothing to offer.', { output: this.output })

            throw new PromptCancelled()
        }

        prompts.note(
            catalog.target.rows.map(row => `${row.label}: ${row.value}`).join('\n'),
            'Deployment target',
            { output: this.output },
        )

        const name = unwrapPrompt<string>(
            await selectMenu<string>({
                message: 'What should run against this target?',
                instructions: STEP_INSTRUCTIONS,
                options: [
                    ...catalog.commands.map(
                        command => ({
                            value: command.name,
                            label: command.label,
                            hint: command.available ? command.description : command.blockedReason,
                            disabled: !command.available,
                        }),
                    ),
                    BACK_OPTION,
                ],
                output: this.output,
            }),
        )

        if (name === BACK_TO_MENU)
            throw new PromptCancelled()

        const command = catalog.commands.find(candidate => candidate.name === name)!

        for (const argument of command.arguments ?? [])
            answers.arguments.push(
                unwrapPrompt<string>(
                    await prompts.text({
                        message: argument.prompt,
                        validate: value => value?.trim()
                            && !/[\r\n]/u.test(value)
                            ? undefined
                            : 'Enter one line of text.',
                        output: this.output,
                    }),
                ).trim(),
            )

        if (command.effect !== 'read')
            await this.askConfirmation(
                command.effect === 'destroy'
                    ? `${command.label} DELETES resources in ${catalog.target.summary}. Continue?`
                    : `${command.label} on ${catalog.target.summary}?`,
            )

        answers.selected = [name]
        answers.leadingEnvFile = command.takesEnvFile
    }

    private async askChoices(
        step: Extract<ConsoleStep, { type: 'choices' }>,
        answers: StepAnswers,
    ): Promise<void> {
        const catalog = step.services ? new ComposeCatalog(this.workspacePath, step.services.composeFile) : undefined
        const tree = step.services
            && catalog
            ? new ServiceTree(
                catalog,
                step.services.groups,
                step.services.composeFile,
                step.services.baseProfile,
            )
            : undefined
        const optionRows = (step.options ?? []).map(option => this.optionRow(option))
        const selected = unwrapPrompt<string[]>(
            await new TreeMultiSelectPrompt({
                message: step.message,
                roots: [
                    ...optionRows,
                    ...(tree?.roots ?? []),
                ],
                initialValues: tree?.baseServices ?? [],
                instructions: TREE_INSTRUCTIONS,
                required: Boolean(tree),
                requiredMessage: 'Select at least one service.',
                output: this.output,
            }).prompt(),
        )

        for (const value of selected) {
            if (!value.startsWith(OPTION_ROW_PREFIX))
                continue

            const [name, optionValue] = value.slice(OPTION_ROW_PREFIX.length).split(OPTION_VALUE_SEPARATOR)

            answers.options[name] = optionValue
        }

        answers.selected = selected.filter(value => !value.startsWith(OPTION_ROW_PREFIX))

        if (
            tree
            && catalog
        )
            this.showStartPlan(
                tree,
                catalog,
                step.options ?? [],
                answers,
            )
    }

    private optionRow(option: ConsoleOption): TreeNode {
        return {
            value: `choice:${option.name}`,
            label: option.label,
            choices: option.choices.map(
                choice => ({
                    ...choice,
                    value: `${OPTION_ROW_PREFIX}${option.name}${OPTION_VALUE_SEPARATOR}${choice.value}`,
                }),
            ),
        }
    }

    private showStartPlan(
        tree: ServiceTree,
        catalog: ComposeCatalog,
        options: ConsoleOption[],
        answers: StepAnswers,
    ): void {
        const optionLines = options.map(option => {
            const choice = option.choices.find(candidate => candidate.value === answers.options[option.name])

            return `${option.label}: ${choice?.label ?? answers.options[option.name]}`
        })
        const dependencies = catalog.dependenciesOf(answers.selected)

        prompts.note(
            [
                ...(answers.envFile ? [`Environment: ${answers.envFile}`] : []),
                ...optionLines,
                `Services: ${tree.describe(answers.selected)}`,
                ...(dependencies.length ? [`Required dependencies: ${dependencies.join(', ')}`] : []),
            ].join('\n'),
            'Plan',
            { output: this.output },
        )
    }
}
