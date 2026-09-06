import process from 'node:process'

import DynamoDBService from '@lixpi/dynamodb-service'
import NATS_Service from '@lixpi/nats-service'
import {
    type Asset,
    type AssetDocumentRole,
    type CanvasNode,
    type MediaGenerationRequest,
} from '@lixpi/constants'

type JsonRecord = Record<string, unknown>

type DebugArgs = {
    workspaceId: string
    generationRequestId?: string
}

const readFlag = (
    name: string,
    aliases: string[],
): string | undefined => {
    for (const flag of [name, ...aliases]) {
        const equalsArgument = process.argv.find(argument => argument.startsWith(`${flag}=`))

        if (equalsArgument)
            return equalsArgument.slice(flag.length + 1)

        const index = process.argv.indexOf(flag)

        if (index >= 0)
            return process.argv[index + 1]
    }

    return undefined
}

const parseArgs = (): DebugArgs => {
    const workspaceId = readFlag('--workspace', ['--workspaceId'])

    if (!workspaceId)
        throw new Error('Usage: node src/debug-tools/inspect-workspace-generation-history.ts --workspace <workspaceId> [--generation-request <generationRequestId>]')

    const generationRequestId = readFlag('--generation-request', ['--generationRequestId'])

    return {
        workspaceId,
        ...(generationRequestId ? { generationRequestId } : {}),
    }
}

const requireEnv = (name: string): string => {
    const value = process.env[name]

    if (!value)
        throw new Error(`Missing required env var ${name}`)

    return value
}

const createDynamoDbService = (): DynamoDBService => {
    const endpoint = process.env.DYNAMODB_ENDPOINT

    return new DynamoDBService({
        region: requireEnv('AWS_REGION'),
        ssoProfile: process.env.AWS_PROFILE ?? '',
        ...(endpoint ? { endpoint } : {}),
    })
}

const createNatsService = async (): Promise<NATS_Service> => {
    return await NATS_Service.init({
        servers: process.env.NATS_SERVERS as any,
        name: 'api-inspect-workspace-generation-history',
        user: 'regular_user',
        pass: requireEnv('NATS_REGULAR_USER_PASSWORD'),
        ...(process.env.NATS_STREAM_REPLICAS
            ? { streamReplicas: Number(process.env.NATS_STREAM_REPLICAS) }
            : {}),
    })
}

const asRecord = (value: unknown): JsonRecord | null => {
    return value
        && typeof value === 'object'
        && !Array.isArray(value)
        ? value as JsonRecord
        : null
}

const stringValue = (value: unknown): string | undefined => {
    return typeof value === 'string'
        && value.length > 0
        ? value
        : undefined
}

const numberValue = (value: unknown): number | undefined => {
    return typeof value === 'number'
        && Number.isFinite(value)
        ? value
        : undefined
}

const compactPath = (path: Array<string | number>): string => path.map(part => (typeof part === 'number' ? `[${part}]` : part)).join('.')

const extractDocumentText = (value: unknown): string => {
    const node = asRecord(value)

    if (!node)
        return ''

    const text = typeof node.text === 'string' ? node.text : ''
    const children = Array.isArray(node.content)
        ? node.content.map(extractDocumentText).join('')
        : ''

    return `${text}${children}`
}

const summarizeReference = (reference: unknown): JsonRecord => {
    const record = asRecord(reference) ?? {}

    return {
        id: record.id,
        source: record.source,
        role: record.role,
        candidateId: record.candidateId,
        nodeId: record.nodeId,
        assetId: record.assetId,
        imageUrl: record.imageUrl,
    }
}

const summarizeDocument = (document: unknown): JsonRecord => {
    const counts = new Map<string, number>()
    const userReferences: JsonRecord[] = []
    const traces: JsonRecord[] = []
    const generatedMedia: JsonRecord[] = []

    const visit = (
        value: unknown,
        path: Array<string | number>,
    ): void => {
        const node = asRecord(value)

        if (!node)
            return

        const type = stringValue(node.type)

        if (type)
            counts.set(type, (counts.get(type) ?? 0) + 1)

        const attrs = asRecord(node.attrs) ?? {}

        if (
            type === 'prompt_reference'
            || type === 'promptReference'
            || type === 'aiPromptReference'
        ) {
            userReferences.push({
                path: compactPath(path),
                type,
                assetId: attrs.assetId,
                nodeId: attrs.nodeId,
                displayName: attrs.displayName,
            })
        }

        if (type === 'aiCollapsibleBlock') {
            const imageTrace = asRecord(attrs.imageGenerationTrace)
            const videoTrace = asRecord(attrs.videoGenerationTrace)
            const trace = imageTrace ?? videoTrace

            if (trace) {
                const generationRun = asRecord(trace.generationRun)
                traces.push({
                    path: compactPath(path),
                    title: attrs.title,
                    imageGenerationTraceId: attrs.imageGenerationTraceId,
                    generationRequestId: attrs.generationRequestId,
                    reasoningRunId: attrs.reasoningRunId,
                    mediaRunId: attrs.mediaRunId,
                    reasoningModelId: attrs.reasoningModelId,
                    mediaModelId: attrs.mediaModelId,
                    variantIndex: attrs.variantIndex,
                    traceGenerationRequestId: generationRun?.generationRequestId,
                    traceReasoningRunId: generationRun?.reasoningRunId,
                    traceMediaRunId: generationRun?.mediaRunId,
                    traceMediaModelId: generationRun?.mediaModelId,
                    traceVariantIndex: generationRun?.variantIndex,
                    finalPromptLength: stringValue(trace.finalPrompt)?.length ?? 0,
                    referenceImages: Array.isArray(trace.referenceImages)
                        ? trace.referenceImages.map(summarizeReference)
                        : [],
                    capabilityReviewSummary: asRecord(trace.capabilityReview)?.summary,
                })
            }
        }

        if (
            type === 'aiGeneratedImage'
            || type === 'aiGeneratedVideo'
        ) {
            generatedMedia.push({
                path: compactPath(path),
                type,
                assetId: attrs.assetId,
                generationRequestId: attrs.generationRequestId,
                reasoningRunId: attrs.reasoningRunId,
                mediaRunId: attrs.mediaRunId,
                mediaModelId: attrs.mediaModelId,
                variantIndex: attrs.variantIndex,
            })
        }

        if (!Array.isArray(node.content))
            return

        node.content.forEach((child, index) => visit(child, [...path, 'content', index]))
    }

    visit(document, [])

    return {
        counts: Object.fromEntries(
            [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
        ),
        userReferences,
        traces,
        generatedMedia,
    }
}

const summarizeCanvasNode = (node: CanvasNode): JsonRecord => {
    const record = node as CanvasNode & JsonRecord
    const generatedBy = asRecord(record.generatedBy)

    return {
        nodeId: node.nodeId,
        type: node.type,
        assetId: record.assetId,
        position: node.position,
        dimensions: node.dimensions,
        generationRequestId: generatedBy?.generationRequestId,
        conversationAssetId: generatedBy?.conversationAssetId,
        reasoningRunId: generatedBy?.reasoningRunId,
        mediaRunId: generatedBy?.mediaRunId,
        mediaModelId: generatedBy?.mediaModelId,
        variantIndex: generatedBy?.variantIndex,
    }
}

const summarizeCheckpoint = (value: unknown): JsonRecord | null => {
    const checkpoint = asRecord(value)

    if (!checkpoint)
        return null

    const configuration = asRecord(checkpoint.configuration)
    const resumePayload = asRecord(configuration?.resumePayload)
    const snapshot = asRecord(resumePayload?.mediaBranchCandidateSnapshot)
    const candidates = Array.isArray(snapshot?.candidates)
        ? snapshot.candidates.map(candidate => {
            const record = asRecord(candidate) ?? {}

            return {
                candidateId: record.candidateId,
                nodeId: record.nodeId,
                assetId: record.assetId,
                roleHints: record.roleHints,
            }
        })
        : []

    return {
        promptText: extractDocumentText(checkpoint.promptDocument),
        selectedReferences: checkpoint.selectedReferences,
        explicitReferenceCandidateIds: snapshot?.explicitReferenceCandidateIds,
        activeTargetCandidateId: snapshot?.activeTargetCandidateId,
        candidates,
    }
}

const summarizeRequest = (
    request: MediaGenerationRequest,
    checkpoint: unknown,
): JsonRecord => {
    return {
        generationRequestId: request.generationRequestId,
        conversationAssetId: request.conversationAssetId,
        status: request.status,
        revision: request.revision,
        bindings: request.bindings.map(
            binding => ({
                alias: binding.alias,
                assetId: binding.assetId,
                nodeId: binding.nodeId,
                displayNameSnapshot: binding.displayNameSnapshot,
                semanticDescriptor: binding.semanticDescriptor,
            }),
        ),
        unresolvedBindings: request.unresolvedBindings.map(
            binding => ({
                bindingId: binding.bindingId,
                originalText: binding.originalText,
                promptRange: binding.promptRange,
                matcherVersion: binding.matcherVersion,
                candidates: binding.candidates,
            }),
        ),
        resolvedReferences: request.resolvedReferences.map(
            reference => ({
                bindingId: reference.bindingId,
                assetId: reference.assetId,
                originalText: reference.originalText,
            }),
        ),
        runs: request.runs.map(
            run => ({
                generationRun: run.generationRun,
                reasoningRunId: run.reasoningRunId,
                mediaRunId: run.mediaRunId,
                outputAssetId: run.outputAssetId,
                outputNodeId: run.outputNodeId,
                modelId: run.modelId,
                status: run.status,
            }),
        ),
        checkpoint: summarizeCheckpoint(checkpoint),
    }
}

const loadJsonBlob = async (
    nats: NATS_Service,
    organizationId: string,
    blobHash: string,
): Promise<unknown> => {
    const { default: BlobModel } = await import('../models/blob.ts')
    const blob = await BlobModel.get({
        organizationId,
        blobHash,
    })

    if (!blob)
        return null

    const bytes = await nats.getObject(blob.bucketName, blob.objectKey)

    if (!bytes)
        return null

    return JSON.parse(
        Buffer.from(bytes).toString('utf8'),
    ) as unknown
}

const inspectAsset = async (
    asset: Asset,
    roles: AssetDocumentRole[],
): Promise<JsonRecord> => {
    const { default: AssetDocumentService } = await import('../services/asset-document-service.ts')
    const { AssetProseMirrorStepTransport } = await import('../prosemirror/asset-prosemirror-step-transport.ts')
    const documents: JsonRecord = {}

    for (const role of roles) {
        if (!asset.documents[role])
            continue

        const settled = await AssetDocumentService.loadSnapshot(asset, role)
        const current = await AssetDocumentService.loadCurrentSnapshot(asset, role)
        const events = await AssetProseMirrorStepTransport.fromSingleton().replay(
            {
                organizationId: asset.organizationId,
                assetId: asset.assetId,
                role,
            },
            1,
            10000,
        )
        documents[role] = {
            pointer: asset.documents[role],
            settled: settled ? summarizeDocument(settled.doc) : null,
            current: current ? summarizeDocument(current.doc) : null,
            eventLog: {
                count: events.length,
                firstVersion: events.at(0)?.version,
                lastVersion: events.at(-1)?.version,
                kinds: events.reduce<Record<string, number>>(
                    (result, event) => {
                        result[event.kind] = (result[event.kind] ?? 0) + 1

                        return result
                    },
                    {},
                ),
            },
        }
    }

    return {
        assetId: asset.assetId,
        title: asset.title,
        lineage: asset.lineage,
        states: asset.states,
        documents,
    }
}

const main = async (): Promise<void> => {
    const args = parseArgs()
    ;(globalThis as JsonRecord).dynamoDBService = createDynamoDbService()
    const nats = await createNatsService()

    try {
        const [{ default: Workspace }, { getAssetRecord }, { default: MediaGenerationRequestModel }] = await Promise.all([
            import('../models/workspace.ts'),
            import('../models/asset.ts'),
            import('../models/media-generation-request.ts'),
        ])
        const workspace = await Workspace.getWorkspaceInternal({ workspaceId: args.workspaceId })

        if (!workspace)
            throw new Error(`Workspace not found: ${args.workspaceId}`)

        const canvasNodes = workspace.canvasState?.nodes ?? []
        const generatedNodes = canvasNodes.filter(node => {
            const generatedBy = asRecord((node as CanvasNode & JsonRecord).generatedBy)

            return Boolean(generatedBy?.generationRequestId || generatedBy?.conversationAssetId)
        })
        const generationRequestIds = new Set(
            generatedNodes.map(node => stringValue(asRecord((node as CanvasNode & JsonRecord).generatedBy)?.generationRequestId)).filter(
                (value): value is string => Boolean(value),
            ),
        )
        const conversationAssetIds = new Set(
            generatedNodes.map(node => stringValue(asRecord((node as CanvasNode & JsonRecord).generatedBy)?.conversationAssetId)).filter(
                (value): value is string => Boolean(value),
            ),
        )
        const outputAssetIds = new Set(
            generatedNodes.map(node => stringValue((node as CanvasNode & JsonRecord).assetId)).filter((value): value is string => Boolean(value)),
        )

        const requestMetas = await MediaGenerationRequestModel.listWorkspace(args.workspaceId)
        const requests = (await Promise.all(
            requestMetas.filter(
                meta =>
                        args.generationRequestId
                            ? meta.generationRequestId === args.generationRequestId
                            : generationRequestIds.size === 0 || generationRequestIds.has(meta.generationRequestId),
            ).map(
                meta =>
                        MediaGenerationRequestModel.get({
                            generationRequestId: meta.generationRequestId,
                            workspaceId: args.workspaceId,
                        }),
            ),
        )).filter((request): request is MediaGenerationRequest => Boolean(request))
        const requestSummaries = await Promise.all(
            requests.map(
                async request =>
                    summarizeRequest(request, await loadJsonBlob(
                        nats,
                        request.organizationId,
                        request.checkpointBlobHash,
                    )),
            ),
        )

        const conversationAssets = (await Promise.all(
            [...conversationAssetIds].map(
                assetId => (
                    getAssetRecord(assetId, 'inspect-workspace-generation-history')
                ),
            ),
        )).filter((asset): asset is Asset => Boolean(asset))
        const outputAssets = (await Promise.all(
            [...outputAssetIds].map(
                assetId => (
                    getAssetRecord(assetId, 'inspect-workspace-generation-history')
                ),
            ),
        )).filter((asset): asset is Asset => Boolean(asset))

        process.stdout.write(
            `${
                JSON.stringify(
                    {
                        inspectedAt: new Date().toISOString(),
                        workspace: {
                            workspaceId: args.workspaceId,
                            name: workspace.name,
                            updatedAt: workspace.updatedAt,
                            canvasStateUpdatedAt: workspace.canvasStateUpdatedAt,
                            generatedNodes: generatedNodes.map(summarizeCanvasNode),
                        },
                        requests: requestSummaries,
                        conversationAssets: await Promise.all(
                            conversationAssets.map(asset => inspectAsset(asset, ['conversation'])),
                        ),
                        outputAssets: await Promise.all(
                            outputAssets.map(asset => inspectAsset(asset, ['provenance'])),
                        ),
                    },
                    null,
                    2,
                )
            }\n`,
        )
    } finally {
        await nats.disconnect()
    }
}

await main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
})
