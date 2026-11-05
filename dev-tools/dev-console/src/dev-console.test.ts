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
    DevConsoleWizard,
    readEnvironmentFiles,
    renderConsolePlan,
} from './dev-console-wizard.ts'
import {
    parseConsoleConfig,
    type ConsoleConfig,
} from './console-config.ts'
import { PRUNE_TREE } from './docker-prune-tree.ts'
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
    log: { warn: vi.fn() },
}))

vi.mock('@lixpi/cli-ui/select-menu', async () => {
    const clack = await import('@clack/prompts')

    return { selectMenu: (options: Parameters<typeof clack.select>[0]) => clack.select(options) }
})

const treePrompt = vi.hoisted(() => vi.fn())

vi.mock('@lixpi/cli-ui/tree-multiselect-prompt', () => ({
    TreeMultiSelectPrompt: class {
        prompt = treePrompt
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
                    services: {
                        composeFile: 'infrastructure/docker/docker-compose.yml',
                        baseProfile: 'main',
                        groups: [{
                            label: 'Application',
                            services: ['web'],
                        }],
                    },
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
            id: 'plain',
            label: 'Plain',
            script: 'local:plain',
            params: { greeting: 'hello' },
        },
    ],
}

const ROOT_COMPOSE_PATH = 'infrastructure/docker/docker-compose.yml'

const CANCEL = Symbol('cancel')

const USAGE = [
    '{"Active":"4","Reclaimable":"8.1GB (65%)","Size":"12.3GB","TotalCount":"30","Type":"Images"}',
    '{"Active":"2","Reclaimable":"10MB (50%)","Size":"20MB","TotalCount":"6","Type":"Containers"}',
    '{"Active":"3","Reclaimable":"1GB (40%)","Size":"2.5GB","TotalCount":"9","Type":"Local Volumes"}',
    '{"Active":"0","Reclaimable":"4GB","Size":"4GB","TotalCount":"80","Type":"Build Cache"}',
].join('\n')

const ROOT_COMPOSE = `
include:
    - docker-compose.nats.yml
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
            file: nested/base.yml
            service: base
    admin:
        profiles: ["dev"]
    test-runner:
        profiles: ["dev"]
    optional-sidecar:
        profiles: ["dev"]
`

const NATS_COMPOSE = `
services:
    nats-1:
        profiles: ["main"]
`

const BASE_COMPOSE = `
services:
    base:
        profiles: ["dev"]
`

const GROUPS = [
    {
        label: 'Application',
        services: [
            'web',
            'api',
            'removed-from-compose',
        ],
    },
    {
        label: 'Messaging',
        groups: [{
            label: 'NATS',
            services: ['nats-1'],
        }],
    },
    {
        label: 'Retired',
        services: ['also-removed'],
    },
]

describe('dev console', () => {
    let workspace: string

    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-console-'))
        fs.mkdirSync(path.join(workspace, 'infrastructure/docker/nested'), { recursive: true })
        fs.writeFileSync(path.join(workspace, 'infrastructure/docker/docker-compose.yml'), ROOT_COMPOSE)
        fs.writeFileSync(path.join(workspace, 'infrastructure/docker/docker-compose.nats.yml'), NATS_COMPOSE)
        fs.writeFileSync(path.join(workspace, 'infrastructure/docker/nested/base.yml'), BASE_COMPOSE)
    })

    afterEach(() => {
        fs.rmSync(workspace, {
            recursive: true,
            force: true,
        })
    })

    describe('compose catalog', () => {
        it('reads included files and records which file owns each service', () => {
            const catalog = new ComposeCatalog(workspace, ROOT_COMPOSE_PATH)

            expect(catalog.fileOf('web')).toBe('infrastructure/docker/docker-compose.yml')
            expect(catalog.fileOf('nats-1')).toBe('infrastructure/docker/docker-compose.nats.yml')
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

    describe('service tree', () => {
        const buildTree = (): ServiceTree =>
            new ServiceTree(
                new ComposeCatalog(workspace, ROOT_COMPOSE_PATH),
                GROUPS,
                ROOT_COMPOSE_PATH,
                'main',
            )

        it('drops names Compose no longer has and removes groups left empty', () => {
            const labels = buildTree().roots.filter(node => !node.choices).map(node => node.label)

            expect(labels).toEqual(['Application', 'Messaging', 'Other services'])
            expect(buildTree().allServices).not.toContain('removed-from-compose')
        })

        it('keeps an ungrouped main-profile service in the tree instead of losing it', () => void expect(buildTree().baseServices).toContain('always-on'))

        it('hides runners that no group names', () => void expect(JSON.stringify(buildTree().roots)).not.toContain('test-runner'))

        it('offers Base and All as one radio row above the groups', () => {
            const tree = buildTree()
            const [base, all] = tree.roots[0].choices!

            expect(base.selection).toEqual(tree.baseServices)
            expect(all.selection).toEqual(tree.allServices)
        })

        it('uses profileless services as the base stack when no profile is configured', () => {
            const tree = new ServiceTree(
                new ComposeCatalog(workspace, ROOT_COMPOSE_PATH),
                [],
                ROOT_COMPOSE_PATH,
            )

            expect(tree.baseServices).toEqual(['always-on'])
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

        it('takes the base stack from the main profile, so a grouped dev service stays out of it', () => {
            const tree = new ServiceTree(
                new ComposeCatalog(workspace, ROOT_COMPOSE_PATH),
                [{
                    label: 'Application',
                    services: ['web', 'admin'],
                }],
                ROOT_COMPOSE_PATH,
                'main',
            )

            expect(tree.allServices).toContain('admin')
            expect(tree.baseServices).toContain('web')
            expect(tree.baseServices).not.toContain('admin')
        })

        it('labels a group with its partial file only when one partial owns it', () => {
            const [application, messaging] = buildTree().roots.filter(node => !node.choices)

            expect(application.hint).toBeUndefined()
            expect(messaging.hint).toBe('docker-compose.nats.yml')
        })

        it('describes the base stack, the whole tree and a partial choice', () => {
            const tree = new ServiceTree(
                new ComposeCatalog(workspace, ROOT_COMPOSE_PATH),
                [{
                    label: 'Application',
                    services: ['web', 'admin'],
                }],
                ROOT_COMPOSE_PATH,
                'main',
            )

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

            expect(values).toEqual(['login', 'start', 'mode', 'deploy', 'fixed', 'prune', 'plain', 'exit'])
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
                options: { rebuild: 'true' },
                selected: ['web'],
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

        it('warns before pruning named volumes', async () => {
            vi.mocked(prompts.log.warn).mockClear()
            treePrompt.mockResolvedValueOnce(['volumes-all'])
            vi.mocked(prompts.confirm).mockResolvedValueOnce(true)

            await runPrune()

            expect(prompts.log.warn).toHaveBeenCalled()
        })
    })
})
