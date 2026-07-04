'use strict'

import process from 'node:process'

import DynamoDBService from '@lixpi/dynamodb-service'
import NATS_Service from '@lixpi/nats-service'
import {
    NATS_SUBJECTS,
    getDynamoDbTableStageName,
    type CanvasNode,
    type CanvasState,
    type WorkspaceEdge,
} from '@lixpi/constants'
import {
    getDocumentStepSubject,
    getWorkspaceStepStreamName,
    type DocCoordinate,
    type LoggedStepStreamEvent,
    type StepStreamEvent,
} from '@lixpi/prosemirror'

type DebugArgs = {
    workspaceId: string
    threadId?: string
    generationRequestId?: string
    maxPipelineEvents: number
    maxProseMirrorEvents: number
    maxObjects: number
}

type AnyRecord = Record<string, any>

type LineageNode = CanvasNode & {
    generatedBy?: AnyRecord
    branchId?: string
    generationRequestId?: string
    parentBranchNodeId?: string
    reasoningRunId?: string
    reasoningModelId?: string
    reasoningIndex?: number
    mediaRunId?: string
    mediaModelId?: string
    mediaType?: string
    fileId?: string
    posterFileId?: string
    frameFileId?: string
    pendingState?: AnyRecord
}

type PipelineEnvelope = {
    eventId?: string
    streamSequence?: number
    payload?: {
        content?: AnyRecord
        aiChatThreadId?: string
        pipelineEventId?: string
    }
    publishedAt?: number
}

type StreamMessage<T> = {
    data: T
    subject: string
    seq: number
}

const DEFAULT_PIPELINE_EVENT_LIMIT = 500
const DEFAULT_PROSEMIRROR_EVENT_LIMIT = 200
const DEFAULT_OBJECT_LIMIT = 250

function readFlag(name: string, aliases: string[], fallback?: string): string | undefined {
    const flags = [name, ...aliases]
    for (const flag of flags) {
        const equalsArg = process.argv.find(arg => arg.startsWith(`${flag}=`))
        if (equalsArg) return equalsArg.slice(flag.length + 1)
        const index = process.argv.indexOf(flag)
        if (index >= 0) return process.argv[index + 1]
    }
    return fallback
}

function parseInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function parseArgs(): DebugArgs {
    const workspaceId = readFlag('--workspace', ['--workspaceId'])
    if (!workspaceId) {
        throw new Error([
            'Usage:',
            'node src/temp/debug-media-storage.ts --workspace <workspaceId> [--thread <threadId>] [--generation <generationRequestId>]',
            '',
            'Optional:',
            '--pipeline-events <count>',
            '--prosemirror-events <count>',
            '--objects <count>',
        ].join('\n'))
    }

    return {
        workspaceId,
        threadId: readFlag('--thread', ['--threadId']),
        generationRequestId: readFlag('--generation', ['--generationRequestId']),
        maxPipelineEvents: parseInteger(
            readFlag('--pipeline-events', ['--pipelineEvents']),
            DEFAULT_PIPELINE_EVENT_LIMIT,
        ),
        maxProseMirrorEvents: parseInteger(
            readFlag('--prosemirror-events', ['--proseMirrorEvents']),
            DEFAULT_PROSEMIRROR_EVENT_LIMIT,
        ),
        maxObjects: parseInteger(readFlag('--objects', []), DEFAULT_OBJECT_LIMIT),
    }
}

function requireEnv(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required env var ${name}`)
    return value
}

function tableName(name: 'WORKSPACES' | 'AI_CHAT_THREADS'): string {
    return getDynamoDbTableStageName(name, requireEnv('ORG_NAME'), requireEnv('STAGE'))
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
        name: 'api-debug-media-storage',
        user: 'regular_user',
        pass: requireEnv('NATS_REGULAR_USER_PASSWORD'),
        ...(process.env.NATS_STREAM_REPLICAS ? { streamReplicas: Number(process.env.NATS_STREAM_REPLICAS) } : {}),
    })
}

function sanitizeToken(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const item of items) {
        const key = keyFn(item)
        counts[key] = (counts[key] ?? 0) + 1
    }
    return counts
}

function uniqueStrings(values: Array<string | undefined>): string[] {
    return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function compactNode(node: LineageNode): AnyRecord {
    return {
        nodeId: node.nodeId,
        type: node.type,
        position: node.position,
        dimensions: node.dimensions,
        fileId: node.fileId,
        posterFileId: node.posterFileId,
        frameFileId: node.frameFileId,
        branchId: node.branchId ?? node.generatedBy?.branchId,
        generationRequestId: node.generationRequestId ?? node.generatedBy?.generationRequestId,
        reasoningRunId: node.reasoningRunId ?? node.generatedBy?.reasoningRunId,
        mediaRunId: node.mediaRunId ?? node.generatedBy?.mediaRunId,
        reasoningModelId: node.reasoningModelId ?? node.generatedBy?.reasoningModelId,
        reasoningIndex: node.reasoningIndex ?? node.generatedBy?.reasoningIndex,
        mediaModelId: node.mediaModelId ?? node.generatedBy?.mediaModelId,
        mediaType: node.mediaType ?? node.generatedBy?.mediaType,
        mediaIndex: node.generatedBy?.mediaIndex,
        variantIndex: node.generatedBy?.variantIndex,
        parentBranchNodeId: node.parentBranchNodeId,
        parentMediaNodeId: node.generatedBy?.parentMediaNodeId,
        branchOriginNodeId: node.generatedBy?.branchOriginNodeId,
        branchForkNodeId: node.generatedBy?.branchForkNodeId,
        branchLineNodeId: node.generatedBy?.branchLineNodeId,
        lineageParentNodeId: node.generatedBy?.lineageParentNodeId,
        referenceImageNodeIds: node.generatedBy?.referenceImageNodeIds,
        sourceContextNodeIds: node.generatedBy?.sourceContextNodeIds,
        pendingState: node.pendingState,
    }
}

function compactEdge(edge: WorkspaceEdge): AnyRecord {
    return {
        edgeId: edge.edgeId,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        sourceMessageId: edge.sourceMessageId,
    }
}

function getCanvasFileIds(nodes: LineageNode[]): string[] {
    const fileIds = new Set<string>()
    for (const node of nodes) {
        for (const fileId of [node.fileId, node.posterFileId, node.frameFileId]) {
            if (fileId) fileIds.add(fileId)
        }
    }
    return [...fileIds].sort()
}

function getGenerationRequestId(node: LineageNode): string | undefined {
    return node.generationRequestId ?? node.generatedBy?.generationRequestId
}

function hasGeneratedBy(node: LineageNode): boolean {
    return Boolean(node.generatedBy?.branchId || node.generatedBy?.generationRequestId)
}

function summarizeCanvasState(canvasState: CanvasState | undefined, generationRequestId?: string): AnyRecord {
    const nodes = (canvasState?.nodes ?? []) as LineageNode[]
    const edges = canvasState?.edges ?? []
    const nodeIds = new Set(nodes.map(node => node.nodeId))
    const orphanEdges = edges.filter(edge => !nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId))
    const generationNodes = generationRequestId
        ? nodes.filter(node => getGenerationRequestId(node) === generationRequestId)
        : nodes.filter(node => node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine' || hasGeneratedBy(node))
    const generationNodeIds = new Set(generationNodes.map(node => node.nodeId))
    const generationEdges = edges.filter(edge =>
        generationNodeIds.has(edge.sourceNodeId) || generationNodeIds.has(edge.targetNodeId)
    )
    const generatedMediaNodes = generationNodes.filter(node =>
        (node.type === 'image' || node.type === 'video') && hasGeneratedBy(node)
    )
    const markerNodes = generationNodes.filter(node =>
        node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
    )
    const missingLineageRefs = generatedMediaNodes.flatMap((node) => {
        const refs = [
            ['parentMediaNodeId', node.generatedBy?.parentMediaNodeId],
            ['branchOriginNodeId', node.generatedBy?.branchOriginNodeId],
            ['branchForkNodeId', node.generatedBy?.branchForkNodeId],
            ['branchLineNodeId', node.generatedBy?.branchLineNodeId],
            ['lineageParentNodeId', node.generatedBy?.lineageParentNodeId],
        ] as Array<[string, string | undefined]>
        return refs
            .filter(([, nodeId]) => nodeId && !nodeIds.has(nodeId))
            .map(([field, nodeId]) => ({ nodeId: node.nodeId, field, referencedNodeId: nodeId }))
    })
    const mediaRunGroups = new Map<string, LineageNode[]>()
    for (const node of generatedMediaNodes) {
        const mediaRunId = node.generatedBy?.mediaRunId
        if (!mediaRunId) continue
        mediaRunGroups.set(mediaRunId, [...(mediaRunGroups.get(mediaRunId) ?? []), node])
    }
    const duplicateMediaRunNodes = [...mediaRunGroups.entries()]
        .filter(([, group]) => group.length > 1)
        .map(([mediaRunId, group]) => ({ mediaRunId, nodeIds: group.map(node => node.nodeId) }))

    return {
        totalNodeCount: nodes.length,
        totalEdgeCount: edges.length,
        nodeCountsByType: countBy(nodes, node => node.type),
        canvasFileIdCount: getCanvasFileIds(nodes).length,
        generationNodeCount: generationNodes.length,
        generationEdgeCount: generationEdges.length,
        generationNodeCountsByType: countBy(generationNodes, node => node.type),
        generationBranchIds: uniqueStrings(generationNodes.map(node => node.branchId ?? node.generatedBy?.branchId)),
        generationReasoningRunIds: uniqueStrings(generationNodes.map(node => node.reasoningRunId ?? node.generatedBy?.reasoningRunId)),
        generationMediaRunIds: uniqueStrings(generatedMediaNodes.map(node => node.generatedBy?.mediaRunId)),
        markerNodes: markerNodes.map(compactNode),
        generatedMediaNodes: generatedMediaNodes.map(compactNode),
        generationEdges: generationEdges.map(compactEdge),
        orphanEdges: orphanEdges.map(compactEdge),
        missingLineageRefs,
        duplicateMediaRunNodes,
    }
}

function compactWorkspace(workspace: AnyRecord | undefined, generationRequestId?: string): AnyRecord {
    if (!workspace) return { found: false }
    const files = Array.isArray(workspace.files) ? workspace.files : []
    return {
        found: true,
        workspaceId: workspace.workspaceId,
        name: workspace.name,
        updatedAt: workspace.updatedAt,
        canvasStateUpdatedAt: workspace.canvasStateUpdatedAt,
        fileCount: files.length,
        fileKindCounts: countBy(files, file => file.kind ?? file.type ?? 'unknown'),
        canvas: summarizeCanvasState(workspace.canvasState, generationRequestId),
    }
}

function compactThread(thread: AnyRecord | undefined): AnyRecord {
    if (!thread) return { found: false }
    const content = thread.content
    return {
        found: true,
        workspaceId: thread.workspaceId,
        threadId: thread.threadId,
        title: thread.title,
        status: thread.status,
        updatedAt: thread.updatedAt,
        proseMirrorVersion: thread.proseMirrorVersion,
        contentShape: content && typeof content === 'object'
            ? {
                type: content.type,
                childCount: Array.isArray(content.content) ? content.content.length : undefined,
            }
            : { type: typeof content },
    }
}

async function replayStreamSubject<T>(
    nats: NATS_Service,
    streamName: string,
    subject: string,
    maxMessages: number,
): Promise<Array<StreamMessage<T>>> {
    const streamInfo = await nats.getJetStreamStreamInfoOrNull(streamName)
    if (!streamInfo) return []
    const lastMessage = await nats.getJetStreamMessage<T>(streamName, { last_by_subj: subject })
    if (!lastMessage) return []

    const messages: Array<StreamMessage<T>> = []
    let nextSeq = 1
    while (nextSeq <= lastMessage.seq && messages.length < maxMessages) {
        const message = await nats.getJetStreamMessage<T>(streamName, {
            seq: nextSeq,
            next_by_subj: subject,
        })
        if (!message || message.seq > lastMessage.seq) break
        messages.push(message)
        nextSeq = message.seq + 1
    }
    return messages
}

function getPipelineEventGenerationRequestId(content: AnyRecord | undefined): string | undefined {
    return content?.generationRun?.generationRequestId
        ?? content?.lineagePlan?.generationRequestId
        ?? content?.imageGenerationTrace?.generationRun?.generationRequestId
        ?? content?.videoGenerationTrace?.generationRun?.generationRequestId
        ?? content?.generationRequestId
}

function getPipelineEventMediaRunId(content: AnyRecord | undefined): string | undefined {
    return content?.generationRun?.mediaRunId
        ?? content?.imageGenerationTrace?.generationRun?.mediaRunId
        ?? content?.videoGenerationTrace?.generationRun?.mediaRunId
}

function summarizePipelineEvent(message: StreamMessage<PipelineEnvelope>): AnyRecord {
    const content = message.data.payload?.content
    return {
        seq: message.seq,
        eventId: message.data.eventId ?? message.data.payload?.pipelineEventId,
        publishedAt: message.data.publishedAt,
        status: content?.status,
        aiProvider: content?.aiProvider,
        generationRequestId: getPipelineEventGenerationRequestId(content),
        reasoningRunId: content?.generationRun?.reasoningRunId,
        mediaRunId: getPipelineEventMediaRunId(content),
        reasoningModelId: content?.generationRun?.reasoningModelId,
        mediaModelId: content?.generationRun?.mediaModelId,
        mediaType: content?.generationRun?.mediaType,
        mediaIndex: content?.generationRun?.mediaIndex,
        variantIndex: content?.generationRun?.variantIndex,
        fileId: content?.fileId,
        partialIndex: content?.partialIndex,
        imageModelProvider: content?.imageModelProvider,
        imageModelId: content?.imageModelId,
        videoModelProvider: content?.videoModelProvider,
        videoModelId: content?.videoModelId,
        branchForkCount: content?.lineagePlan?.branchForks?.length,
        branchLineCount: content?.lineagePlan?.branchLines?.length,
        runAssignmentCount: content?.lineagePlan?.runAssignments?.length,
        error: content?.error,
    }
}

function summarizePipelineEvents(
    messages: Array<StreamMessage<PipelineEnvelope>>,
    generationRequestId?: string,
): AnyRecord {
    const summaries = messages.map(summarizePipelineEvent)
    const matching = generationRequestId
        ? summaries.filter(event => event.generationRequestId === generationRequestId)
        : summaries
    const matchingMessages = generationRequestId
        ? messages.filter(message => getPipelineEventGenerationRequestId(message.data.payload?.content) === generationRequestId)
        : messages
    const lineagePlans = matchingMessages
        .map(message => message.data.payload?.content?.lineagePlan)
        .filter(Boolean)
    const latestLineagePlan = lineagePlans.at(-1)
    const assignedMediaRunIds = new Set<string>(
        latestLineagePlan?.runAssignments
            ?.map((assignment: AnyRecord) => assignment.mediaRunId)
            ?.filter(Boolean) ?? [],
    )
    const completedMediaRunIds = new Set<string>(
        matching
            .filter(event => event.status === 'IMAGE_COMPLETE' || event.status === 'VIDEO_COMPLETE')
            .map(event => event.mediaRunId)
            .filter(Boolean),
    )
    const partialMediaRunIds = new Set<string>(
        matching
            .filter(event => event.status === 'IMAGE_PARTIAL' || event.status === 'VIDEO_PENDING' || event.status === 'VIDEO_GENERATING')
            .map(event => event.mediaRunId)
            .filter(Boolean),
    )

    return {
        streamEventCount: messages.length,
        matchingEventCount: matching.length,
        statusCounts: countBy(matching, event => event.status ?? 'UNKNOWN'),
        latestLineagePlan: latestLineagePlan
            ? {
                generationRequestId: latestLineagePlan.generationRequestId,
                branchId: latestLineagePlan.branchId,
                sourceNodeId: latestLineagePlan.sourceNodeId,
                placementAnchorNodeId: latestLineagePlan.placementAnchorNodeId,
                branchOriginNodeId: latestLineagePlan.branchOrigin?.nodeId,
                branchForks: latestLineagePlan.branchForks?.map((fork: AnyRecord) => ({
                    nodeId: fork.nodeId,
                    parentBranchNodeId: fork.parentBranchNodeId,
                    reasoningRunId: fork.reasoningRunId,
                    reasoningModelId: fork.reasoningModelId,
                    reasoningIndex: fork.reasoningIndex,
                })),
                branchLines: latestLineagePlan.branchLines?.map((line: AnyRecord) => ({
                    nodeId: line.nodeId,
                    parentBranchNodeId: line.parentBranchNodeId,
                    reasoningRunId: line.reasoningRunId,
                    mediaRunId: line.mediaRunId,
                    mediaModelId: line.mediaModelId,
                    mediaType: line.mediaType,
                })),
                runAssignments: latestLineagePlan.runAssignments?.map((assignment: AnyRecord) => ({
                    reasoningRunId: assignment.reasoningRunId,
                    mediaRunId: assignment.mediaRunId,
                    reasoningIndex: assignment.reasoningIndex,
                    mediaModelId: assignment.mediaModelId,
                    mediaType: assignment.mediaType,
                    mediaIndex: assignment.mediaIndex,
                    branchId: assignment.branchId,
                    parentMediaNodeId: assignment.parentMediaNodeId,
                    branchOriginNodeId: assignment.branchOriginNodeId,
                    branchForkNodeId: assignment.branchForkNodeId,
                    branchLineNodeId: assignment.branchLineNodeId,
                    lineageParentNodeId: assignment.lineageParentNodeId,
                })),
            }
            : undefined,
        missingCompletedMediaRunIds: [...assignedMediaRunIds].filter(mediaRunId => !completedMediaRunIds.has(mediaRunId)),
        completedWithoutAssignmentMediaRunIds: [...completedMediaRunIds].filter(mediaRunId => !assignedMediaRunIds.has(mediaRunId)),
        partialWithoutCompleteMediaRunIds: [...partialMediaRunIds].filter(mediaRunId => !completedMediaRunIds.has(mediaRunId)),
        events: matching,
    }
}

async function inspectPipelineEvents(
    nats: NATS_Service,
    args: DebugArgs,
): Promise<AnyRecord> {
    if (!args.threadId) return { skipped: 'No thread id supplied' }
    const streamName = `PIPELINE_EVENTS_${sanitizeToken(args.workspaceId)}`
    const subject = [
        NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_EVENTS,
        sanitizeToken(args.workspaceId),
        sanitizeToken(args.threadId),
    ].join('.')
    const messages = await replayStreamSubject<PipelineEnvelope>(
        nats,
        streamName,
        subject,
        args.maxPipelineEvents,
    )
    return {
        streamName,
        subject,
        ...summarizePipelineEvents(messages, args.generationRequestId),
    }
}

function summarizeProseMirrorEvent(message: StreamMessage<StepStreamEvent>): AnyRecord {
    return {
        seq: message.seq,
        kind: message.data.kind,
        version: message.data.version,
        subjectSeq: message.data.subjectSeq,
        aiProvider: message.data.aiProvider,
        generationRequestId: message.data.generationRun?.generationRequestId,
        reasoningRunId: message.data.generationRun?.reasoningRunId,
        mediaRunId: message.data.generationRun?.mediaRunId,
        mediaModelId: message.data.generationRun?.mediaModelId,
        mediaType: message.data.generationRun?.mediaType,
        origin: message.data.origin,
    }
}

async function inspectProseMirrorEvents(
    nats: NATS_Service,
    args: DebugArgs,
): Promise<AnyRecord> {
    if (!args.threadId) return { skipped: 'No thread id supplied' }
    const coordinate: DocCoordinate = {
        workspaceId: args.workspaceId,
        docType: 'aiChatThread',
        docId: args.threadId,
    }
    const streamName = getWorkspaceStepStreamName(args.workspaceId)
    const subject = getDocumentStepSubject(coordinate)
    const messages = await replayStreamSubject<StepStreamEvent>(
        nats,
        streamName,
        subject,
        args.maxProseMirrorEvents,
    )
    const summaries = messages.map(summarizeProseMirrorEvent)
    const matching = args.generationRequestId
        ? summaries.filter(event => event.generationRequestId === args.generationRequestId)
        : summaries
    const loggedEvents: LoggedStepStreamEvent[] = messages.map(message => ({
        ...message.data,
        streamSequence: message.seq,
    }))
    const lastEvent = loggedEvents.at(-1)
    return {
        streamName,
        subject,
        streamEventCount: messages.length,
        matchingEventCount: matching.length,
        statusCounts: countBy(matching, event => event.kind ?? 'UNKNOWN'),
        lastEvent: lastEvent
            ? {
                streamSequence: lastEvent.streamSequence,
                kind: lastEvent.kind,
                version: lastEvent.version,
                subjectSeq: lastEvent.subjectSeq,
            }
            : undefined,
        events: matching,
    }
}

async function inspectObjectStore(
    nats: NATS_Service,
    workspace: AnyRecord | undefined,
    args: DebugArgs,
): Promise<AnyRecord> {
    const bucketName = `workspace-${args.workspaceId}-files`
    const objects = await nats.listObjects(bucketName)
    const limitedObjects = objects.slice(0, args.maxObjects)
    const files = Array.isArray(workspace?.files) ? workspace.files : []
    const fileIds = new Set(files.map((file: AnyRecord) => file.id).filter(Boolean))
    const canonicalFileIds = new Set(files.map((file: AnyRecord) => file.canonicalFileId).filter(Boolean))
    const canvasFileIds = new Set(getCanvasFileIds((workspace?.canvasState?.nodes ?? []) as LineageNode[]))
    const objectNames = new Set(objects.map(object => object.name))

    return {
        bucketName,
        objectCount: objects.length,
        returnedObjectCount: limitedObjects.length,
        workspaceFileCount: files.length,
        canvasFileIdCount: canvasFileIds.size,
        missingCanvasObjects: [...canvasFileIds].filter(fileId => !objectNames.has(fileId)),
        canvasObjectsMissingWorkspaceFileRecord: [...canvasFileIds].filter(fileId => !fileIds.has(fileId) && !canonicalFileIds.has(fileId)),
        workspaceFilesMissingObjects: [...fileIds].filter(fileId => !objectNames.has(fileId)),
        objects: limitedObjects.map(object => ({
            name: object.name,
            size: object.size,
            chunks: object.chunks,
            deleted: object.deleted,
            mtime: object.mtime,
            digest: object.digest,
            description: object.description,
            headers: object.headers,
        })),
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
            origin: `debug-media-storage:workspace(${args.workspaceId})`,
        }) as AnyRecord | undefined
        const thread = args.threadId
            ? await dynamo.getItem({
                tableName: tableName('AI_CHAT_THREADS'),
                key: { workspaceId: args.workspaceId, threadId: args.threadId },
                origin: `debug-media-storage:thread(${args.workspaceId}:${args.threadId})`,
            }) as AnyRecord | undefined
            : undefined
        const report = {
            inspectedAt: new Date().toISOString(),
            args,
            dynamodb: {
                workspaceTable: tableName('WORKSPACES'),
                aiChatThreadTable: tableName('AI_CHAT_THREADS'),
                workspace: compactWorkspace(workspace, args.generationRequestId),
                thread: compactThread(thread),
            },
            nats: {
                objectStore: await inspectObjectStore(nats, workspace, args),
                pipelineEvents: await inspectPipelineEvents(nats, args),
                proseMirrorEvents: await inspectProseMirrorEvents(nats, args),
            },
        }

        console.log(JSON.stringify(report, null, 2))
    } finally {
        await nats.disconnect()
    }
}

await main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
