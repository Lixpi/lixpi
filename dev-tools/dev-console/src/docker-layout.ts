import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse } from 'yaml'

export const DOCKER_ROOT = 'infrastructure/docker'
export const GROUP_FILE = 'docker-group.json'
export const STACK_FILE = 'docker-compose.yml'

const KINDS = ['services', 'utilities'] as const
const COMPOSE_FILE_PATTERN = /^docker-compose\.[a-z0-9]+(?:-[a-z0-9]+)*\.yml$/u
const README_FILE = 'README.md'

export type GroupKind = typeof KINDS[number]

type GroupMeta = {
    label?: unknown
    description?: unknown
    order?: unknown
    kind?: unknown
    baseProfile?: unknown
}

export type DockerGroup = {
    // Relative to the repository, like every path here.
    directory: string
    label: string
    description?: string
    order?: number

    // The Compose partials directly in this directory, sorted by name.
    files: string[]
    groups: DockerGroup[]
}

type StackFile = {
    include?: (string | { path: string | string[] })[]
    services?: Record<string, unknown>
}

export class DockerLayoutError extends Error {
    constructor(readonly problems: string[]) {
        super(`${DOCKER_ROOT} breaks the layout rules:\n- ${problems.join('\n- ')}`)
    }
}

// Every repository keeps its Compose files in the same shape:
//
//   infrastructure/docker/
//     docker-group.json        label and the base profile
//     docker-compose.yml       the application stack, includes every services/ partial
//     services/                the stack's partials, one directory per group
//     utilities/               tools that run from their own files, never included
//
// Every directory has a docker-group.json, and partials are named
// docker-compose.<name>.yml. read() checks all of it and reports every problem at
// once, so the console never draws a tree from a layout it misunderstands.
export class DockerLayout {
    readonly stackFile = `${DOCKER_ROOT}/${STACK_FILE}`
    readonly label: string
    readonly baseProfile?: string
    readonly services?: DockerGroup
    readonly utilities?: DockerGroup

    private readonly problems: string[] = []

    private constructor(private readonly workspacePath: string) {
        const meta = this.readMeta(DOCKER_ROOT)

        this.label = this.labelOf(DOCKER_ROOT, meta)
        this.baseProfile = this.baseProfileOf(meta)

        const groups = new Map<GroupKind, DockerGroup>()

        for (const entry of this.entries(DOCKER_ROOT)) {
            const entryPath = `${DOCKER_ROOT}/${entry.name}`

            if (entry.isDirectory()) {
                const group = this.readKindGroup(entryPath)

                if (group)
                    groups.set(entry.name as GroupKind, group)

                continue
            }

            if (![GROUP_FILE, STACK_FILE, README_FILE].includes(entry.name))
                this.problems.push(`${entryPath} belongs in services/ or utilities/.`)
        }

        this.services = groups.get('services')
        this.utilities = groups.get('utilities')
        this.checkStack()

        if (this.problems.length)
            throw new DockerLayoutError(this.problems)
    }

    static read(workspacePath: string): DockerLayout {
        return new DockerLayout(workspacePath)
    }

    // The partials under a group and every group below it.
    static filesIn(group: DockerGroup): string[] {
        return [
            ...group.files,
            ...group.groups.flatMap(child => DockerLayout.filesIn(child)),
        ]
    }

    private readKindGroup(directory: string): DockerGroup | undefined {
        const name = path.basename(directory)
        const meta = this.readMeta(directory)

        if (!KINDS.includes(name as GroupKind)) {
            this.problems.push(`${directory} must be services/ or utilities/.`)

            return undefined
        }

        if (
            meta
            && meta.kind !== name
        )
            this.problems.push(`${directory}/${GROUP_FILE} must set "kind": "${name}".`)

        const group = this.readGroup(directory, meta)

        if (group.files.length)
            this.problems.push(
                `${directory} holds only group directories, so move ${group.files.map(file => path.basename(file)).join(', ')} into one.`,
            )

        return group
    }

    private readGroup(
        directory: string,
        meta: GroupMeta | undefined,
    ): DockerGroup {
        // Without its docker-group.json a directory is still walked, so the partials
        // in it don't also show up as unknown files in the stack check.
        const settings = meta ?? {}

        if (
            directory.split('/').length > DOCKER_ROOT.split('/').length + 1
            && (settings.kind !== undefined || settings.baseProfile !== undefined)
        )
            this.problems.push(`${directory}/${GROUP_FILE} can't set "kind" or "baseProfile", only the top directories can.`)

        if (
            settings.order !== undefined
            && typeof settings.order !== 'number'
        )
            this.problems.push(`${directory}/${GROUP_FILE} must give "order" as a number.`)

        if (
            settings.description !== undefined
            && typeof settings.description !== 'string'
        )
            this.problems.push(`${directory}/${GROUP_FILE} must give "description" as text.`)

        const files: string[] = []
        const groups: DockerGroup[] = []

        for (const entry of this.entries(directory)) {
            const entryPath = `${directory}/${entry.name}`

            if (entry.isDirectory()) {
                groups.push(
                    this.readGroup(
                        entryPath,
                        this.readMeta(entryPath),
                    ),
                )
            } else if (COMPOSE_FILE_PATTERN.test(entry.name))
                files.push(entryPath)
            else if (![GROUP_FILE, README_FILE].includes(entry.name))
                this.problems.push(`${entryPath} isn't a docker-compose.<name>.yml partial.`)
        }

        if (
            !files.length
            && !groups.length
        )
            this.problems.push(`${directory} has no partials and no groups.`)

        return {
            directory,
            label: this.labelOf(directory, meta),
            description: typeof settings.description === 'string' ? settings.description : undefined,
            order: typeof settings.order === 'number' ? settings.order : undefined,
            files: files.sort(),
            groups: groups.sort((left, right) => (left.order ?? Infinity) - (right.order ?? Infinity) || left.label.localeCompare(right.label)),
        }
    }

    // The stack includes exactly the services partials: a missing one couldn't
    // start, and a utility would start with every `up`.
    private checkStack(): void {
        const serviceFiles = this.services ? DockerLayout.filesIn(this.services) : []
        const stackPath = path.join(this.workspacePath, this.stackFile)

        if (!fs.existsSync(stackPath)) {
            if (serviceFiles.length)
                this.problems.push(`${this.stackFile} is missing, and it must include every partial under services/.`)

            return
        }

        const stack = (parse(
            fs.readFileSync(stackPath, 'utf8'),
        ) ?? {}) as StackFile
        const included = (stack.include ?? []).flatMap(entry => (typeof entry === 'string' ? [entry] : [entry.path].flat())).map(
            entry => path.normalize(`${DOCKER_ROOT}/${entry}`),
        )

        if (Object.keys(stack.services ?? {}).length)
            this.problems.push(`${this.stackFile} declares services. Move them into a partial under services/.`)

        for (const file of serviceFiles.filter(candidate => !included.includes(candidate)))
            this.problems.push(`${this.stackFile} doesn't include ${file}.`)

        for (const file of included.filter(candidate => !serviceFiles.includes(candidate)))
            this.problems.push(`${this.stackFile} includes ${file}, which isn't a partial under services/.`)
    }

    private readMeta(directory: string): GroupMeta | undefined {
        const metaPath = path.join(
            this.workspacePath,
            directory,
            GROUP_FILE,
        )

        if (!fs.existsSync(metaPath)) {
            this.problems.push(`${directory} needs a ${GROUP_FILE}.`)

            return undefined
        }

        try {
            const meta = JSON.parse(
                fs.readFileSync(metaPath, 'utf8'),
            ) as unknown

            if (
                meta
                && typeof meta === 'object'
                && !Array.isArray(meta)
            )
                return meta as GroupMeta
        } catch {
            // Reported below.
        }

        this.problems.push(`${directory}/${GROUP_FILE} isn't a JSON object.`)

        return undefined
    }

    private labelOf(
        directory: string,
        meta: GroupMeta | undefined,
    ): string {
        if (
            typeof meta?.label === 'string'
            && meta.label.trim()
        )
            return meta.label

        if (meta)
            this.problems.push(`${directory}/${GROUP_FILE} needs a "label".`)

        return path.basename(directory)
    }

    private baseProfileOf(meta: GroupMeta | undefined): string | undefined {
        if (meta?.baseProfile === undefined)
            return undefined

        if (typeof meta.baseProfile === 'string')
            return meta.baseProfile

        this.problems.push(`${DOCKER_ROOT}/${GROUP_FILE} must give "baseProfile" as text.`)

        return undefined
    }

    private entries(directory: string): fs.Dirent[] {
        const absolute = path.join(this.workspacePath, directory)

        if (!fs.existsSync(absolute)) {
            this.problems.push(`${directory} is missing.`)

            return []
        }

        return fs
            .readdirSync(absolute, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.'))
            .sort((left, right) => left.name.localeCompare(right.name))
    }
}
