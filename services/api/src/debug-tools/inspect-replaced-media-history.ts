'use strict'

import process from 'node:process'

import DynamoDBService from '@lixpi/dynamodb-service'
import NATS_Service from '@lixpi/nats-service'
import {
    formatStageResourceName,
    type CanvasNode,
    type CanvasState,
} from '@lixpi/constants'

type AnyRecord = Record<string, any>

type DebugArgs = {
    workspaceId: string
    threadId?: string
}

type CanvasMediaRecord = {
    source: 'canvas'
    nodeId: string
    type: 'image' | 'video'
    fileId?: string
    posterFileId?: string
    frameFileId?: string
    workspaceId?: string
    imageUrl?: string
    videoUrl?: string
    posterUrl?: string
    generationRequestId?: string
    reasoningRunId?: string
    mediaRunId?: string
    responseId?: string
    responseMessageId?: string
    reasoningModelId?: string
    mediaModelId?: string
    mediaType?: string
    variantIndex?: number
    branchId?: string
}

type ThreadMediaRecord = {
    source: 'thread'
    threadId: string
    path: string
    type: 'aiGeneratedImage' | 'aiGeneratedVideo'
    fileId?: string
    posterFileId?: string
    workspaceId?: string
    imageUrl?: string
    videoUrl?: string
    posterUrl?: string
    generationRequestId?: string
    reasoningRunId?: string
    mediaRunId?: string
    responseId?: string
    reasoningModelId?: string
    mediaModelId?: string
    mediaType?: string
    variantIndex?: number
    branchId?: string
    isPartial?: boolean
    isPending?: boolean
    errorMessage?: string
}

type MediaComparison = {
    canvas: CanvasMediaRecord
    thread?: ThreadMediaRecord
    matchKind: string
    status: 'ok' | 'mismatch' | 'missing-thread-node'
    differences: string[]
}

function readFlag(name: string, aliases: string[]): string | undefined {
    const flags = [name, ...aliases]
    for (const flag of flags) {
        const equalsArg = process.argv.find(arg => arg.startsWith(`${flag}=`))
        if (equalsArg) return equalsArg.slice(flag.length + 1)

        const index = process.argv.indexOf(flag)
        if (index >= 0) return process.argv[index + 1]
    }

    return undefined
}

function parseArgs(): DebugArgs {
    const workspaceId = readFlag('--workspace', ['--workspaceId'])
    if (!workspaceId) {
        throw new Error([
            'Usage:',
            'node src/debug-tools/inspect-replaced-media-history.ts --workspace <workspaceId> [--thread <threadId>]',
        ].join('\n'))
    }

    return {
        workspaceId,
        threadId: readFlag('--thread', ['--threadId']),
    }
}

function requireEnv(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required env var ${name}`)
    return value
}

function tableName(name: 'WORKSPACES' | 'AI_CHAT_THREADS'): string {
    const legacyNames = {
        WORKSPACES: 'Workspaces',
        AI_CHAT_THREADS: 'AI-Chat-Threads',
    } as const
    return formatStageResourceName(legacyNames[name], requireEnv('ORG_NAME'), requireEnv('STAGE'))
}

function createDynamoDbService(): DynamoDBService {
    const endpoint = process.env.DYNAMODB_ENDPOINT

    return new DynamoDBService({
        region: requireEnv('AWS_REGION'),
        ssoProfile: process.env.AWS_PROFILE ?? '',
        ...(endpoint ? { endpoint } : {}),
    })
}

async function createNatsService(): Promise<NATS_Service> {
    return await NATS_Service.init({
        servers: process.env.NATS_SERVERS as any,
        name: 'api-inspect-replaced-media-history',
        user: 'regular_user',
        pass: requireEnv('NATS_REGULAR_USER_PASSWORD'),
        ...(process.env.NATS_STREAM_REPLICAS ? { streamReplicas: Number(process.env.NATS_STREAM_REPLICAS) } : {}),
    })
}

function getGeneratedBy(node: CanvasNode): AnyRecord {
    return ((node as AnyRecord).generatedBy ?? {}) as AnyRecord
}

function mediaValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function collectCanvasMedia(canvasState: CanvasState | undefined): CanvasMediaRecord[] {
    const records: CanvasMediaRecord[] = []

    for (const node of canvasState?.nodes ?? []) {
        if (node.type !== 'image' && node.type !== 'video') continue

        const mediaNode = node as AnyRecord
        const generatedBy = getGeneratedBy(node)
        if (!generatedBy.generationRequestId && !generatedBy.mediaRunId && !generatedBy.responseId && !generatedBy.branchId) continue

        records.push({
            source: 'canvas',
            nodeId: mediaNode.nodeId,
            type: node.type,
            fileId: mediaValue(mediaNode.fileId),
            posterFileId: mediaValue(mediaNode.posterFileId),
            frameFileId: mediaValue(mediaNode.frameFileId),
            workspaceId: mediaValue(mediaNode.workspaceId),
            imageUrl: mediaValue(mediaNode.src),
            videoUrl: mediaValue(mediaNode.src),
            posterUrl: mediaValue(mediaNode.posterSrc),
            generationRequestId: mediaValue(generatedBy.generationRequestId),
            reasoningRunId: mediaValue(generatedBy.reasoningRunId),
            mediaRunId: mediaValue(generatedBy.mediaRunId),
            responseId: mediaValue(generatedBy.responseId),
            responseMessageId: mediaValue(generatedBy.responseMessageId),
            reasoningModelId: mediaValue(generatedBy.reasoningModelId),
            mediaModelId: mediaValue(generatedBy.mediaModelId),
            mediaType: mediaValue(generatedBy.mediaType),
            variantIndex: numberValue(generatedBy.variantIndex),
            branchId: mediaValue(generatedBy.branchId),
        })
    }

    return records
}

function compactPath(path: Array<string | number>): string {
    return path.map(part => typeof part === 'number' ? `[${part}]` : part).join('.')
}

function collectThreadMediaFromNode(
    node: AnyRecord,
    threadId: string,
    path: Array<string | number>,
    records: ThreadMediaRecord[],
): void {
    if (!node || typeof node !== 'object') return

    if (node.type === 'aiGeneratedImage' || node.type === 'aiGeneratedVideo') {
        const attrs = (node.attrs ?? {}) as AnyRecord
        records.push({
            source: 'thread',
            threadId,
            path: compactPath(path),
            type: node.type,
            fileId: mediaValue(attrs.fileId),
            posterFileId: mediaValue(attrs.posterFileId),
            workspaceId: mediaValue(attrs.workspaceId),
            imageUrl: mediaValue(attrs.imageData),
            videoUrl: mediaValue(attrs.videoUrl),
            posterUrl: mediaValue(attrs.posterUrl),
            generationRequestId: mediaValue(attrs.generationRequestId),
            reasoningRunId: mediaValue(attrs.reasoningRunId),
            mediaRunId: mediaValue(attrs.mediaRunId),
            responseId: mediaValue(attrs.responseId),
            reasoningModelId: mediaValue(attrs.reasoningModelId),
            mediaModelId: mediaValue(attrs.mediaModelId),
            mediaType: mediaValue(attrs.mediaType),
            variantIndex: numberValue(attrs.variantIndex),
            branchId: mediaValue(attrs.branchId),
            isPartial: typeof attrs.isPartial === 'boolean' ? attrs.isPartial : undefined,
            isPending: typeof attrs.isPending === 'boolean' ? attrs.isPending : undefined,
            errorMessage: mediaValue(attrs.errorMessage),
        })
    }

    if (!Array.isArray(node.content)) return

    node.content.forEach((child: unknown, index: number) => {
        collectThreadMediaFromNode(child as AnyRecord, threadId, [...path, 'content', index], records)
    })
}

function collectThreadMedia(threads: AnyRecord[]): ThreadMediaRecord[] {
    const records: ThreadMediaRecord[] = []

    for (const thread of threads) {
        collectThreadMediaFromNode(thread.content as AnyRecord, thread.threadId, ['content'], records)
    }

    return records
}

function indexThreadRecords(threadRecords: ThreadMediaRecord[]): Map<string, ThreadMediaRecord[]> {
    const indexed = new Map<string, ThreadMediaRecord[]>()

    const add = (key: string | undefined, record: ThreadMediaRecord): void => {
        if (!key) return
        indexed.set(key, [...(indexed.get(key) ?? []), record])
    }

    for (const record of threadRecords) {
        add(record.mediaRunId ? `mediaRunId:${record.mediaRunId}` : undefined, record)
        add(record.responseId ? `responseId:${record.responseId}` : undefined, record)
        add(
            record.generationRequestId && record.reasoningRunId && record.mediaModelId
                ? `run:${record.generationRequestId}:${record.reasoningRunId}:${record.mediaModelId}:${record.variantIndex ?? ''}`
                : undefined,
            record,
        )
    }

    return indexed
}

function findThreadRecord(
    canvasRecord: CanvasMediaRecord,
    indexedThreadRecords: Map<string, ThreadMediaRecord[]>,
): { record?: ThreadMediaRecord; matchKind: string } {
    const candidateKeys = [
        canvasRecord.mediaRunId ? { kind: 'mediaRunId', key: `mediaRunId:${canvasRecord.mediaRunId}` } : undefined,
        canvasRecord.responseId ? { kind: 'responseId', key: `responseId:${canvasRecord.responseId}` } : undefined,
        canvasRecord.generationRequestId && canvasRecord.reasoningRunId && canvasRecord.mediaModelId
            ? {
                kind: 'generationRun',
                key: `run:${canvasRecord.generationRequestId}:${canvasRecord.reasoningRunId}:${canvasRecord.mediaModelId}:${canvasRecord.variantIndex ?? ''}`,
            }
            : undefined,
    ].filter((entry): entry is { kind: string; key: string } => Boolean(entry))

    for (const { kind, key } of candidateKeys) {
        const records = indexedThreadRecords.get(key) ?? []
        const matchingType = records.find(record =>
            (canvasRecord.type === 'image' && record.type === 'aiGeneratedImage')
            || (canvasRecord.type === 'video' && record.type === 'aiGeneratedVideo')
        )
        if (matchingType) return { record: matchingType, matchKind: kind }
    }

    return { matchKind: 'none' }
}

function compareRecords(canvasRecord: CanvasMediaRecord, threadRecord?: ThreadMediaRecord, matchKind = 'none'): MediaComparison {
    if (!threadRecord) {
        return {
            canvas: canvasRecord,
            matchKind,
            status: 'missing-thread-node',
            differences: ['no matching generated-media node in stored thread content'],
        }
    }

    const differences: string[] = []

    if (canvasRecord.fileId !== threadRecord.fileId) {
        differences.push(`fileId canvas=${canvasRecord.fileId ?? ''} thread=${threadRecord.fileId ?? ''}`)
    }

    if (canvasRecord.type === 'video' && canvasRecord.posterFileId !== threadRecord.posterFileId) {
        differences.push(`posterFileId canvas=${canvasRecord.posterFileId ?? ''} thread=${threadRecord.posterFileId ?? ''}`)
    }

    if (canvasRecord.workspaceId !== threadRecord.workspaceId) {
        differences.push(`workspaceId canvas=${canvasRecord.workspaceId ?? ''} thread=${threadRecord.workspaceId ?? ''}`)
    }

    return {
        canvas: canvasRecord,
        thread: threadRecord,
        matchKind,
        status: differences.length > 0 ? 'mismatch' : 'ok',
        differences,
    }
}

function collectFileIds(canvasRecords: CanvasMediaRecord[], threadRecords: ThreadMediaRecord[]): string[] {
    const fileIds = new Set<string>()

    for (const record of canvasRecords) {
        for (const fileId of [record.fileId, record.posterFileId, record.frameFileId]) {
            if (fileId) fileIds.add(fileId)
        }
    }

    for (const record of threadRecords) {
        for (const fileId of [record.fileId, record.posterFileId]) {
            if (fileId) fileIds.add(fileId)
        }
    }

    return [...fileIds].sort()
}

async function inspectObjectStore(nats: NATS_Service, workspaceId: string, fileIds: string[]): Promise<AnyRecord> {
    const bucketName = `workspace-${workspaceId}-files`
    const objects = await nats.listObjects(bucketName)
    const objectNames = new Set(objects.map(object => object.name))

    return {
        bucketName,
        objectCount: objects.length,
        checkedFileIds: fileIds,
        missingCheckedObjects: fileIds.filter(fileId => !objectNames.has(fileId)),
    }
}

async function main(): Promise<void> {
    const args = parseArgs()
    const dynamo = createDynamoDbService()
    const nats = await createNatsService()

    try {
        const workspace = await dynamo.getItem({
            tableName: tableName('WORKSPACES'),
            key: { workspaceId: args.workspaceId },
            origin: `inspect-replaced-media-history:workspace(${args.workspaceId})`,
        }) as AnyRecord | undefined

        const threads = args.threadId
            ? [await dynamo.getItem({
                tableName: tableName('AI_CHAT_THREADS'),
                key: { workspaceId: args.workspaceId, threadId: args.threadId },
                origin: `inspect-replaced-media-history:thread(${args.workspaceId}:${args.threadId})`,
            }) as AnyRecord | undefined].filter((thread): thread is AnyRecord => Boolean(thread))
            : ((await dynamo.queryItems({
                tableName: tableName('AI_CHAT_THREADS'),
                keyConditions: { workspaceId: args.workspaceId },
                fetchAllItems: true,
                origin: `inspect-replaced-media-history:threads(${args.workspaceId})`,
            }))?.items ?? []) as AnyRecord[]

        const canvasRecords = collectCanvasMedia(workspace?.canvasState)
        const threadRecords = collectThreadMedia(threads)
        const indexedThreadRecords = indexThreadRecords(threadRecords)
        const comparisons = canvasRecords.map((canvasRecord) => {
            const match = findThreadRecord(canvasRecord, indexedThreadRecords)
            return compareRecords(canvasRecord, match.record, match.matchKind)
        })
        const staleThreadRecords = threadRecords.filter(threadRecord =>
            !comparisons.some(comparison => comparison.thread === threadRecord)
        )
        const fileIds = collectFileIds(canvasRecords, threadRecords)

        console.log(JSON.stringify({
            inspectedAt: new Date().toISOString(),
            args,
            workspace: workspace
                ? {
                    found: true,
                    workspaceId: workspace.workspaceId,
                    name: workspace.name,
                    updatedAt: workspace.updatedAt,
                    canvasStateUpdatedAt: workspace.canvasStateUpdatedAt,
                }
                : { found: false },
            threadCount: threads.length,
            canvasGeneratedMediaCount: canvasRecords.length,
            threadGeneratedMediaCount: threadRecords.length,
            mismatchCount: comparisons.filter(comparison => comparison.status !== 'ok').length,
            staleThreadRecordCount: staleThreadRecords.length,
            comparisons,
            staleThreadRecords,
            objectStore: await inspectObjectStore(nats, args.workspaceId, fileIds),
        }, null, 2))
    } finally {
        await nats.disconnect()
    }
}

await main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
