'use strict'

import { readFile, writeFile, rename, mkdir, readdir, unlink, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// The parameter tree is the AI Model Registry's source of truth. There is no
// separate database or index: the directory layout defines the registry shape.
//
//   params/_meta.json                 catalog-level metadata and the legend
//   params/<type>/_meta.json          one media type: reasoning, image, video
//   params/<type>/<provider>/_meta.json   provider and group metadata
//   params/<type>/<provider>/<key>.json   one parameter, details and decision

export type Decision = 'skip' | 'internal' | 'expose'
export type Status = 'none' | 'approved' | 'needs-param-clarification' | 'needs-implementation-investigation'

export type ParamRecord = {
    key: string
    category: string
    apiField: string
    controlKey: string | null
    type: string
    values?: string[]
    range?: string
    providerDefault: string | null
    lixpiValue: string | null
    currentState: string
    availability: string
    summary: string
    combines: string[]
    usage?: Record<string, string>
    supportedModels: string[]
    unsupportedModels: string[]
    supportedApis: string[]
    unsupportedApis: string[]
    sources: string[]
    decision: Decision
    reviewed: boolean
    status: Status
    irrelevant: boolean
    fixedValue: string
    defaultValue: string
    note: string
}

export type GroupMeta = {
    providerId: string
    providerTitle: string
    apiName: string
    groupId: string
    title: string
    models: string[]
    docs: string
}

export type TypeMeta = { mediaType: string; title: string; order: number }

export type LoadedGroup = {
    dir: string
    meta: GroupMeta
    type: TypeMeta
    parameters: ParamRecord[]
}

export type LoadedTree = {
    root: Record<string, unknown>
    groups: LoadedGroup[]
}

export const DECISIONS: ReadonlySet<string> = new Set(['skip', 'internal', 'expose'])

export const STATUSES: ReadonlySet<string> = new Set([
    'none',
    'approved',
    'needs-param-clarification',
    'needs-implementation-investigation',
])

// Earlier shapes of the sign-off field, so a file written before the rename
// keeps its flag instead of silently reverting to `none`.
const LEGACY_STATUSES: Record<string, Status> = {
    'needs-investigation': 'needs-param-clarification',
}

export const readStatus = (raw: { status?: string; needsInvestigation?: boolean } | undefined): Status => {
    if (!raw) return 'none'
    if (STATUSES.has(raw.status ?? '')) return raw.status as Status
    if (raw.status && LEGACY_STATUSES[raw.status]) return LEGACY_STATUSES[raw.status]
    return raw.needsInvestigation === true ? 'needs-param-clarification' : 'none'
}

const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T

// Writes through a temp file in the same directory so a crashed or concurrent
// save can never leave a half-written parameter behind.
const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.tmp`
    await writeFile(temp, `${JSON.stringify(value, null, 4)}\n`, 'utf8')
    await rename(temp, path)
}

const listDirs = async (path: string): Promise<string[]> => {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => e.name).sort()
}

const listParamFiles = async (path: string): Promise<string[]> => {
    const entries = await readdir(path, { withFileTypes: true })
    return entries
        .filter(e => e.isFile() && e.name.endsWith('.json') && e.name !== '_meta.json' && !e.name.endsWith('.tmp'))
        .map(e => e.name)
        .sort()
}

export class ParamTree {
    private readonly root: string
    private readonly historyDir: string

    constructor(root: string) {
        this.root = root
        this.historyDir = join(dirname(root), 'history')
    }

    paramPath(providerId: string, groupId: string, key: string, groups: LoadedGroup[]): string | null {
        const group = groups.find(g => g.meta.providerId === providerId && g.meta.groupId === groupId)
        return group ? join(group.dir, `${key}.json`) : null
    }

    // Walks the tree every time rather than caching: the files are small, and a
    // stale cache after a hand edit is a worse problem than a few reads.
    async load(): Promise<LoadedTree> {
        const rootMeta = await readJson<Record<string, unknown>>(join(this.root, '_meta.json'))
        const groups: LoadedGroup[] = []

        for (const typeName of await listDirs(this.root)) {
            const typeDir = join(this.root, typeName)
            const type = await readJson<TypeMeta>(join(typeDir, '_meta.json'))

            for (const providerName of await listDirs(typeDir)) {
                const dir = join(typeDir, providerName)
                const meta = await readJson<GroupMeta>(join(dir, '_meta.json'))
                const parameters: ParamRecord[] = []

                for (const file of await listParamFiles(dir)) {
                    const record = await readJson<ParamRecord>(join(dir, file))
                    record.decision = DECISIONS.has(record.decision) ? record.decision : 'skip'
                    record.status = readStatus(record)
                    record.reviewed = record.reviewed === true
                    record.irrelevant = record.irrelevant === true
                    record.fixedValue = typeof record.fixedValue === 'string' ? record.fixedValue : ''
                    record.defaultValue = typeof record.defaultValue === 'string' ? record.defaultValue : ''
                    record.note = typeof record.note === 'string' ? record.note : ''
                    record.supportedModels = Array.isArray(record.supportedModels) ? record.supportedModels : []
                    record.supportedApis = Array.isArray(record.supportedApis) ? record.supportedApis : []
                    record.unsupportedModels = Array.isArray(record.unsupportedModels) ? record.unsupportedModels : []
                    record.unsupportedApis = Array.isArray(record.unsupportedApis) ? record.unsupportedApis : []
                    record.sources = Array.isArray(record.sources) ? record.sources : []
                    record.category = typeof record.category === 'string' && record.category ? record.category : 'uncategorised'
                    parameters.push(record)
                }

                // Filename order. Nothing to maintain when a parameter is added
                // or removed, which is the point of the split layout.
                parameters.sort((a, b) => a.key.localeCompare(b.key))
                groups.push({ dir, meta, type, parameters })
            }
        }

        // Media types read in their declared order; providers keep the order the
        // directory listing gives, which is alphabetical and stable.
        groups.sort((a, b) => a.type.order - b.type.order || a.meta.providerId.localeCompare(b.meta.providerId))
        return { root: rootMeta, groups }
    }

    // Copies every parameter file that is about to change into history/ under one
    // timestamped folder. Only bulk edits driven through the API ask for this;
    // a checkbox in the page writes straight to the file, because redoing one
    // tick is easier than digging a snapshot out.
    async snapshot(paths: string[]): Promise<void> {
        if (paths.length === 0) return
        const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/u, 'Z')
        const target = join(this.historyDir, `params-${stamp}`)
        try {
            for (const path of paths) {
                const relative = path.slice(this.root.length + 1)
                const destination = join(target, relative)
                await mkdir(dirname(destination), { recursive: true })
                await copyFile(path, destination)
            }
            await this.prune()
        } catch (error) {
            console.error('[ai-model-registry] could not snapshot parameter files:', error)
        }
    }

    private async prune(limit = 100): Promise<void> {
        const entries = (await readdir(this.historyDir, { withFileTypes: true }))
            .filter(e => e.isDirectory() && e.name.startsWith('params-'))
            .map(e => e.name)
            .sort()
        for (const stale of entries.slice(0, Math.max(0, entries.length - limit))) {
            const dir = join(this.historyDir, stale)
            for (const file of await readdir(dir, { recursive: true, withFileTypes: true })) {
                if (file.isFile()) await unlink(join(file.parentPath ?? dir, file.name))
            }
        }
    }

    async writeParam(path: string, record: ParamRecord): Promise<void> {
        await writeJsonAtomic(path, record)
    }

    async writeGroupMeta(path: string, meta: GroupMeta): Promise<void> {
        await writeJsonAtomic(path, meta)
    }
}
