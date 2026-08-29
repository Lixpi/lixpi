'use strict'

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

import {
    DECISIONS,
    ParamTree,
    STATUSES,
    readStatus,
    type Decision,
    type LoadedGroup,
    type ParamRecord,
    type Status,
} from './store.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(HERE, '..', 'public')

const PORT = Number(process.env.PORT ?? 3010)
const PARAMS_DIR = process.env.PARAMS_DIR ?? '/usr/src/service/data/params'

const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
}

// The client sends the whole map on every save; only the parameters whose
// decision fields actually moved get rewritten.
type SelectionEntry = {
    decision: Decision
    reviewed: boolean
    status: Status
    irrelevant: boolean
    fixedValue: string
    defaultValue: string
    note: string
}

type SelectionMap = Record<string, SelectionEntry>

const DECISION_FIELDS = ['decision', 'reviewed', 'status', 'irrelevant', 'fixedValue', 'defaultValue', 'note'] as const

// Documentation fields an agent may rewrite through the API. `key` is absent on
// purpose: it is the file's identity, and renaming it would orphan the decision
// attached to that parameter.
const DOCUMENTATION_FIELDS = [
    'category', 'apiField', 'controlKey', 'type', 'values', 'range', 'providerDefault', 'lixpiValue',
    'currentState', 'availability', 'summary', 'combines', 'usage',
    'supportedModels', 'unsupportedModels', 'supportedApis', 'unsupportedApis', 'sources',
] as const

const GROUP_DOCUMENTATION_FIELDS = ['title', 'models', 'docs'] as const

const EDITABLE_FIELDS: ReadonlySet<string> = new Set([...DOCUMENTATION_FIELDS, ...DECISION_FIELDS])
const EDITABLE_GROUP_FIELDS: ReadonlySet<string> = new Set(GROUP_DOCUMENTATION_FIELDS)

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
        size += chunk.length
        if (size > 4_000_000) throw new Error('PAYLOAD_TOO_LARGE')
        chunks.push(chunk as Buffer)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const paramKey = (group: LoadedGroup, param: ParamRecord): string =>
    `${group.meta.providerId}/${group.meta.groupId}/${param.key}`

class ParamPickerServer {
    private readonly tree: ParamTree
    private readonly port: number
    constructor(tree: ParamTree, port: number) {
        this.tree = tree
        this.port = port
    }

    // Assembles the catalog the page renders. Every parameter carries the models
    // and API surfaces it can reach, and each group carries the union of those
    // plus the categories it contains, so the client can filter and group
    // without a second request.
    private static assemble(groups: LoadedGroup[], root: Record<string, unknown>) {
        const providers = new Map<string, Record<string, unknown>>()

        for (const group of groups) {
            const models = new Set<string>()
            const apis = new Set<string>()
            const categories = new Set<string>()
            for (const param of group.parameters) {
                for (const model of param.supportedModels) models.add(model)
                for (const api of param.supportedApis) apis.add(api)
                categories.add(param.category)
            }

            const provider = providers.get(group.meta.providerId) ?? {
                id: group.meta.providerId,
                title: group.meta.providerTitle,
                apiName: group.meta.apiName,
                groups: [] as unknown[],
            }
            ;(provider.groups as unknown[]).push({
                id: group.meta.groupId,
                title: group.meta.title,
                mediaType: group.type.mediaType,
                mediaTitle: group.type.title,
                models: group.meta.models,
                docs: group.meta.docs,
                supportedModels: [...models].sort(),
                supportedApis: [...apis].sort(),
                categories: [...categories],
                parameters: group.parameters,
            })
            providers.set(group.meta.providerId, provider)
        }

        return { ...root, providers: [...providers.values()] }
    }

    private static send(res: ServerResponse, status: number, body: string | Buffer, contentType: string): void {
        res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' })
        res.end(body)
    }

    private static sendJson(res: ServerResponse, status: number, value: unknown): void {
        ParamPickerServer.send(res, status, JSON.stringify(value), 'application/json; charset=utf-8')
    }

    private async serveStatic(res: ServerResponse, pathname: string): Promise<void> {
        const relative = pathname === '/'
            ? 'index.html'
            : normalize(pathname).replace(/^(\.\.[/\\])+/u, '').replace(/^[/\\]+/u, '')
        const filePath = join(PUBLIC_DIR, relative)
        if (!filePath.startsWith(PUBLIC_DIR)) {
            ParamPickerServer.send(res, 403, 'Forbidden', 'text/plain; charset=utf-8')
            return
        }
        try {
            const file = await readFile(filePath)
            ParamPickerServer.send(res, 200, file, CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream')
        } catch {
            ParamPickerServer.send(res, 404, 'Not found', 'text/plain; charset=utf-8')
        }
    }

    private static summarise(groups: LoadedGroup[], incoming: SelectionMap): Record<string, number> {
        const counts: Record<string, number> = {
            total: 0, expose: 0, internal: 0, skip: 0, reviewed: 0, unreviewed: 0,
            approved: 0, needsParamClarification: 0, needsImplementationInvestigation: 0, irrelevant: 0,
        }
        for (const group of groups) {
            for (const param of group.parameters) {
                const entry = incoming[paramKey(group, param)]
                const decision = entry && DECISIONS.has(entry.decision) ? entry.decision : param.decision
                const status = entry ? readStatus(entry) : param.status
                const reviewed = entry ? entry.reviewed === true : param.reviewed
                counts.total += 1
                counts[decision] += 1
                counts[reviewed ? 'reviewed' : 'unreviewed'] += 1
                if (status === 'approved') counts.approved += 1
                if (status === 'needs-param-clarification') counts.needsParamClarification += 1
                if (status === 'needs-implementation-investigation') counts.needsImplementationInvestigation += 1
                if (entry ? entry.irrelevant === true : param.irrelevant) counts.irrelevant += 1
            }
        }
        return counts
    }

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

        if (req.method === 'GET' && pathname === '/api/catalog') {
            const { root, groups } = await this.tree.load()
            ParamPickerServer.sendJson(res, 200, ParamPickerServer.assemble(groups, root))
            return
        }

        if (req.method === 'GET' && pathname === '/api/selections') {
            const { groups } = await this.tree.load()
            const selections: SelectionMap = {}
            for (const group of groups) {
                for (const param of group.parameters) {
                    selections[paramKey(group, param)] = {
                        decision: param.decision,
                        reviewed: param.reviewed,
                        status: param.status,
                        irrelevant: param.irrelevant,
                        fixedValue: param.fixedValue,
                        defaultValue: param.defaultValue,
                        note: param.note,
                    }
                }
            }
            ParamPickerServer.sendJson(res, 200, { selections, path: PARAMS_DIR })
            return
        }

        if (req.method === 'PUT' && pathname === '/api/selections') {
            // Ticking a box is a one-field edit the page can simply redo, so the
            // UI path writes straight to the file. A bulk edit driven through the
            // API is the case worth a snapshot, and it opts in with ?snapshot=1.
            const wantsSnapshot = new URL(req.url ?? '/', 'http://localhost').searchParams.get('snapshot') === '1'
            const body = await readJsonBody(req) as { selections?: SelectionMap }
            const incoming = body.selections ?? {}
            const { groups } = await this.tree.load()

            // Refuse a save that would drop reviewed decisions on the floor. The
            // page always sends the full map, so a shrinking reviewed count means
            // a bug or a stray request, never a real edit.
            const storedReviewed = groups.reduce(
                (total, group) => total + group.parameters.filter(param => param.reviewed).length, 0)
            const incomingReviewed = Object.values(incoming).filter(entry => entry?.reviewed === true).length
            if (incomingReviewed < storedReviewed) {
                ParamPickerServer.sendJson(res, 409, {
                    error: 'REFUSING_TO_DISCARD_REVIEWED_DECISIONS',
                    storedReviewed,
                    incomingReviewed,
                    hint: 'The tree holds more reviewed decisions than this save carries. Nothing was written.',
                })
                return
            }

            const pending: Array<{ path: string; record: ParamRecord }> = []
            for (const group of groups) {
                for (const param of group.parameters) {
                    const entry = incoming[paramKey(group, param)]
                    if (!entry) continue

                    const decision: Decision = DECISIONS.has(entry.decision) ? entry.decision : param.decision
                    const status = readStatus(entry)
                    const next: ParamRecord = {
                        ...param,
                        decision,
                        reviewed: entry.reviewed === true,
                        status: STATUSES.has(status) ? status : 'none',
                        irrelevant: entry.irrelevant === true,
                        // Each value belongs to exactly one decision, and is cleared
                        // otherwise so a file never holds a value nothing uses.
                        fixedValue: decision === 'internal' ? entry.fixedValue ?? '' : '',
                        defaultValue: decision === 'expose' ? entry.defaultValue ?? '' : '',
                        note: typeof entry.note === 'string' ? entry.note : '',
                    }
                    if (DECISION_FIELDS.some(field => next[field] !== param[field])) {
                        pending.push({ path: join(group.dir, `${param.key}.json`), record: next })
                    }
                }
            }

            if (wantsSnapshot) await this.tree.snapshot(pending.map(item => item.path))
            for (const { path, record } of pending) await this.tree.writeParam(path, record)

            ParamPickerServer.sendJson(res, 200, {
                ok: true,
                written: pending.length,
                snapshotted: wantsSnapshot,
                summary: ParamPickerServer.summarise(groups, incoming),
                path: PARAMS_DIR,
            })
            return
        }

        // The agent-facing write path. Unlike the page's save it can rewrite
        // documentation fields, and it always snapshots first, because a bulk
        // rewrite of researched prose is not something you can redo from memory.
        if (req.method === 'PATCH' && pathname === '/api/params') {
            const body = await readJsonBody(req) as {
                params?: Record<string, Record<string, unknown>>
                groups?: Record<string, Record<string, unknown>>
            }
            const incoming = body.params ?? {}
            const incomingGroups = body.groups ?? {}
            const { groups } = await this.tree.load()

            const index = new Map<string, { group: LoadedGroup; param: ParamRecord }>()
            for (const group of groups) {
                for (const param of group.parameters) index.set(paramKey(group, param), { group, param })
            }
            const groupIndex = new Map(groups.map(group => [
                `${group.meta.providerId}/${group.meta.groupId}`,
                group,
            ]))

            const unknownKeys = Object.keys(incoming).filter(key => !index.has(key))
            const unknownFields = Object.entries(incoming).flatMap(([key, patch]) =>
                Object.keys(patch).filter(field => !EDITABLE_FIELDS.has(field)).map(field => `${key}.${field}`))
            const unknownGroupKeys = Object.keys(incomingGroups).filter(key => !groupIndex.has(key))
            const unknownGroupFields = Object.entries(incomingGroups).flatMap(([key, patch]) =>
                Object.keys(patch).filter(field => !EDITABLE_GROUP_FIELDS.has(field)).map(field => `${key}.${field}`))
            const invalidGroupValues = Object.entries(incomingGroups).flatMap(([key, patch]) => {
                const invalid: string[] = []
                if ('title' in patch && (typeof patch.title !== 'string' || patch.title.trim().length === 0)) {
                    invalid.push(`${key}.title`)
                }
                if ('docs' in patch && (typeof patch.docs !== 'string' || patch.docs.trim().length === 0)) {
                    invalid.push(`${key}.docs`)
                }
                if ('models' in patch && (!Array.isArray(patch.models)
                    || patch.models.length === 0
                    || patch.models.some(model => typeof model !== 'string' || model.trim().length === 0)
                    || new Set(patch.models).size !== patch.models.length)) {
                    invalid.push(`${key}.models`)
                }
                return invalid
            })
            if (unknownKeys.length > 0 || unknownFields.length > 0
                || unknownGroupKeys.length > 0 || unknownGroupFields.length > 0
                || invalidGroupValues.length > 0) {
                ParamPickerServer.sendJson(res, 400, {
                    error: invalidGroupValues.length > 0 ? 'INVALID_VALUE' : 'UNKNOWN_TARGET',
                    unknownKeys,
                    unknownFields,
                    unknownGroupKeys,
                    unknownGroupFields,
                    invalidGroupValues,
                    hint: 'This endpoint updates existing parameters and group documentation only. It cannot create, rename or delete a parameter or group.',
                })
                return
            }

            const pendingParams: Array<{ path: string; record: ParamRecord }> = []
            for (const [key, patch] of Object.entries(incoming)) {
                const { group, param } = index.get(key)!
                const next = { ...param, ...patch } as ParamRecord
                if (JSON.stringify(next) !== JSON.stringify(param)) {
                    pendingParams.push({ path: join(group.dir, `${param.key}.json`), record: next })
                }
            }

            const pendingGroups: Array<{ path: string; meta: LoadedGroup['meta'] }> = []
            for (const [key, patch] of Object.entries(incomingGroups)) {
                const group = groupIndex.get(key)!
                const next = { ...group.meta, ...patch } as LoadedGroup['meta']
                if (JSON.stringify(next) !== JSON.stringify(group.meta)) {
                    pendingGroups.push({ path: join(group.dir, '_meta.json'), meta: next })
                }
            }

            const snapshotPaths = [
                ...pendingParams.map(item => item.path),
                ...pendingGroups.map(item => item.path),
            ]
            await this.tree.snapshot(snapshotPaths)
            for (const { path, record } of pendingParams) await this.tree.writeParam(path, record)
            for (const { path, meta } of pendingGroups) await this.tree.writeGroupMeta(path, meta)

            ParamPickerServer.sendJson(res, 200, {
                ok: true,
                written: pendingParams.length,
                writtenGroups: pendingGroups.length,
                snapshotted: snapshotPaths.length > 0,
                path: PARAMS_DIR,
            })
            return
        }

        if (req.method === 'GET') {
            await this.serveStatic(res, pathname)
            return
        }

        ParamPickerServer.send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8')
    }

    start(): void {
        const server = createServer((req, res) => {
            this.handle(req, res).catch(error => {
                console.error(`[param-picker] ${req.method} ${req.url} failed:`, error)
                if (!res.headersSent) ParamPickerServer.sendJson(res, 500, { error: String((error as Error).message ?? error) })
                else res.end()
            })
        })

        server.listen(this.port, '0.0.0.0', () => {
            console.log(`[param-picker] listening on http://0.0.0.0:${this.port}`)
            console.log(`[param-picker] reading parameters from ${PARAMS_DIR}`)
        })

        const shutdown = () => server.close(() => process.exit(0))
        process.on('SIGTERM', shutdown)
        process.on('SIGINT', shutdown)
    }
}

new ParamPickerServer(new ParamTree(PARAMS_DIR), PORT).start()
