import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as prompts from '@clack/prompts'
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { ComposeCatalog } from './compose-catalog.ts'
import { ServiceTree } from './service-tree.ts'
import {
    DockerLayout,
    DockerLayoutError,
} from './docker-layout.ts'
import {
    DevConsoleWizard,
    readEnvironmentFiles,
    renderConsolePlan,
} from './dev-console-wizard.ts'
import {
    parseConsoleConfig,
    type ConsoleConfig,
} from './console-config.ts'
import { PRUNE_TREE } from './docker-prune-tree.ts'
import { type TreeNode } from '@lixpi/cli-ui/tree-selection'
import {
    addUsageToTree,
    parseDockerUsage,
    renderDockerUsage,
} from './docker-usage.ts'

vi.mock('@clack/prompts', async importOriginal => ({
    ...await importOriginal<typeof prompts>(),
    intro: vi.fn(),
    note: vi.fn(),
    outro: vi.fn(),
    select: vi.fn(),
    confirm: vi.fn(),
    text: vi.fn(),
    log: { warn: vi.fn() },
}))

vi.mock('@lixpi/cli-ui/select-menu', async () => {
    const clack = await import('@clack/prompts')

    return { selectMenu: (options: Parameters<typeof clack.select>[0]) => clack.select(options) }
})

const treePrompt = vi.hoisted(() => vi.fn())
const treeOptions = vi.hoisted(() => vi.fn())

vi.mock('@lixpi/cli-ui/tree-multiselect-prompt', () => ({
    TreeMultiSelectPrompt: class {
        prompt = treePrompt

        constructor(options: unknown) {
            treeOptions(options)
        }
    },
}))

const CONFIG: ConsoleConfig = {
    title: 'Test Console',
    actions: [
        {
            id: 'login',
            label: 'Login',
            script: 'shared:login',
            steps: [{ type: 'env-file' }],
        },
        {
            id: 'start',
            label: 'Start',
            script: 'shared:start-services',
            steps: [
                { type: 'env-file' },
                {
                    type: 'choices',
                    message: 'Which?',
                    options: [{
                        name: 'rebuild',
                        label: 'Containers',
                        choices: [
                            {
                                value: 'false',
                                label: 'Existing',
                            },
                            {
                                value: 'true',
                                label: 'Rebuild',
                            },
                        ],
                    }],
                    services: true,
                },
            ],
        },
        {
            id: 'mode',
            label: 'Mode',
            script: 'local:mode',
            steps: [{
                type: 'choices',
                message: 'Mode?',
                options: [{
                    name: 'mode',
                    label: 'Mode',
                    choices: [{
                        value: 'nex',
                        label: 'Nex',
                    }],
                }],
            }],
        },
        {
            id: 'deploy',
            label: 'Deploy',
            script: 'local:deploy',
            steps: [{
                type: 'confirm',
                message: 'Sure?',
            }],
        },
        {
            id: 'fixed',
            label: 'Fixed',
            script: 'local:fixed',
            envFile: 'env.lixpi',
        },
        {
            id: 'prune',
            label: 'Prune',
            script: 'shared:prune-docker',
            steps: [{ type: 'docker-prune' }],
        },
        {
            id: 'deploy-service',
            label: 'Deploy service',
            script: 'local:pulumi',
            steps: [
                { type: 'env-file' },
                { type: 'service-commands' },
            ],
        },
        {
            id: 'plain',
            label: 'Plain',
            script: 'local:plain',
            params: { greeting: 'hello' },
        },
        {
            id: 'certificates',
            label: 'Certificates',
            script: 'local:certificates',
            steps: [
                { type: 'env-file' },
                {
                    type: 'choices',
                    message: 'Certificates?',
                    options: [
                        {
                            name: 'regenerate',
                            label: 'Regenerate',
                            reported: true,
                            choices: [
                                {
                                    value: 'keep',
                                    label: 'Keep',
                                },
                                {
                                    value: 'regenerate',
                                    label: 'Regenerate',
                                },
                            ],
                        },
                        {
                            name: 'trust',
                            label: 'Trust',
                            choices: [{
                                value: 'skip',
                                label: 'Skip',
                            }],
                        },
                    ],
                },
            ],
        },
    ],
}

const CATALOG = JSON.stringify({
    target: {
        summary: 'stack production in AWS account 1 (profile production)',
        rows: [{
            label: 'Deploys to',
            value: 'AWS account 1',
        }],
    },
    commands: [
        {
            name: 'preview',
            label: 'Preview',
            effect: 'read',
            available: true,
        },
        {
            name: 'up',
            label: 'Deploy',
            effect: 'change',
            available: true,
        },
        {
            name: 'destroy',
            label: 'Destroy',
            effect: 'destroy',
            available: false,
            blockedReason: 'Only for production',
        },
        {
            name: 'repair',
            label: 'Repair',
            effect: 'change',
            available: true,
            takesEnvFile: true,
            arguments: [{
                name: 'organization',
                prompt: 'Which?',
            }],
        },
    ],
})

const ROOT_COMPOSE_PATH = 'infrastructure/docker/docker-compose.yml'

const CANCEL = Symbol('cancel')

const USAGE = [
    '{"Active":"4","Reclaimable":"8.1GB (65%)","Size":"12.3GB","TotalCount":"30","Type":"Images"}',
    '{"Active":"2","Reclaimable":"10MB (50%)","Size":"20MB","TotalCount":"6","Type":"Containers"}',
    '{"Active":"3","Reclaimable":"1GB (40%)","Size":"2.5GB","TotalCount":"9","Type":"Local Volumes"}',
    '{"Active":"0","Reclaimable":"4GB","Size":"4GB","TotalCount":"80","Type":"Build Cache"}',
].join('\n')

const STACK_COMPOSE = `
name: test
include:
    - services/application/docker-compose.application.yml
    - services/messaging/nats/docker-compose.nats.yml
`

const APPLICATION_COMPOSE = `
services:
    web:
        profiles: ["main"]
        depends_on:
            api:
                condition: service_started
            optional-sidecar:
                required: false
    api:
        profiles: ["main", "deploy"]
        depends_on:
            - nats-1
    always-on: {}
    extended:
        extends:
            file: ../../../../tools/base.yml
            service: base
    admin:
        profiles: ["dev"]
    optional-sidecar:
        profiles: ["dev"]
`

const NATS_COMPOSE = `
services:
    nats-1:
        profiles: ["main"]
`

const RUNNER_COMPOSE = `
services:
    test-runner:
        profiles: ["dev"]
`

const BASE_COMPOSE = `
services:
    base:
        profiles: ["dev"]
`

// A complete layout: the stack, two service groups with one nested, and a utility.
const LAYOUT_FILES: Record<string, string> = {
    'infrastructure/docker/docker-group.json': '{ "label": "Test", "baseProfile": "main" }',
    'infrastructure/docker/docker-compose.yml': STACK_COMPOSE,
    'infrastructure/docker/services/docker-group.json': '{ "kind": "services", "label": "Services" }',
    'infrastructure/docker/services/application/docker-group.json': '{ "label": "Application", "order": 10 }',
    'infrastructure/docker/services/application/docker-compose.application.yml': APPLICATION_COMPOSE,
    'infrastructure/docker/services/messaging/docker-group.json': '{ "label": "Messaging", "order": 20 }',
    'infrastructure/docker/services/messaging/nats/docker-group.json': '{ "label": "NATS" }',
    'infrastructure/docker/services/messaging/nats/docker-compose.nats.yml': NATS_COMPOSE,
    'infrastructure/docker/utilities/docker-group.json': '{ "kind": "utilities", "label": "Utilities" }',
    'infrastructure/docker/utilities/code-quality/docker-group.json': '{ "label": "Code quality" }',
    'infrastructure/docker/utilities/code-quality/docker-compose.test-runner.yml': RUNNER_COMPOSE,
    'tools/base.yml': BASE_COMPOSE,
}

describe('dev console', () => {
    let workspace: string

    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-console-'))

        for (const [file, text] of Object.entries(LAYOUT_FILES))
            writeWorkspaceFile(file, text)
    })

    const writeWorkspaceFile = (
        file: string,
        text: string,
    ): void => {
        fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true })
        fs.writeFileSync(path.join(workspace, file), text)
    }

    afterEach(() => {
        fs.rmSync(workspace, {
            recursive: true,
            force: true,
        })
    })

    describe('compose catalog', () => {
        it('reads included files and records which file owns each service', () => {
            const catalog = new ComposeCatalog(workspace, ROOT_COMPOSE_PATH)

            expect(catalog.fileOf('web')).toBe('infrastructure/docker/services/application/docker-compose.application.yml')
            expect(catalog.fileOf('nats-1')).toBe('infrastructure/docker/services/messaging/nats/docker-compose.nats.yml')
        })

        it('treats main-profile and profileless services as the default stack', () => {
            const catalog = new ComposeCatalog(workspace, ROOT_COMPOSE_PATH)

            expect(catalog.startsByDefault('web', 'main')).toBe(true)
            expect(catalog.startsByDefault('always-on', 'main')).toBe(true)
            expect(catalog.startsByDefault('admin', 'main')).toBe(false)
        })

        it('inherits profiles through extends', () => void expect(new ComposeCatalog(workspace, ROOT_COMPOSE_PATH).startsByDefault('extended', 'main')).toBe(false))

        it('follows required dependencies transitively and skips optional ones', () => {
            const catalog = new ComposeCatalog(workspace, ROOT_COMPOSE_PATH)

            expect(catalog.dependenciesOf(['web']).sort()).toEqual(['api', 'nats-1'])
            expect(catalog.dependenciesOf(['web', 'api'])).toEqual(['nats-1'])
        })
    })

    describe('docker layout', () => {
        const problemsOf = (): string[] => {
            try {
                DockerLayout.read(workspace)
            } catch (error) {
                return error instanceof DockerLayoutError ? error.problems : []
            }

            return []
        }

        it('reads groups in order with their labels and partials', () => {
            const layout = DockerLayout.read(workspace)

            expect(layout.baseProfile).toBe('main')
            expect(layout.services?.groups.map(group => group.label)).toEqual(['Application', 'Messaging'])
            expect(layout.services?.groups[1].groups[0].files).toEqual(['infrastructure/docker/services/messaging/nats/docker-compose.nats.yml'])
            expect(layout.utilities?.groups[0].label).toBe('Code quality')
        })

        it('requires a docker-group.json in every directory', () => {
            fs.rmSync(path.join(workspace, 'infrastructure/docker/services/messaging/docker-group.json'))

            expect(problemsOf()).toEqual(['infrastructure/docker/services/messaging needs a docker-group.json.'])
        })

        it('reports a services partial the stack forgets to include', () => {
            writeWorkspaceFile('infrastructure/docker/services/messaging/nats/docker-compose.nats-cli.yml', 'services:\n    cli: {}\n')

            expect(problemsOf()).toEqual(['infrastructure/docker/docker-compose.yml doesn\'t include infrastructure/docker/services/messaging/nats/docker-compose.nats-cli.yml.'])
        })

        it('reports a utility the stack includes', () => {
            writeWorkspaceFile('infrastructure/docker/docker-compose.yml', `${STACK_COMPOSE}    - utilities/code-quality/docker-compose.test-runner.yml\n`)

            expect(problemsOf()).toEqual(['infrastructure/docker/docker-compose.yml includes infrastructure/docker/utilities/code-quality/docker-compose.test-runner.yml, which isn\'t a partial under services/.'])
        })

        it('rejects a compose file outside the services and utilities groups', () => {
            writeWorkspaceFile('infrastructure/docker/docker-compose.extra.yml', 'services: {}\n')

            expect(problemsOf()).toEqual(['infrastructure/docker/docker-compose.extra.yml belongs in services/ or utilities/.'])
        })

        it('rejects files that are not named like partials', () => {
            writeWorkspaceFile('infrastructure/docker/utilities/code-quality/runner.yml', 'services: {}\n')

            expect(problemsOf()).toEqual(['infrastructure/docker/utilities/code-quality/runner.yml isn\'t a docker-compose.<name>.yml partial.'])
        })

        it('requires the top directories to declare their kind', () => {
            writeWorkspaceFile('infrastructure/docker/utilities/docker-group.json', '{ "label": "Utilities" }')

            expect(problemsOf()).toEqual(['infrastructure/docker/utilities/docker-group.json must set "kind": "utilities".'])
        })

        it('reports every problem at once', () => {
            writeWorkspaceFile('infrastructure/docker/services/application/docker-group.json', '{ "order": "first" }')

            expect(problemsOf()).toEqual([
                'infrastructure/docker/services/application/docker-group.json must give "order" as a number.',
                'infrastructure/docker/services/application/docker-group.json needs a "label".',
            ])
        })
    })

    describe('service tree', () => {
        const buildTree = (): ServiceTree =>
            new ServiceTree(
                new ComposeCatalog(workspace, ROOT_COMPOSE_PATH),
                DockerLayout.read(workspace),
            )
        const groupsOf = (tree: ServiceTree) => tree.roots.filter(node => !node.choices)

        it('draws one group per directory, nested like the directories', () => {
            const [application, messaging] = groupsOf(buildTree())

            expect(application.label).toBe('Application')
            expect(application.children?.map(node => node.value)).toEqual(['web', 'api', 'always-on', 'extended', 'admin', 'optional-sidecar'])
            expect(messaging.children?.[0].label).toBe('NATS')
            expect(messaging.children?.[0].children?.map(node => node.value)).toEqual(['nats-1'])
        })

        it('leaves utilities out of the tree', () => void expect(JSON.stringify(buildTree().roots)).not.toContain('test-runner'))

        it('offers Base, an empty Custom and All as one preset row above the tree', () => {
            const tree = buildTree()
            const [base, custom, all] = tree.roots[0].choices ?? []

            expect(base.selection).toEqual(tree.baseServices)
            expect(all.selection).toEqual(tree.allServices)
            expect(custom.selection).toEqual([])
        })

        it('takes the base stack from the base profile, so a dev service stays out of it', () => {
            const tree = buildTree()

            expect(tree.baseServices).toEqual(['web', 'api', 'always-on', 'nats-1'])
            expect(tree.allServices).toContain('admin')
        })

        it('uses profileless services as the base stack when no profile is configured', () => {
            writeWorkspaceFile('infrastructure/docker/docker-group.json', '{ "label": "Test" }')

            expect(buildTree().baseServices).toEqual(['always-on'])
        })

        it('reads a base service from the Lixpi checkout through its variable', () => {
            fs.mkdirSync(path.join(workspace, 'lixpi-checkout'))
            fs.writeFileSync(path.join(workspace, 'lixpi-checkout/base.yml'), BASE_COMPOSE)
            fs.writeFileSync(path.join(workspace, 'cross.yml'), 'services:\n    tool:\n        extends:\n            file: ${LIXPI_REPOSITORY_PATH:-/somewhere}/base.yml\n            service: base\n')

            const catalog = new ComposeCatalog(
                workspace,
                'cross.yml',
                path.join(workspace, 'lixpi-checkout'),
            )

            expect(catalog.startsByDefault('tool')).toBe(false)
        })

        it('labels a group with its partial file only when it has exactly one', () => {
            const [application, messaging] = groupsOf(buildTree())

            expect(application.hint).toBe('docker-compose.application.yml')
            expect(messaging.hint).toBeUndefined()
            expect(messaging.children?.[0].hint).toBe('docker-compose.nats.yml')
        })

        it('describes the base stack, the whole tree and a partial choice', () => {
            const tree = buildTree()

            expect(tree.describe(tree.baseServices)).toBe('Base services')
            expect(tree.describe(tree.allServices)).toBe('All services')
            expect(tree.describe(['web'])).toBe('web')
        })
    })

    describe('environment files', () => {
        it('lists runtime configurations without the template', () => {
            for (const name of ['.env.alice-local', '.env.example', '.env.bob-dev', 'env.lixpi'])
                fs.writeFileSync(path.join(workspace, name), '')

            expect(readEnvironmentFiles(workspace)).toEqual(['.env.alice-local', '.env.bob-dev'])
        })
    })

    describe('docker usage', () => {
        it('reads each row and skips lines it cannot read', () => {
            const rows = parseDockerUsage(`${USAGE}\nnot json\n{"Type":1}`)

            expect(rows.map(row => row.type)).toEqual(['Images', 'Containers', 'Local Volumes', 'Build Cache'])
        })

        it('aligns the usage table in columns', () => {
            const [header, images] = renderDockerUsage(parseDockerUsage(USAGE)).split('\n')

            expect(header.indexOf('Size')).toBe(images.indexOf('12.3GB'))
        })

        it('adds sizes to the matching categories, including nested ones', () => {
            const [resources] = addUsageToTree(PRUNE_TREE, parseDockerUsage(USAGE))
            const hintOf = (value: string): string | undefined =>
                resources.children!.find(node => node.value === value)?.hint

            expect(hintOf('group:images')).toBe('12.3GB, 8.1GB (65%) reclaimable')
            expect(hintOf('containers')).toBe('20MB, 10MB (50%) reclaimable')
            expect(hintOf('networks')).toBeUndefined()
        })

        it('leaves the shared tree untouched', () => {
            addUsageToTree(PRUNE_TREE, parseDockerUsage(USAGE))

            expect(PRUNE_TREE[0].children![0].hint).toBeUndefined()
        })
    })

    describe('console plan', () => {
        it('renders one field per line for the host', () => {
            expect(renderConsolePlan({
                action: 'run',
                script: 'shared:start-services',
                envFile: '.env.alice-local',
                options: {
                    rebuild: 'true',
                    profile: 'main',
                },
                selected: ['web', 'api'],
            })).toBe('ACTION=run\nSCRIPT=shared:start-services\nENV_FILE=.env.alice-local\nOPTION=rebuild=true\nOPTION=profile=main\nSELECTED=web\nSELECTED=api\n')
        })

        it('leaves out what an action does not use', () => {
            expect(renderConsolePlan({
                action: 'run',
                script: 'local:deploy',
                options: {},
                selected: [],
            })).toBe('ACTION=run\nSCRIPT=local:deploy\n')
        })

        it('asks the host to come back to the menu only when the action says so', () => {
            expect(renderConsolePlan({
                action: 'run',
                script: 'local:init-config',
                returnToMenu: true,
                options: {},
                selected: [],
            })).toBe('ACTION=run\nSCRIPT=local:init-config\nRETURN_TO_MENU=true\n')
        })

        it('names the action to reopen after measuring Docker', () => {
            expect(renderConsolePlan({
                action: 'measure-docker',
                entry: 'prune',
            })).toBe('ACTION=measure-docker\nENTRY=prune\n')
        })
    })

    describe('console config', () => {
        it('accepts a valid config', () => void expect(parseConsoleConfig(JSON.stringify(CONFIG)).title).toBe('Test Console'))

        it('rejects a config without actions', () => void expect(() => parseConsoleConfig('{"title":"x","actions":[]}')).toThrow('at least one action'))

        it('rejects a script that names neither shared nor local', () => void expect(() => parseConsoleConfig('{"title":"x","actions":[{"id":"a","label":"A","script":"../evil"}]}')).toThrow('shared:<name> or local:<name>'))

        it('rejects a reported option that isn\'t set to true', () => void expect(() => parseConsoleConfig('{"title":"x","actions":[{"id":"a","label":"A","script":"local:a","steps":[{"type":"choices","message":"m","options":[{"name":"n","label":"N","reported":"yes","choices":[]}]}]}]}')).toThrow('"reported": true'))

        it('rejects a hand-written service list', () => void expect(() => parseConsoleConfig('{"title":"x","actions":[{"id":"a","label":"A","script":"shared:start-services","steps":[{"type":"choices","message":"m","services":{"groups":[]}}]}]}')).toThrow('"services": true'))
    })

    describe('main menu', () => {
        const answer = (...answers: unknown[]): void => {
            const select = vi.mocked(prompts.select)

            select.mockReset()

            for (const value of answers)
                select.mockResolvedValueOnce(value)
        }
        const run = () => new DevConsoleWizard(workspace, CONFIG).run()
        const runPrune = (dockerUsage = USAGE) => new DevConsoleWizard(
            workspace,
            CONFIG,
            {
                entry: 'prune',
                dockerUsage,
            },
        ).run()

        beforeEach(() => {
            fs.writeFileSync(path.join(workspace, '.env.alice-local'), '')
            treePrompt.mockReset()
            vi.mocked(prompts.confirm).mockReset()
            vi.spyOn(prompts, 'isCancel').mockImplementation(value => value === CANCEL)
        })

        it('lists the configured actions in order, then Exit, opening on the first', async () => {
            answer('exit')

            await run()

            const options = vi.mocked(prompts.select).mock.calls[0][0]
            const values = (options.options as { value: string }[]).map(option => option.value)

            expect(values).toEqual(['login', 'start', 'mode', 'deploy', 'fixed', 'prune', 'deploy-service', 'plain', 'certificates', 'exit'])
            expect(options.initialValue).toBeUndefined()
        })

        it('exits from the menu and on Esc', async () => {
            answer('exit')
            expect(await run()).toEqual({ action: 'exit' })

            answer(CANCEL)
            expect(await run()).toEqual({ action: 'exit' })
        })

        it('passes an action without steps straight through, with its params', async () => {
            answer('plain')

            expect(await run()).toEqual({
                action: 'run',
                script: 'local:plain',
                envFile: undefined,
                options: { greeting: 'hello' },
                selected: [],
                arguments: [],
            })
        })

        it('carries an action\'s return to the menu setting into its plan', async () => {
            const config = {
                title: 'Test',
                actions: [{
                    id: 'configure',
                    label: 'Configure',
                    script: 'local:init-config',
                    returnToMenu: true,
                }],
            }

            answer('configure')

            expect(await new DevConsoleWizard(workspace, config).run()).toMatchObject({ returnToMenu: true })
        })

        it('reuses the environment picker', async () => {
            answer('login', '.env.alice-local')

            expect(await run()).toMatchObject({
                script: 'shared:login',
                envFile: '.env.alice-local',
            })
        })

        it('uses a fixed environment file without asking', async () => {
            answer('fixed')

            expect(await run()).toMatchObject({ envFile: 'env.lixpi' })
            expect(prompts.select).toHaveBeenCalledTimes(1)
        })

        it('returns to the menu from the back option', async () => {
            answer('login', 'back-to-main-menu', 'exit')

            expect(await run()).toEqual({ action: 'exit' })
            expect(prompts.select).toHaveBeenCalledTimes(3)
        })

        it('warns and returns to the menu when an action has no environment file', async () => {
            vi.mocked(prompts.log.warn).mockClear()
            fs.rmSync(path.join(workspace, '.env.alice-local'))
            answer('login', 'exit')

            expect(await run()).toEqual({ action: 'exit' })
            expect(prompts.log.warn).toHaveBeenCalled()
        })

        it('turns radio rows into options and leaves them out of the services', async () => {
            answer('start', '.env.alice-local')
            treePrompt.mockResolvedValueOnce(['option:rebuild=true', 'web'])

            expect(await run()).toEqual({
                action: 'run',
                script: 'shared:start-services',
                envFile: '.env.alice-local',
                options: {
                    'compose-file': 'infrastructure/docker/docker-compose.yml',
                    profile: 'main',
                    rebuild: 'true',
                },
                selected: ['web'],
                arguments: [],
            })
            expect(prompts.select).toHaveBeenCalledTimes(2)
        })

        it('supports a page of options with no service tree', async () => {
            answer('mode')
            treePrompt.mockResolvedValueOnce(['option:mode=nex'])

            expect(await run()).toMatchObject({
                options: { mode: 'nex' },
                selected: [],
            })
        })

        it('returns to the menu on Esc on the options page', async () => {
            answer('start', '.env.alice-local', 'exit')
            treePrompt.mockResolvedValueOnce(CANCEL)

            expect(await run()).toEqual({ action: 'exit' })
        })

        it('runs a confirmed action, and returns to the menu when declined', async () => {
            answer('deploy')
            vi.mocked(prompts.confirm).mockResolvedValueOnce(true)
            expect(await run()).toMatchObject({ script: 'local:deploy' })

            answer('deploy', 'exit')
            vi.mocked(prompts.confirm).mockResolvedValueOnce(false)
            expect(await run()).toEqual({ action: 'exit' })
        })

        it('defaults a confirmation to No', async () => {
            answer('deploy')
            vi.mocked(prompts.confirm).mockResolvedValueOnce(true)

            await run()

            expect(vi.mocked(prompts.confirm).mock.lastCall![0].initialValue).toBe(false)
        })

        it('asks the host to measure Docker before the prune step', async () => {
            answer('prune')

            expect(await run()).toEqual({
                action: 'measure-docker',
                entry: 'prune',
            })
        })

        it('returns confirmed prune targets from the reopened action', async () => {
            treePrompt.mockResolvedValueOnce(['containers', 'networks'])
            vi.mocked(prompts.confirm).mockResolvedValueOnce(true)

            expect(await runPrune()).toMatchObject({
                action: 'run',
                script: 'shared:prune-docker',
                selected: ['containers', 'networks'],
            })
        })

        it('shows measured usage, and still opens when usage is unreadable', async () => {
            vi.mocked(prompts.note).mockClear()
            treePrompt.mockResolvedValueOnce(['containers'])
            vi.mocked(prompts.confirm).mockResolvedValueOnce(true)
            await runPrune()
            expect(vi.mocked(prompts.note).mock.calls[0][0]).toContain('12.3GB')

            vi.mocked(prompts.note).mockClear()
            treePrompt.mockResolvedValueOnce(['containers'])
            vi.mocked(prompts.confirm).mockResolvedValueOnce(true)
            await runPrune('not json')
            expect(prompts.note).not.toHaveBeenCalled()
        })

        it('returns to the menu when pruning is declined or cancelled', async () => {
            treePrompt.mockResolvedValueOnce(['containers'])
            vi.mocked(prompts.confirm).mockResolvedValueOnce(false)
            expect(await runPrune()).toEqual({ action: 'menu' })

            treePrompt.mockResolvedValueOnce(CANCEL)
            expect(await runPrune()).toEqual({ action: 'menu' })
        })

        describe('service commands', () => {
            const reopen = (catalog = CATALOG) => new DevConsoleWizard(
                workspace,
                CONFIG,
                {
                    entry: 'deploy-service',
                    entryEnvFile: '.env.alice-local',
                    catalog,
                },
            ).run()

            it('asks the host for the catalog after the environment file is chosen', async () => {
                answer('deploy-service', '.env.alice-local')

                expect(await run()).toEqual({
                    action: 'query',
                    entry: 'deploy-service',
                    script: 'local:pulumi',
                    envFile: '.env.alice-local',
                })
            })

            it('states the deployment target before offering anything', async () => {
                vi.mocked(prompts.note).mockClear()
                answer('preview')

                await reopen()

                expect(vi.mocked(prompts.note).mock.calls[0][0]).toContain('AWS account 1')
            })

            it('offers exactly what the service reports, disabling blocked commands with the reason', async () => {
                answer('preview')

                await reopen()

                const options = vi.mocked(prompts.select).mock.calls[0][0].options as {
                    value: string
                    disabled?: boolean
                    hint?: string
                }[]

                expect(options.map(option => option.value)).toEqual(['preview', 'up', 'destroy', 'repair', 'back-to-main-menu'])
                expect(options[2]).toMatchObject({
                    disabled: true,
                    hint: 'Only for production',
                })
            })

            it('runs a read command without asking, keeping the environment file', async () => {
                vi.mocked(prompts.confirm).mockClear()
                answer('preview')

                expect(await reopen()).toMatchObject({
                    action: 'run',
                    script: 'local:pulumi',
                    envFile: '.env.alice-local',
                    selected: ['preview'],
                })
                expect(prompts.confirm).not.toHaveBeenCalled()
            })

            it('confirms a change, naming the target and defaulting to No', async () => {
                answer('up')
                vi.mocked(prompts.confirm).mockResolvedValueOnce(true)

                await reopen()

                const options = vi.mocked(prompts.confirm).mock.lastCall![0]

                expect(options.message).toContain('AWS account 1')
                expect(options.initialValue).toBe(false)
            })

            it('goes back to the menu when a change is declined', async () => {
                answer('up')
                vi.mocked(prompts.confirm).mockResolvedValueOnce(false)

                expect(await reopen()).toEqual({ action: 'menu' })
            })

            it('asks for arguments and puts the environment file first when the service wants it', async () => {
                answer('repair')
                vi.mocked(prompts.text).mockResolvedValueOnce('org-1')
                vi.mocked(prompts.confirm).mockResolvedValueOnce(true)

                expect(await reopen()).toMatchObject({
                    selected: ['repair'],
                    arguments: ['.env.alice-local', 'org-1'],
                })
            })

            it('warns and returns to the menu when the service reports nothing', async () => {
                vi.mocked(prompts.log.warn).mockClear()

                expect(await reopen('')).toEqual({ action: 'menu' })
                expect(prompts.log.warn).toHaveBeenCalled()
            })

            it('renders the arguments in the plan after the command', () => {
                expect(renderConsolePlan({
                    action: 'run',
                    script: 'local:pulumi',
                    options: {},
                    selected: ['repair'],
                    arguments: ['org-1'],
                })).toBe('ACTION=run\nSCRIPT=local:pulumi\nSELECTED=repair\nARGUMENT=org-1\n')
            })
        })

        describe('options the host reports', () => {
            const reopen = (catalog: string) => new DevConsoleWizard(
                workspace,
                CONFIG,
                {
                    entry: 'certificates',
                    entryEnvFile: '.env.alice-local',
                    catalog,
                },
            ).run()
            const regenerateRow = () => (treeOptions.mock.lastCall![0] as { roots: TreeNode[] }).roots.find(root => root.value === 'choice:regenerate')

            it('asks the host before the step with a reported option', async () => {
                answer('certificates', '.env.alice-local')

                expect(await run()).toEqual({
                    action: 'query',
                    entry: 'certificates',
                    script: 'local:certificates',
                    envFile: '.env.alice-local',
                })
            })

            it('locks a row the script reports as unavailable, showing its reason', async () => {
                treePrompt.mockResolvedValueOnce(['option:regenerate=keep', 'option:trust=skip'])

                expect(await reopen('{"options":[{"name":"regenerate","available":false,"blockedReason":"Nothing exists yet"}]}')).toMatchObject({
                    action: 'run',
                    envFile: '.env.alice-local',
                    options: {
                        regenerate: 'keep',
                        trust: 'skip',
                    },
                })
                expect(regenerateRow()?.locked).toBe('Nothing exists yet')
            })

            it('leaves a row the script reports as available free to switch', async () => {
                treePrompt.mockResolvedValueOnce(['option:regenerate=regenerate', 'option:trust=skip'])

                expect(await reopen('{"options":[{"name":"regenerate","available":true}]}')).toMatchObject({ options: { regenerate: 'regenerate' } })
                expect(regenerateRow()?.locked).toBeUndefined()
            })

            it('warns and returns to the menu when the script reports nothing for the row', async () => {
                vi.mocked(prompts.log.warn).mockClear()

                expect(await reopen('')).toEqual({ action: 'menu' })
                expect(await reopen('{"options":[]}')).toEqual({ action: 'menu' })
                expect(prompts.log.warn).toHaveBeenCalledTimes(2)
            })
        })

        it('warns before pruning named volumes', async () => {
            vi.mocked(prompts.log.warn).mockClear()
            treePrompt.mockResolvedValueOnce(['volumes-all'])
            vi.mocked(prompts.confirm).mockResolvedValueOnce(true)

            await runPrune()

            expect(prompts.log.warn).toHaveBeenCalled()
        })
    })
})
