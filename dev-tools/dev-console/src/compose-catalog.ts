import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse } from 'yaml'

// Paths the console container mounts. Compose files can extend base services from
// either checkout through these variables, so those references must resolve here too.
const LIXPI_MOUNT = '/lixpi'
const WORKSPACE_REFERENCE = /^\$\{[A-Z_]*REPOSITORY_PATH[^}]*\}/u
const LIXPI_REFERENCE = /^\$\{LIXPI_REPOSITORY_PATH[^}]*\}/u

export type ComposeService = {
    name: string
    file: string
    profiles: string[]
    dependsOn: string[]
}

type RawService = {
    extends?: string | {
        file?: string
        service: string
    }
    profiles?: string[]
    depends_on?: string[] | Record<string, { required?: unknown } | null>
}

type RawComposeFile = {
    include?: (string | { path: string | string[] })[]
    services?: Record<string, RawService>
}

// Reads the Compose files without interpolating them, so the service list is
// available before an environment file has been chosen.
export class ComposeCatalog {
    private readonly documents = new Map<string, RawComposeFile>()
    private readonly services = new Map<string, ComposeService>()

    constructor(
        private readonly workspacePath: string,
        rootFile: string,
        private readonly lixpiPath: string = LIXPI_MOUNT,
    ) {
        this.loadFile(rootFile)
    }

    all(): ComposeService[] {
        return [...this.services.values()]
    }

    has(name: string): boolean {
        return this.services.has(name)
    }

    // A service with no profile starts with every `up`, so it belongs to the
    // default stack just like a service that names the default profile.
    startsByDefault(
        name: string,
        baseProfile?: string,
    ): boolean {
        const profiles = this.services.get(name)?.profiles

        if (!profiles)
            return false

        return !profiles.length || (baseProfile !== undefined && profiles.includes(baseProfile))
    }

    fileOf(name: string): string | undefined {
        return this.services.get(name)?.file
    }

    // Everything Compose starts on its own because a selected service needs it.
    dependenciesOf(names: string[]): string[] {
        const selected = new Set(names)
        const visited = new Set<string>()
        const pending = [...names]

        while (pending.length) {
            const service = this.services.get(pending.pop()!)

            for (const dependency of service?.dependsOn ?? []) {
                if (visited.has(dependency))
                    continue

                visited.add(dependency)
                pending.push(dependency)
            }
        }

        return [...visited].filter(name => !selected.has(name))
    }

    private loadFile(file: string): void {
        const document = this.readDocument(file)

        for (const entry of document.include ?? []) {
            const includedPaths = typeof entry === 'string' ? [entry] : [entry.path].flat()

            for (const includedPath of includedPaths)
                this.loadFile(
                    this.relativeTo(file, includedPath),
                )
        }

        for (const [name, service] of Object.entries(document.services ?? {}))
            this.services.set(
                name,
                {
                    name,
                    file,
                    profiles: this.profilesOf(file, service),
                    dependsOn: this.dependenciesDeclaredBy(service),
                },
            )
    }

    private readDocument(file: string): RawComposeFile {
        const cached = this.documents.get(file)

        if (cached)
            return cached

        const document = (parse(
            fs.readFileSync(
                this.absolutePath(file),
                'utf8',
            ),
            { merge: true },
        ) ?? {}) as RawComposeFile

        this.documents.set(file, document)

        return document
    }

    // Compose inherits profiles through `extends`, and runner services declare
    // theirs only in the base file they extend.
    private profilesOf(
        file: string,
        service: RawService,
    ): string[] {
        if (service.profiles)
            return service.profiles

        if (!service.extends)
            return []

        const base = typeof service.extends === 'string'
            ? { service: service.extends }
            : service.extends
        const baseFile = base.file ? this.relativeTo(file, base.file) : file
        const baseService = this.readDocument(baseFile).services?.[base.service]

        return baseService ? this.profilesOf(baseFile, baseService) : []
    }

    private dependenciesDeclaredBy(service: RawService): string[] {
        const dependencies = service.depends_on

        if (!dependencies)
            return []

        if (Array.isArray(dependencies))
            return dependencies

        return Object
            .entries(dependencies)
            .filter(([, settings]) => settings?.required !== false)
            .map(([name]) => name)
    }

    private relativeTo(
        file: string,
        target: string,
    ): string {
        if (LIXPI_REFERENCE.test(target))
            return target.replace(LIXPI_REFERENCE, this.lixpiPath)

        if (WORKSPACE_REFERENCE.test(target))
            return path.relative(
                this.workspacePath,
                target.replace(WORKSPACE_REFERENCE, this.workspacePath),
            )

        return path.isAbsolute(file)
            ? path.join(
                path.dirname(file),
                target,
            )
            : path.normalize(
                path.join(
                    path.dirname(file),
                    target,
                ),
            )
    }

    private absolutePath(file: string): string {
        return path.isAbsolute(file) ? file : path.join(this.workspacePath, file)
    }
}
