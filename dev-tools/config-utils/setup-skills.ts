import * as prompts from '@clack/prompts'
import c from 'chalk'
import * as fs from 'node:fs'
import * as path from 'node:path'

const SKILLS_ROOT = '/skills'
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

type InstallScope = 'global' | 'project'

type HarnessChoice = {
    value: string
    label: string
    globalHint: string
    projectHint: string
}

type SelectionPlan = {
    scope: InstallScope
    projectPath: string
    harnesses: string[]
    skills: string[]
}

const HARNESS_CHOICES: HarnessChoice[] = [
    {
        value: '0',
        label: 'Codex',
        globalHint: '~/.agents/skills',
        projectHint: '.agents/skills',
    },
    {
        value: '1',
        label: 'Claude Code',
        globalHint: '~/.claude/skills',
        projectHint: '.claude/skills',
    },
    {
        value: '2',
        label: 'Cursor',
        globalHint: '~/.cursor/skills',
        projectHint: '.cursor/skills',
    },
    {
        value: '3',
        label: 'GitHub Copilot',
        globalHint: '~/.copilot/skills',
        projectHint: '.github/skills',
    },
]

class SetupCancelled extends Error {}

class SkillSetupWizard {
    private readonly hostRoot: string

    constructor(hostRoot: string) {
        this.hostRoot = hostRoot
    }

    async run(): Promise<string> {
        prompts.intro(
            c.bgCyan(
                c.black(' Lixpi Skill Setup '),
            ),
            { output: process.stderr },
        )

        const skillNames = this.readSkillNames()
        const scope = this.unwrap<InstallScope>(
            await prompts.select({
                message: 'Where should the skills be installed?',
                options: [
                    {
                        value: 'global',
                        label: 'Globally',
                        hint: 'Recommended, available to every project',
                    },
                    {
                        value: 'project',
                        label: 'Specific project',
                        hint: 'Available only inside one Git checkout',
                    },
                ],
                initialValue: 'global',
                output: process.stderr,
            }),
        )

        const suggestedProjectPath = this.hostRoot
        const projectPath = scope === 'project'
            ? this.unwrap<string>(
                await prompts.autocomplete({
                    message: 'Type a project path, or press Tab to use the suggestion',
                    options() {
                        const value = this.userInput || suggestedProjectPath

                        return [{
                            value,
                            label: value,
                            hint: value === suggestedProjectPath
                                ? 'Suggested path'
                                : undefined,
                        }]
                    },
                    filter: () => true,
                    initialValue: suggestedProjectPath,
                    placeholder: suggestedProjectPath,
                    completeOnTab: true,
                    validate: value => {
                        if (!value.trim())
                            return 'Enter a project path.'

                        if (/\r|\n/.test(value))
                            return 'The project path must stay on one line.'
                    },
                    output: process.stderr,
                }),
            )
            : ''

        const harnesses = this.unwrap<string[]>(
            await prompts.multiselect({
                message: 'Which harnesses should receive the skills?',
                options: HARNESS_CHOICES.map(
                    choice => ({
                        value: choice.value,
                        label: choice.label,
                        hint: scope === 'global' ? choice.globalHint : choice.projectHint,
                    }),
                ),
                required: true,
                output: process.stderr,
            }),
        )

        const skills = this.unwrap<string[]>(
            await prompts.groupMultiselect({
                message: 'Which skills should be installed?',
                options: {
                    'All skills': skillNames.map(
                        skillName => ({
                            value: skillName,
                            label: skillName,
                        }),
                    ),
                },
                selectableGroups: true,
                required: true,
                output: process.stderr,
            }),
        )

        const plan: SelectionPlan = {
            scope,
            projectPath: projectPath.trim(),
            harnesses,
            skills,
        }

        prompts.note(
            [
                `Scope: ${scope === 'global' ? 'Global' : plan.projectPath}`,
                `Harnesses: ${this.harnessLabels(harnesses).join(', ')}`,
                `Skills: ${skills.length === skillNames.length ? `All ${skillNames.length}` : skills.join(', ')}`,
            ].join('\n'),
            'Installation plan',
            { output: process.stderr },
        )

        const confirmed = this.unwrap<boolean>(
            await prompts.confirm({
                message: 'Install these skill links?',
                initialValue: true,
                output: process.stderr,
            }),
        )

        if (!confirmed)
            throw new SetupCancelled()

        prompts.outro(
            c.green('Selection confirmed. Installing links on the host.'),
            { output: process.stderr },
        )

        return this.renderPlan(plan)
    }

    private readSkillNames(): string[] {
        const skillNames = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .filter(
                skillName => fs.existsSync(
                    path.join(
                        SKILLS_ROOT,
                        skillName,
                        'SKILL.md',
                    ),
                ),
            )
            .sort((left, right) => left.localeCompare(right))

        const invalidSkillName = skillNames.find(skillName => !SKILL_NAME_PATTERN.test(skillName))

        if (invalidSkillName)
            throw new Error(`Invalid skill directory name: ${invalidSkillName}.`)

        if (!skillNames.length)
            throw new Error(`No skills were found under ${SKILLS_ROOT}.`)

        return skillNames
    }

    private harnessLabels(values: string[]): string[] {
        const labels = new Map(
            HARNESS_CHOICES.map(
                choice => [
                    choice.value,
                    choice.label,
                ],
            ),
        )

        return values.map(value => labels.get(value) ?? value)
    }

    private renderPlan(plan: SelectionPlan): string {
        const lines = [
            `SCOPE=${plan.scope}`,
            `PROJECT_PATH=${plan.projectPath}`,
            ...plan.harnesses.map(harness => `HARNESS=${harness}`),
            ...plan.skills.map(skill => `SKILL=${skill}`),
        ]

        return `${lines.join('\n')}\n`
    }

    private unwrap<T>(value: T | symbol): T {
        if (prompts.isCancel(value))
            throw new SetupCancelled()

        return value as T
    }
}

const run = async (): Promise<void> => {
    const wizard = new SkillSetupWizard(process.env.LIXPI_HOST_ROOT ?? '')

    process.stdout.write(await wizard.run())
}

try {
    await run()
} catch (error) {
    if (error instanceof SetupCancelled)
        prompts.cancel('Setup cancelled', { output: process.stderr })
    else
        prompts.cancel(error instanceof Error ? error.message : String(error), { output: process.stderr })

    process.exitCode = 1
} finally {
    process.stdin.destroy()
}
