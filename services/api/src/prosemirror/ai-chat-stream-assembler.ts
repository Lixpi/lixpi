'use strict'

import { randomUUID } from 'node:crypto'

import { err } from '@lixpi/debug-tools'
import { MarkdownStreamParser } from '@lixpi/markdown-stream-parser'
import {
    STREAM_STATUS,
    type CapabilityGenerationTrace,
    type ImageGenerationTrace,
    type MarkdownParsedSegment,
    type MarkdownStreamToken,
    type MediaGenerationRunMeta,
    type ProviderName,
    type StreamStatus,
    type VideoGenerationTrace,
} from '@lixpi/constants'
import {
    DOCUMENT_TYPE,
    HeadlessProseMirrorEngine,
    PROSEMIRROR_SCHEMA_VERSION,
    aiGeneratedImageNodeType,
    aiGeneratedVideoNodeType,
    aiChatThreadNodeType,
    aiCollapsibleBlockNodeType,
    aiLineageEventNodeType,
    aiReasoningSectionNodeType,
    aiResponseMessageNodeType,
    applyStreamingSegmentToTransaction,
    getAiLineageEventsForProjection,
    Step,
    type AiLineageEventDescriptor,
    type AssetDocCoordinate,
} from '@lixpi/prosemirror'

import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'

import { getAssetRecord } from '../models/asset.ts'
import AssetDocumentService from '../services/asset-document-service.ts'
import { AssetProseMirrorStepTransport } from './asset-prosemirror-step-transport.ts'

type AiStreamContent = {
    status: StreamStatus
    text?: string
    error?: string
    aiProvider?: ProviderName
    collapsibleTitle?: string
    generationRun?: MediaGenerationRunMeta
    imageUrl?: string
    assetId?: string
    videoUrl?: string
    posterUrl?: string
    frameUrl?: string
    partialIndex?: number
    responseId?: string
    revisedPrompt?: string
    imageModelProvider?: string
    imageModelId?: string
    videoModelProvider?: string
    videoModelId?: string
    durationSeconds?: number
    aspectRatio?: string | number
    hasAudio?: boolean
    imageGenerationTrace?: ImageGenerationTrace
    videoGenerationTrace?: VideoGenerationTrace
    capabilityGenerationTrace?: CapabilityGenerationTrace
}

type AiChatProseMirrorStreamAssemblerConfig = {
    organizationId: string
    workspaceId: string
    aiChatThreadId: string
    leaseId: string
    leaseHolderId: string
    provider: ProviderName
    generationRun?: MediaGenerationRunMeta
    baseVersion?: number
    initialDoc?: object
    transport?: AssetProseMirrorStepTransport
}

type ParserInstance = ReturnType<typeof MarkdownStreamParser.getInstance>

type TargetInfo = {
    found: boolean
    endOfNodePos?: number
    childCount?: number
    nodePos?: number
    responseMessagePos?: number
}

type ThreadInsertionPoint = {
    insertPos: number
}

type ResponseMessageInfo = {
    found: boolean
    nodePos?: number
    contentEndPos?: number
}

type GeneratedRunAttrs = {
    generationRequestId: string
    reasoningRunId: string
    mediaRunId: string
    reasoningModelId: string
    mediaModelId: string
    mediaType: string
    variantIndex: number | null
}

type GeneratedMediaRunAttrs = GeneratedRunAttrs & {
    branchId: string
    parentMediaNodeId: string
    branchOriginNodeId: string
    branchForkNodeId: string
    branchLineNodeId: string
    lineageParentNodeId: string
}

type ResponseTargetContext = {
    responseNode: ProseMirrorNode
    responseStartPos: number
    responseEndPos: number
    responseMessageNode: ProseMirrorNode
    responseMessagePos: number
}

type MediaNodeInfo = {
    node: ProseMirrorNode
    nodePos: number
}

type QueuedTask = {
    task: () => Promise<void>
    resolve: () => void
}

type PersistedProseMirrorJsonNode = {
    type?: string
    attrs?: Record<string, unknown>
    content?: PersistedProseMirrorJsonNode[]
    [key: string]: unknown
}

type PersistedGenerationCancellationResult = {
    found: boolean
    requestMatched: boolean
    changed: boolean
}

const MAX_AUTHORITY_CAS_RETRIES = 5
const AI_GENERATED_MEDIA_WIDTH = '75%'
const AI_GENERATED_MEDIA_ALIGNMENT = 'left'
const AI_GENERATED_MEDIA_TEXT_WRAP = 'none'

function parsePersistedProseMirrorContent(content: unknown): PersistedProseMirrorJsonNode | null {
    if (typeof content === 'string') {
        try {
            const parsed = JSON.parse(content) as unknown
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as PersistedProseMirrorJsonNode
                : null
        } catch {
            return null
        }
    }
    return content && typeof content === 'object' && !Array.isArray(content)
        ? content as PersistedProseMirrorJsonNode
        : null
}

function persistedNodeContainsGenerationRequest(
    node: PersistedProseMirrorJsonNode,
    generationRequestId: string,
): boolean {
    if (node.attrs?.generationRequestId === generationRequestId) return true
    return Boolean(node.content?.some(child => persistedNodeContainsGenerationRequest(child, generationRequestId)))
}

function settlePersistedGenerationNode(
    node: PersistedProseMirrorJsonNode,
    generationRequestId: string,
    inheritedRequestScope = false,
): { node: PersistedProseMirrorJsonNode; changed: boolean } {
    const ownRequestMatch = node.attrs?.generationRequestId === generationRequestId
    const responseRequestMatch = node.type === aiResponseMessageNodeType
        && persistedNodeContainsGenerationRequest(node, generationRequestId)
    const requestScoped = inheritedRequestScope || ownRequestMatch
    const nextChildren = node.content?.map(child =>
        settlePersistedGenerationNode(child, generationRequestId, requestScoped)
    )
    const childrenChanged = Boolean(nextChildren?.some(result => result.changed))
    let nextAttrs = node.attrs
    let attrsChanged = false

    if ((node.type === aiResponseMessageNodeType && (responseRequestMatch || requestScoped))
        || (node.type === aiReasoningSectionNodeType && requestScoped)) {
        const isInitialRenderAnimation = node.type === aiResponseMessageNodeType
            ? false
            : node.attrs?.isInitialRenderAnimation
        if (node.attrs?.isReceivingAnimation !== false
            || (node.type === aiResponseMessageNodeType && node.attrs?.isInitialRenderAnimation !== false)) {
            nextAttrs = {
                ...node.attrs,
                ...(node.type === aiResponseMessageNodeType ? { isInitialRenderAnimation } : {}),
                isReceivingAnimation: false,
            }
            attrsChanged = true
        }
    } else if (node.type === aiCollapsibleBlockNodeType && requestScoped && node.attrs?.isStreaming !== false) {
        nextAttrs = {
            ...node.attrs,
            isStreaming: false,
        }
        attrsChanged = true
    } else if (node.type === aiGeneratedVideoNodeType && requestScoped && node.attrs?.isPending !== false) {
        nextAttrs = {
            ...node.attrs,
            isPending: false,
            errorMessage: node.attrs?.errorMessage || 'Generation cancelled',
        }
        attrsChanged = true
    }

    if (!childrenChanged && !attrsChanged) return { node, changed: false }
    return {
        node: {
            ...node,
            ...(nextAttrs ? { attrs: nextAttrs } : {}),
            ...(nextChildren ? { content: nextChildren.map(result => result.node) } : {}),
        },
        changed: true,
    }
}

export async function settlePersistedAiChatGenerationRequest(params: {
    workspaceId: string
    aiChatThreadId: string
    generationRequestId: string
}): Promise<PersistedGenerationCancellationResult> {
    const asset = await getAssetRecord(params.aiChatThreadId)
    if (!asset) {
        return { found: false, requestMatched: false, changed: false }
    }
    if (asset.editLease && asset.editLease.expiresAt > Date.now() && asset.editLease.workspaceId !== params.workspaceId) {
        return { found: true, requestMatched: false, changed: false }
    }
    const coordinate: AssetDocCoordinate = {
        organizationId: asset.organizationId,
        assetId: asset.assetId,
        role: 'conversation',
    }
    const transport = AssetProseMirrorStepTransport.fromSingleton()
    const capturedState = await transport.getCurrentSubjectState(coordinate)
    const snapshot = await AssetDocumentService.loadCurrentSnapshot(asset, 'conversation')
    if (!snapshot) return { found: true, requestMatched: false, changed: false }
    const doc = parsePersistedProseMirrorContent(snapshot.doc)
    if (!doc) return { found: true, requestMatched: false, changed: false }
    const requestMatched = persistedNodeContainsGenerationRequest(doc, params.generationRequestId)
    if (!requestMatched) return { found: true, requestMatched: false, changed: false }
    const settled = settlePersistedGenerationNode(doc, params.generationRequestId)
    if (!settled.changed) return { found: true, requestMatched: true, changed: false }
    await AssetDocumentService.replaceSystemSnapshot({
        asset,
        role: 'conversation',
        doc: settled.node,
        version: snapshot.version + 1,
    })
    if (capturedState.streamSequence > 0) {
        await transport.purgeThrough(coordinate, capturedState.streamSequence)
    }
    return { found: true, requestMatched: true, changed: true }
}

export class AiChatProseMirrorStreamAssembler {
    private readonly coordinate: AssetDocCoordinate
    private readonly engine: HeadlessProseMirrorEngine
    private readonly transport: AssetProseMirrorStepTransport
    private readonly streamId = randomUUID()
    private readonly workQueue: QueuedTask[] = []
    private parser: ParserInstance | null = null
    private parserInstanceId = ''
    private unsubscribeParser: (() => void) | undefined
    private subjectSeq: number | undefined
    private lastStreamSeq: number | undefined
    private activeProvider: ProviderName
    private activeGenerationRun: MediaGenerationRunMeta | undefined
    private activeCollapsibleRunKey: string | null = null
    private isStarted = false
    private isTextPhaseEnded = false
    private isEnded = false
    private isProcessingQueue = false
    private hasPublishedError = false

    constructor(private readonly config: AiChatProseMirrorStreamAssemblerConfig) {
        this.coordinate = {
            organizationId: config.organizationId,
            assetId: config.aiChatThreadId,
            role: 'conversation',
        }
        this.transport = config.transport ?? AssetProseMirrorStepTransport.fromSingleton()
        this.engine = new HeadlessProseMirrorEngine({
            documentType: DOCUMENT_TYPE.ASSET_CONVERSATION,
            doc: config.initialDoc ?? this.createEmptyThreadDoc(),
            version: config.baseVersion ?? 0,
        })
        this.activeProvider = config.provider
        this.activeGenerationRun = config.generationRun
    }

    handleContent(content: AiStreamContent): void {
        this.updateContext(content)
        if (content.status === STREAM_STATUS.START_STREAM) {
            this.start()
            return
        }
        if (content.status === STREAM_STATUS.STREAMING && content.text) {
            this.parseToken(content.text)
            return
        }
        if (content.status === STREAM_STATUS.COLLAPSIBLE_START) {
            this.startCollapsible(content.collapsibleTitle || 'Image generation prompt')
            return
        }
        if (content.status === STREAM_STATUS.COLLAPSIBLE_END) {
            this.endCollapsible()
            return
        }
        if (content.status === STREAM_STATUS.ERROR) {
            this.publishError(content.error || content.text || 'AI stream failed')
            return
        }
        if (content.status === STREAM_STATUS.IMAGE_GENERATION_TRACE) {
            this.upsertGenerationTrace(content)
            return
        }
        if (content.status === STREAM_STATUS.VIDEO_GENERATION_TRACE) {
            this.upsertGenerationTrace(content)
            return
        }
        if (content.status === STREAM_STATUS.CAPABILITY_GENERATION_TRACE) {
            this.upsertGenerationTrace(content)
            return
        }
        if (content.status === STREAM_STATUS.IMAGE_PARTIAL) {
            this.upsertImage(content, true)
            return
        }
        if (content.status === STREAM_STATUS.IMAGE_COMPLETE) {
            this.upsertImage(content, false)
            return
        }
        if (content.status === STREAM_STATUS.IMAGE_ERROR) {
            this.upsertImage(content, false, true)
            return
        }
        if (content.status === STREAM_STATUS.VIDEO_PENDING) {
            this.upsertVideo(content, true)
            return
        }
        if (content.status === STREAM_STATUS.VIDEO_COMPLETE) {
            this.upsertVideo(content, false)
            return
        }
        if (content.status === STREAM_STATUS.VIDEO_ERROR) {
            this.upsertVideo(content, false, content.error || 'Video generation failed')
            return
        }
        if (content.status === STREAM_STATUS.END_STREAM) {
            void this.end()
        }
    }

    start(): void {
        if (this.isStarted) return
        this.isStarted = true
        this.isTextPhaseEnded = false
        this.isEnded = false
        this.initializeParser()
        this.enqueue(async () => {
            await this.resetSubjectIfStartingFromBase()
            await this.publishControl('START', {
                baseVersion: this.engine.version,
                version: this.engine.version,
                schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
            })
        })
        this.parser?.startParsing()
    }

    parseToken(text: string): void {
        if (!text) return
        if (!this.isStarted) this.start()
        this.parser?.parseToken(text)
    }

    finishTextPhase(): Promise<void> {
        if (!this.isStarted || this.isTextPhaseEnded) return Promise.resolve()

        this.isTextPhaseEnded = true
        this.parser?.stopParsing()
        return this.enqueue(async () => {
            await this.endCollapsibleInQueue()
        })
    }

    async end(): Promise<void> {
        if (!this.isStarted || this.isEnded) return

        const textPhasePromise = this.finishTextPhase()
        this.isEnded = true
        const finalizationPromise = this.enqueue(async () => {
            await this.finalizeResponseTargets(this.activeGenerationRun?.generationRequestId)
            const finalVersion = this.engine.version
            const persisted = await this.persistFinalSnapshot(finalVersion)
            if (!persisted) return
            await this.publishControl('END', {
                version: finalVersion,
                finalVersion,
            })
            await this.transport.purgeDocumentSubject(this.coordinate)
            this.destroyParser()
        })
        await textPhasePromise
        await finalizationPromise
    }

    async cancelGenerationRequest(generationRequestId: string): Promise<void> {
        if (!this.isStarted || !generationRequestId) return

        await this.enqueue(async () => {
            await this.finalizeResponseTargets(generationRequestId, {
                publishSteps: !this.isEnded,
                cancelled: true,
            })
            await this.persistFinalSnapshot(this.engine.version)
        })
    }

    publishError(message: string): void {
        if (this.hasPublishedError) return
        this.hasPublishedError = true
        this.enqueue(async () => {
            await this.publishControl('ERROR', {
                version: this.engine.version,
                error: message,
            })
        })
    }

    async flushPendingWork(): Promise<void> {
        await this.enqueue(async () => {})
    }

    snapshotForProjection(): object {
        return this.sanitizeSnapshotForPersistence(this.engine.snapshot()) as object
    }

    private initializeParser(): void {
        this.destroyParser()
        this.parserInstanceId = [
            'api',
            this.config.workspaceId,
            this.config.aiChatThreadId,
            this.getRunKey(this.activeGenerationRun),
            this.streamId,
        ].join(':')
        this.parser = MarkdownStreamParser.getInstance(this.parserInstanceId)
        this.unsubscribeParser = this.parser.subscribeToTokenParse((
            parsedToken: MarkdownStreamToken,
            unsubscribe: () => void,
        ) => {
            const segment = parsedToken.segment
            if (segment) {
                this.enqueue(async () => {
                    await this.applyParsedSegment(segment)
                })
            }
            if (parsedToken.status === STREAM_STATUS.END_STREAM) {
                unsubscribe()
            }
        })
    }

    private destroyParser(): void {
        this.unsubscribeParser?.()
        this.unsubscribeParser = undefined
        if (this.parserInstanceId) {
            MarkdownStreamParser.removeInstance(this.parserInstanceId)
            this.parserInstanceId = ''
        }
        this.parser = null
    }

    private startCollapsible(title: string): void {
        if (!this.isStarted) this.start()
        this.enqueue(async () => {
            const generationRun = this.getReasoningOnlyGenerationRun(this.activeGenerationRun)
            await this.ensureResponseTarget(generationRun)
            const responseInfo = this.findResponseNode(generationRun)
            if (!responseInfo.found || responseInfo.endOfNodePos === undefined) return

            const collapsibleNode = this.engine.schema.nodes[aiCollapsibleBlockNodeType].create({
                title,
                isOpen: false,
                isStreaming: true,
                ...this.buildGeneratedRunAttrs(generationRun),
            })
            const transaction = this.engine.state.tr.insert(responseInfo.endOfNodePos - 1, collapsibleNode)
            await this.applyAndPublishTransaction(transaction)
            this.activeCollapsibleRunKey = this.getRunKey(generationRun)
        })
    }

    private endCollapsible(): void {
        this.enqueue(async () => {
            await this.endCollapsibleInQueue()
        })
    }

    private async endCollapsibleInQueue(): Promise<void> {
        const generationRun = this.getReasoningOnlyGenerationRun(this.activeGenerationRun)
        const collapsibleInfo = this.findCollapsibleNode(generationRun)
        this.activeCollapsibleRunKey = null
        if (!collapsibleInfo.found || collapsibleInfo.nodePos === undefined) return

        const node = this.engine.state.doc.nodeAt(collapsibleInfo.nodePos)
        if (!node || node.type.name !== aiCollapsibleBlockNodeType || node.attrs.isStreaming === false) return

        const transaction = this.engine.state.tr.setNodeMarkup(collapsibleInfo.nodePos, undefined, {
            ...node.attrs,
            isStreaming: false,
        })
        await this.applyAndPublishTransaction(transaction)
    }

    private async applyParsedSegment(segment: MarkdownParsedSegment): Promise<void> {
        await this.ensureResponseTarget(this.activeGenerationRun)
        const target = this.findActiveTarget()
        if (!target.found || target.endOfNodePos === undefined || target.childCount === undefined) return

        const transaction = this.engine.state.tr
        applyStreamingSegmentToTransaction(transaction, segment, {
            endOfNodePos: target.endOfNodePos,
            childCount: target.childCount,
        })
        await this.applyAndPublishTransaction(transaction)
    }

    private findActiveTarget(): TargetInfo {
        if (this.activeCollapsibleRunKey) {
            const collapsible = this.findCollapsibleNode(this.getReasoningOnlyGenerationRun(this.activeGenerationRun))
            if (collapsible.found) return collapsible
        }
        return this.findResponseNode(this.activeGenerationRun)
    }

    private async ensureResponseTarget(generationRun: MediaGenerationRunMeta | undefined): Promise<TargetInfo> {
        const existing = this.findResponseNode(generationRun)
        if (existing.found) {
            if (this.usesReasoningSection(generationRun) && existing.nodePos !== undefined) {
                await this.bindProvisionalReasoningSection(existing, generationRun)
                return this.findResponseNode(generationRun)
            }
            if (generationRun && existing.nodePos !== undefined) {
                await this.bindUnsectionedResponseMessage(existing, generationRun)
                return this.findResponseNode(generationRun)
            }
            return existing
        }

        const threadInfo = this.findThreadInsertionPoint()
        if (!threadInfo) return { found: false }

        if (this.usesReasoningSection(generationRun)) {
            const sectionNode = this.engine.schema.nodes[aiReasoningSectionNodeType].create(
                this.buildReasoningSectionAttrs(generationRun),
            )
            const messageInfo = this.findResponseMessage(generationRun)
            const transaction = this.engine.state.tr
            if (messageInfo.found && messageInfo.nodePos !== undefined && messageInfo.contentEndPos !== undefined) {
                const responseMessage = this.engine.state.doc.nodeAt(messageInfo.nodePos)
                if (responseMessage?.type.name === aiResponseMessageNodeType) {
                    transaction.setNodeMarkup(messageInfo.nodePos, undefined, this.buildResponseMessageAttrsForGenerationRun(
                        generationRun,
                        responseMessage.attrs,
                    ))
                }
                transaction.insert(messageInfo.contentEndPos, sectionNode)
            } else {
                const responseNode = this.engine.schema.nodes[aiResponseMessageNodeType].create(
                    this.buildResponseMessageAttrsForGenerationRun(generationRun),
                    sectionNode,
                )
                transaction.insert(threadInfo.insertPos, responseNode)
            }
            await this.applyAndPublishTransaction(transaction)
            return this.findResponseNode(generationRun)
        }

        const responseNode = this.engine.schema.nodes[aiResponseMessageNodeType].create({
            id: `resp-${this.streamId}`,
            isInitialRenderAnimation: true,
            isReceivingAnimation: true,
            aiProvider: this.activeProvider,
            ...this.buildGeneratedRunAttrs(generationRun),
        })
        const transaction = this.engine.state.tr.insert(threadInfo.insertPos, responseNode)
        await this.applyAndPublishTransaction(transaction)
        return this.findResponseNode(generationRun)
    }

    private async bindProvisionalReasoningSection(
        sectionInfo: TargetInfo,
        generationRun: MediaGenerationRunMeta,
    ): Promise<void> {
        if (sectionInfo.nodePos === undefined) return

        const transaction = this.engine.state.tr

        if (sectionInfo.responseMessagePos !== undefined) {
            const responseNode = this.engine.state.doc.nodeAt(sectionInfo.responseMessagePos)
            if (responseNode?.type.name === aiResponseMessageNodeType) {
                const nextAttrs = this.buildResponseMessageAttrsForGenerationRun(generationRun, responseNode.attrs)
                if (!this.attrsMatch(responseNode.attrs, nextAttrs)) {
                    transaction.setNodeMarkup(sectionInfo.responseMessagePos, undefined, nextAttrs)
                }
            }
        }

        const sectionNode = this.engine.state.doc.nodeAt(sectionInfo.nodePos)
        if (sectionNode?.type.name === aiReasoningSectionNodeType) {
            const nextAttrs = this.buildReasoningSectionAttrs(generationRun, sectionNode.attrs)
            if (!this.attrsMatch(sectionNode.attrs, nextAttrs)) {
                transaction.setNodeMarkup(sectionInfo.nodePos, undefined, nextAttrs)
            }
        }

        await this.applyAndPublishTransaction(transaction)
    }

    private async bindUnsectionedResponseMessage(
        responseInfo: TargetInfo,
        generationRun: MediaGenerationRunMeta,
    ): Promise<void> {
        if (responseInfo.nodePos === undefined) return

        const responseNode = this.engine.state.doc.nodeAt(responseInfo.nodePos)
        if (responseNode?.type.name !== aiResponseMessageNodeType) return

        const runAttrs = this.buildGeneratedRunAttrs(generationRun, responseNode.attrs)
        const nextAttrs = {
            ...responseNode.attrs,
            aiProvider: responseNode.attrs.aiProvider || this.activeProvider,
            generationRequestId: runAttrs.generationRequestId,
            reasoningRunId: runAttrs.reasoningRunId,
            mediaRunId: runAttrs.mediaRunId,
            reasoningModelId: runAttrs.reasoningModelId,
            mediaModelId: runAttrs.mediaModelId,
            mediaType: runAttrs.mediaType,
        }
        if (this.attrsMatch(responseNode.attrs, nextAttrs)) return

        const transaction = this.engine.state.tr.setNodeMarkup(responseInfo.nodePos, undefined, nextAttrs)
        await this.applyAndPublishTransaction(transaction)
    }

    private attrsMatch(currentAttrs: Record<string, any>, nextAttrs: Record<string, any>): boolean {
        const currentKeys = Object.keys(currentAttrs)
        const nextKeys = Object.keys(nextAttrs)
        if (currentKeys.length !== nextKeys.length) return false
        return nextKeys.every(key => currentAttrs[key] === nextAttrs[key])
    }

    private getResponseTargetContext(generationRun: MediaGenerationRunMeta | undefined): ResponseTargetContext | null {
        const responseInfo = this.findResponseNode(generationRun)
        if (!responseInfo.found || responseInfo.endOfNodePos === undefined) return null

        const $endPos = this.engine.state.doc.resolve(responseInfo.endOfNodePos)
        const responseNode = $endPos.nodeBefore
        if (!responseNode || (responseNode.type.name !== aiResponseMessageNodeType && responseNode.type.name !== aiReasoningSectionNodeType)) return null

        const responseStartPos = responseInfo.endOfNodePos - responseNode.nodeSize
        const responseMessagePos = responseNode.type.name === aiResponseMessageNodeType
            ? responseStartPos
            : responseInfo.responseMessagePos
        if (responseMessagePos === undefined) return null

        const responseMessageNode = this.engine.state.doc.nodeAt(responseMessagePos)
        if (!responseMessageNode || responseMessageNode.type.name !== aiResponseMessageNodeType) return null

        return {
            responseNode,
            responseStartPos,
            responseEndPos: responseInfo.endOfNodePos,
            responseMessageNode,
            responseMessagePos,
        }
    }

    private applyGenerationRunLineageToChat(
        transaction: Transaction,
        responseContext: ResponseTargetContext,
        generationRun: MediaGenerationRunMeta | undefined,
    ): void {
        this.applyGenerationRunLineageToResponseSection(transaction, responseContext, generationRun)
        this.applyGenerationRunLineageToResponseMessage(transaction, responseContext, generationRun)
    }

    private applyGenerationRunLineageToResponseSection(
        transaction: Transaction,
        responseContext: ResponseTargetContext,
        generationRun: MediaGenerationRunMeta | undefined,
    ): void {
        if (!generationRun?.lineageAssignment) return
        if (responseContext.responseNode.type.name !== aiReasoningSectionNodeType) return

        const currentAttrs = responseContext.responseNode.attrs
        const nextAttrs = this.buildReasoningSectionAttrs(generationRun, currentAttrs)
        const hasLineageAttrChange = currentAttrs.branchOriginNodeId !== nextAttrs.branchOriginNodeId
            || currentAttrs.branchForkNodeId !== nextAttrs.branchForkNodeId
            || currentAttrs.branchLineNodeId !== nextAttrs.branchLineNodeId
            || currentAttrs.generationRequestId !== nextAttrs.generationRequestId
            || currentAttrs.reasoningRunId !== nextAttrs.reasoningRunId
            || currentAttrs.reasoningModelId !== nextAttrs.reasoningModelId
            || currentAttrs.reasoningIndex !== nextAttrs.reasoningIndex

        if (!hasLineageAttrChange) return
        transaction.setNodeMarkup(responseContext.responseStartPos, undefined, nextAttrs)
    }

    private applyGenerationRunLineageToResponseMessage(
        transaction: Transaction,
        responseContext: ResponseTargetContext,
        generationRun: MediaGenerationRunMeta | undefined,
    ): void {
        if (!generationRun?.lineageAssignment) return
        if (responseContext.responseNode.type.name !== aiResponseMessageNodeType) return

        const events = getAiLineageEventsForProjection({
            branchOriginNodeId: generationRun.lineageAssignment.branchOriginNodeId,
            branchForkNodeId: generationRun.lineageAssignment.branchForkNodeId,
            branchLineNodeId: generationRun.lineageAssignment.branchLineNodeId,
            reasoningIndex: generationRun.reasoningIndex,
        }, 'conversation')
        if (events.length === 0) return

        const responseMessagePos = transaction.mapping.map(responseContext.responseMessagePos, 1)
        const responseMessageNode = transaction.doc.nodeAt(responseMessagePos)
        if (!responseMessageNode || responseMessageNode.type.name !== aiResponseMessageNodeType) return

        const existingEventIds = new Set<string>()
        let insertAfterLeadingLineageEventsPos = responseMessagePos + 1
        let hasSeenNonLineageEventNode = false

        responseMessageNode.forEach((child: ProseMirrorNode, offset: number) => {
            if (child.type.name === aiLineageEventNodeType) {
                existingEventIds.add(this.getLineageEventIdentityFromNode(child))
                if (!hasSeenNonLineageEventNode) {
                    insertAfterLeadingLineageEventsPos = responseMessagePos + 1 + offset + child.nodeSize
                }
                return
            }

            hasSeenNonLineageEventNode = true
        })

        let insertPos = insertAfterLeadingLineageEventsPos
        for (const event of events) {
            const eventId = this.getLineageEventIdentity(event)
            if (existingEventIds.has(eventId)) continue

            const eventNode = this.buildAiLineageEventNode(event, generationRun.reasoningModelId || '')
            if (!eventNode) continue

            transaction.insert(insertPos, eventNode)
            insertPos += eventNode.nodeSize
            existingEventIds.add(eventId)
        }
    }

    private buildAiLineageEventNode(event: AiLineageEventDescriptor, reasoningModelId: string): ProseMirrorNode | null {
        const nodeType = this.engine.schema.nodes[aiLineageEventNodeType]
        if (!nodeType) return null

        return nodeType.create({
            kind: event.kind,
            branchOriginNodeId: event.branchOriginNodeId ?? '',
            branchForkNodeId: event.branchForkNodeId ?? '',
            branchLineNodeId: event.branchLineNodeId ?? '',
            reasoningModelId,
        })
    }

    private getLineageEventIdentity(event: AiLineageEventDescriptor): string {
        const id = event.kind === 'branch-origin'
            ? event.branchOriginNodeId
            : event.kind === 'branch-line'
                ? event.branchLineNodeId
                : event.branchForkNodeId
        return `${event.kind}:${id ?? ''}`
    }

    private getLineageEventIdentityFromNode(node: ProseMirrorNode): string {
        return this.getLineageEventIdentity({
            kind: node.attrs.kind,
            branchOriginNodeId: node.attrs.branchOriginNodeId || '',
            branchForkNodeId: node.attrs.branchForkNodeId || '',
            branchLineNodeId: node.attrs.branchLineNodeId || '',
        })
    }

    private upsertGenerationTrace(content: AiStreamContent): void {
        if (!content.imageGenerationTrace
            && !content.videoGenerationTrace
            && !content.capabilityGenerationTrace) return
        if (!this.isStarted) this.start()

        this.enqueue(async () => {
            const generationRun = content.generationRun
            const reasoningGenerationRun = this.getReasoningOnlyGenerationRun(generationRun)
            await this.ensureResponseTarget(reasoningGenerationRun)

            const transaction = this.engine.state.tr
            const responseContext = this.getResponseTargetContext(generationRun)
            if (responseContext) {
                this.applyGenerationRunLineageToChat(transaction, responseContext, generationRun)
            }

            const attrs = content.imageGenerationTrace
                ? {
                    title: 'Image generation details',
                    isOpen: false,
                    isStreaming: false,
                    imageGenerationTrace: content.imageGenerationTrace,
                    imageGenerationTraceId: null,
                }
                : content.videoGenerationTrace
                    ? {
                    title: 'Video generation details',
                    isOpen: false,
                    isStreaming: false,
                    videoGenerationTrace: content.videoGenerationTrace,
                    }
                    : {
                        title: `${content.capabilityGenerationTrace!.capabilityName} generation details`,
                        isOpen: false,
                        isStreaming: false,
                        capabilityGenerationTrace: content.capabilityGenerationTrace,
                    }
            // A reasoning run can fan out into several media runs. Each media run
            // owns a different final prompt and trace, so key the trace block by
            // the full run instead of letting sibling variants overwrite it.
            const runAttrs = this.buildGeneratedRunAttrs(generationRun)
            const collapsibleInfo = this.findCollapsibleNode(generationRun)

            if (collapsibleInfo.found && collapsibleInfo.nodePos !== undefined) {
                const collapsibleNodePos = transaction.mapping.map(collapsibleInfo.nodePos, 1)
                const collapsibleNode = transaction.doc.nodeAt(collapsibleNodePos)
                if (collapsibleNode?.type.name === aiCollapsibleBlockNodeType) {
                    transaction.setNodeMarkup(collapsibleNodePos, undefined, {
                        ...collapsibleNode.attrs,
                        ...attrs,
                        ...runAttrs,
                    })
                }
            } else {
                const responseInfo = this.findResponseNode(reasoningGenerationRun)
                if (!responseInfo.found || responseInfo.endOfNodePos === undefined) return

                const collapsibleNode = this.engine.schema.nodes[aiCollapsibleBlockNodeType].create({
                    ...attrs,
                    ...runAttrs,
                })
                transaction.insert(transaction.mapping.map(responseInfo.endOfNodePos - 1, -1), collapsibleNode)
            }

            await this.applyAndPublishTransaction(transaction)
        })
    }

    private findGeneratedImageInResponse(
        responseContext: ResponseTargetContext,
        options: {
            partialIndex?: number
            assetId?: string
            responseId?: string
            mediaRunId?: string
            partialOnly?: boolean
        },
    ): MediaNodeInfo | null {
        let matchedImage: MediaNodeInfo | null = null

        responseContext.responseNode.forEach((child: ProseMirrorNode, offset: number) => {
            if (child.type.name !== aiGeneratedImageNodeType) return
            if (options.partialOnly && !child.attrs.isPartial) return
            if (options.mediaRunId && child.attrs.mediaRunId !== options.mediaRunId) return

            const nodeInfo = {
                node: child,
                nodePos: responseContext.responseStartPos + 1 + offset,
            }

            if (options.assetId && child.attrs.assetId === options.assetId) {
                matchedImage = nodeInfo
                return
            }

            if (options.responseId && child.attrs.responseId === options.responseId) {
                matchedImage = nodeInfo
                return
            }

            if (options.partialIndex !== undefined && child.attrs.partialIndex === options.partialIndex) {
                matchedImage = nodeInfo
                return
            }

            if (options.mediaRunId) {
                matchedImage = nodeInfo
            }
        })

        return matchedImage
    }

    private upsertImage(content: AiStreamContent, isPartial: boolean, clearImageData = false): void {
        if (!this.isStarted) this.start()

        this.enqueue(async () => {
            const imageNodeType = this.engine.schema.nodes[aiGeneratedImageNodeType]
            if (!imageNodeType) return

            await this.ensureResponseTarget(content.generationRun)
            const responseContext = this.getResponseTargetContext(content.generationRun)
            if (!responseContext) return

            const existingImage = this.findGeneratedImageInResponse(responseContext, {
                mediaRunId: content.generationRun?.mediaRunId,
                assetId: content.assetId,
                responseId: content.responseId,
                ...(isPartial ? { partialIndex: content.partialIndex ?? 0, partialOnly: true } : {}),
            }) ?? (!isPartial ? this.findGeneratedImageInResponse(responseContext, {
                mediaRunId: content.generationRun?.mediaRunId,
                assetId: content.assetId,
                responseId: content.responseId,
                partialOnly: true,
            }) : null)

            const transaction = this.engine.state.tr
            const stalePartialRanges: Array<{ from: number; to: number }> = []

            if (!isPartial) {
                responseContext.responseNode.forEach((child: ProseMirrorNode, offset: number) => {
                    if (child.type.name !== aiGeneratedImageNodeType || !child.attrs.isPartial) return
                    if (content.generationRun?.mediaRunId && child.attrs.mediaRunId !== content.generationRun.mediaRunId) return

                    const from = responseContext.responseStartPos + 1 + offset
                    if (existingImage?.nodePos === from) return

                    stalePartialRanges.push({ from, to: from + child.nodeSize })
                })
            }

            for (const range of stalePartialRanges.reverse()) {
                transaction.delete(range.from, range.to)
            }

            this.applyGenerationRunLineageToChat(transaction, responseContext, content.generationRun)
            const imageNodePos = existingImage ? transaction.mapping.map(existingImage.nodePos, 1) : undefined
            const insertionPos = transaction.mapping.map(responseContext.responseEndPos - 1, -1)
            const partialIndex = content.partialIndex ?? existingImage?.node.attrs.partialIndex ?? 0
            const imageAttrs = this.buildGeneratedImageAttrs(
                content,
                isPartial,
                partialIndex,
                existingImage?.node.attrs,
                clearImageData,
            )

            if (imageNodePos !== undefined) {
                transaction.setNodeMarkup(imageNodePos, undefined, imageAttrs)
            } else {
                transaction.insert(insertionPos, imageNodeType.create(imageAttrs))
            }

            await this.applyAndPublishTransaction(transaction)
        })
    }

    private findGeneratedVideoInResponse(
        responseContext: ResponseTargetContext,
        options: {
            mediaRunId?: string
            assetId?: string
            responseId?: string
        },
    ): MediaNodeInfo | null {
        let matchedVideo: MediaNodeInfo | null = null

        responseContext.responseNode.forEach((child: ProseMirrorNode, offset: number) => {
            if (child.type.name !== aiGeneratedVideoNodeType) return
            if (options.mediaRunId && child.attrs.mediaRunId !== options.mediaRunId) return

            const nodeInfo = {
                node: child,
                nodePos: responseContext.responseStartPos + 1 + offset,
            }

            if (options.assetId && child.attrs.assetId === options.assetId) {
                matchedVideo = nodeInfo
                return
            }

            if (options.responseId && child.attrs.responseId === options.responseId) {
                matchedVideo = nodeInfo
                return
            }

            if (options.mediaRunId) {
                matchedVideo = nodeInfo
            }
        })

        return matchedVideo
    }

    private upsertVideo(content: AiStreamContent, isPending: boolean, errorMessage = ''): void {
        if (!this.isStarted) this.start()

        this.enqueue(async () => {
            const videoNodeType = this.engine.schema.nodes[aiGeneratedVideoNodeType]
            if (!videoNodeType) return

            await this.ensureResponseTarget(content.generationRun)
            const responseContext = this.getResponseTargetContext(content.generationRun)
            if (!responseContext) return

            const existingVideo = this.findGeneratedVideoInResponse(responseContext, {
                mediaRunId: content.generationRun?.mediaRunId,
                assetId: content.assetId,
                responseId: content.responseId,
            })
            const transaction = this.engine.state.tr
            this.applyGenerationRunLineageToChat(transaction, responseContext, content.generationRun)
            const videoNodePos = existingVideo ? transaction.mapping.map(existingVideo.nodePos, 1) : undefined
            const insertionPos = transaction.mapping.map(responseContext.responseEndPos - 1, -1)
            const videoAttrs = this.buildGeneratedVideoAttrs(content, isPending, errorMessage, existingVideo?.node.attrs)

            if (videoNodePos !== undefined) {
                transaction.setNodeMarkup(videoNodePos, undefined, videoAttrs)
            } else {
                transaction.insert(insertionPos, videoNodeType.create(videoAttrs))
            }

            await this.applyAndPublishTransaction(transaction)
        })
    }

    private nodeContainsGenerationRequest(node: ProseMirrorNode, generationRequestId: string): boolean {
        if (node.attrs?.generationRequestId === generationRequestId) return true
        let matches = false
        node.descendants((child: ProseMirrorNode) => {
            if (child.attrs?.generationRequestId !== generationRequestId) return
            matches = true
            return false
        })
        return matches
    }

    private async finalizeResponseTargets(
        generationRequestId?: string,
        options: { publishSteps?: boolean; cancelled?: boolean } = {},
    ): Promise<void> {
        if (!generationRequestId) {
            const responseInfo = this.findResponseNode(this.activeGenerationRun)
            if (!responseInfo.found || responseInfo.nodePos === undefined) return

            const node = this.engine.state.doc.nodeAt(responseInfo.nodePos)
            if (!node || (node.type.name !== aiResponseMessageNodeType && node.type.name !== aiReasoningSectionNodeType)) return
            if (node.attrs.isInitialRenderAnimation === false && node.attrs.isReceivingAnimation === false) return

            const transaction = this.engine.state.tr.setNodeMarkup(responseInfo.nodePos, undefined, {
                ...node.attrs,
                isInitialRenderAnimation: false,
                isReceivingAnimation: false,
            })
            await this.applyFinalizationTransaction(transaction, options.publishSteps !== false)
            return
        }

        const transaction = this.engine.state.tr
        this.engine.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            const nodeType = node.type.name
            const matchesRequest = nodeType === aiResponseMessageNodeType
                ? this.nodeContainsGenerationRequest(node, generationRequestId)
                : node.attrs?.generationRequestId === generationRequestId
            if (!matchesRequest) return

            if (nodeType === aiResponseMessageNodeType || nodeType === aiReasoningSectionNodeType) {
                if (node.attrs.isInitialRenderAnimation === false && node.attrs.isReceivingAnimation === false) return
                transaction.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    isInitialRenderAnimation: false,
                    isReceivingAnimation: false,
                })
                return
            }

            if (nodeType === aiCollapsibleBlockNodeType && node.attrs.isStreaming !== false) {
                transaction.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    isStreaming: false,
                })
                return
            }

            if (options.cancelled && nodeType === aiGeneratedVideoNodeType && node.attrs.isPending !== false) {
                transaction.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    isPending: false,
                    errorMessage: node.attrs.errorMessage || 'Generation cancelled',
                })
            }
        })
        await this.applyFinalizationTransaction(transaction, options.publishSteps !== false)
    }

    private async applyFinalizationTransaction(transaction: Transaction, publishSteps: boolean): Promise<void> {
        if (!transaction.docChanged || transaction.steps.length === 0) return
        if (publishSteps) {
            await this.applyAndPublishTransaction(transaction)
            return
        }
        this.engine.applyTransaction(transaction)
    }

    private async applyAndPublishTransaction(transaction: Transaction): Promise<void> {
        if (!transaction.docChanged || transaction.steps.length === 0) return

        for (const step of transaction.steps) {
            const nextVersion = this.engine.version + 1
            await this.publishStep(step, nextVersion)
            this.engine.applyTransaction(this.engine.state.tr.step(step))
        }
    }

    private async publishStep(step: Step, version: number): Promise<void> {
        await this.ensureSubjectSequence()
        const nextSubjectSeq = this.subjectSeq! + 1
        const published = await this.transport.publishAiStreamStep({
            ...this.coordinate,
            expectedLastStreamSequence: this.lastStreamSeq!,
            subjectSeq: nextSubjectSeq,
            version,
            step: step.toJSON(),
            msgId: this.buildMessageId('step', nextSubjectSeq),
            aiProvider: this.activeProvider,
            generationRun: this.activeGenerationRun,
        })
        this.subjectSeq = published.envelope.subjectSeq
        this.lastStreamSeq = published.streamSequence
    }

    private async persistFinalSnapshot(finalVersion: number): Promise<boolean> {
        try {
            await AssetDocumentService.settle({
                organizationId: this.coordinate.organizationId,
                assetId: this.coordinate.assetId,
                role: 'conversation',
                workspaceId: this.config.workspaceId,
                leaseId: this.config.leaseId,
                holderId: this.config.leaseHolderId,
                trigger: 'final-snapshot',
            })
            return true
        } catch (error) {
            err('[AiChatProseMirrorStreamAssembler] final snapshot persistence failed:', error)
            await this.publishControl('ERROR', {
                version: finalVersion,
                error: 'AI response snapshot persistence failed',
            })
            return false
        }
    }

    private sanitizeSnapshotForPersistence(value: unknown): unknown {
        if (value === undefined) return null
        if (value === null || typeof value !== 'object') return value
        if (Array.isArray(value)) {
            return value.map(item => this.sanitizeSnapshotForPersistence(item))
        }

        const result: Record<string, unknown> = {}
        for (const [key, item] of Object.entries(value)) {
            if (item === undefined) continue
            result[key] = this.sanitizeSnapshotForPersistence(item)
        }
        return result
    }

    private async publishControl(
        kind: 'START' | 'END' | 'ERROR',
        event: {
            version: number
            baseVersion?: number
            finalVersion?: number
            schemaVersion?: string
            error?: string
        },
    ): Promise<void> {
        await this.ensureSubjectSequence()
        const nextSubjectSeq = this.subjectSeq! + 1
        const published = await this.transport.publishControlEvent({
            ...this.coordinate,
            expectedLastStreamSequence: this.lastStreamSeq!,
            subjectSeq: nextSubjectSeq,
            kind,
            ...event,
            msgId: this.buildMessageId(kind.toLowerCase(), nextSubjectSeq),
            aiProvider: this.activeProvider,
            generationRun: this.activeGenerationRun,
        })
        this.subjectSeq = published.envelope.subjectSeq
        this.lastStreamSeq = published.streamSequence
    }

    private async ensureSubjectSequence(): Promise<void> {
        if (this.subjectSeq !== undefined && this.lastStreamSeq !== undefined) return
        const state = await this.transport.getCurrentSubjectState(this.coordinate)
        this.subjectSeq = state.subjectSeq
        this.lastStreamSeq = state.streamSequence
    }

    private async syncEngineToAuthority(): Promise<void> {
        if ((this.config.baseVersion ?? 0) === 0 && this.subjectSeq === undefined && this.lastStreamSeq === undefined) return

        const localStreamSeq = this.lastStreamSeq ?? 0
        const state = await this.transport.getCurrentSubjectState(this.coordinate)
        if (state.streamSequence <= localStreamSeq) {
            this.subjectSeq = state.subjectSeq
            this.lastStreamSeq = state.streamSequence
            return
        }

        const events = await this.transport.replayDocumentStepEvents({
            ...this.coordinate,
            startStreamSeq: localStreamSeq + 1,
            maxMessages: 1000,
        })

        for (const event of events) {
            if (event.kind !== 'STEP' || event.version <= this.engine.version) continue
            const step = Step.fromJSON(this.engine.schema, event.step)
            this.engine.applyTransaction(this.engine.state.tr.step(step))
        }

        const latestState = await this.transport.getCurrentSubjectState(this.coordinate)
        this.subjectSeq = latestState.subjectSeq
        this.lastStreamSeq = latestState.streamSequence
    }

    private async resetSubjectIfStartingFromBase(): Promise<void> {
        if ((this.config.baseVersion ?? 0) !== 0) return
        const state = await this.transport.getCurrentSubjectState(this.coordinate)
        if (state.streamSequence > 0) {
            await this.transport.purgeDocumentSubject(this.coordinate)
        }
        this.subjectSeq = 0
        this.lastStreamSeq = 0
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        const queuedTask = new Promise<void>((resolve) => {
            this.workQueue.push({ task, resolve })
        })
        if (!this.isProcessingQueue) {
            this.isProcessingQueue = true
            void this.processQueue()
        }
        return queuedTask
    }

    private async processQueue(): Promise<void> {
        try {
            while (this.workQueue.length > 0) {
                const queuedTask = this.workQueue.shift()
                if (!queuedTask) continue
                try {
                    await this.runQueuedTaskWithAuthorityRetry(queuedTask)
                } catch (error) {
                    err('[AiChatProseMirrorStreamAssembler] queued task failed:', error)
                } finally {
                    queuedTask.resolve()
                }
            }
        } finally {
            this.isProcessingQueue = false
            if (this.workQueue.length > 0) {
                this.isProcessingQueue = true
                void this.processQueue()
            }
        }
    }

    private async runQueuedTaskWithAuthorityRetry(queuedTask: QueuedTask): Promise<void> {
        for (let attempt = 0; attempt <= MAX_AUTHORITY_CAS_RETRIES; attempt += 1) {
            try {
                await this.syncEngineToAuthority()
                await queuedTask.task()
                return
            } catch (error) {
                if (!this.transport.isExpectationFailure(error) || attempt === MAX_AUTHORITY_CAS_RETRIES) {
                    throw error
                }
                this.subjectSeq = undefined
                this.lastStreamSeq = undefined
            }
        }
    }

    private findThreadInsertionPoint(): ThreadInsertionPoint | null {
        let result: ThreadInsertionPoint | null = null
        this.engine.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name !== aiChatThreadNodeType) return
            if (node.attrs?.threadId !== this.config.aiChatThreadId) return

            result = { insertPos: pos + node.nodeSize - 1 }
            return false
        })
        return result
    }

    private findResponseNode(generationRun: MediaGenerationRunMeta | undefined): TargetInfo {
        if (this.usesReasoningSection(generationRun)) return this.findReasoningSection(generationRun)

        let bestEndPos: number | undefined
        let bestChildCount: number | undefined
        let bestNodePos: number | undefined
        let bestScore = -1

        this.engine.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name !== aiChatThreadNodeType || node.attrs?.threadId !== this.config.aiChatThreadId) return

            node.descendants((child: ProseMirrorNode, relPos: number) => {
                if (child.type.name !== aiResponseMessageNodeType) return

                const nodePos = pos + relPos + 1
                const endPos = nodePos + child.nodeSize
                const runScore = this.getUnsectionedResponseRunScore(child.attrs, generationRun)
                if (runScore < 0) return

                const score = runScore + (child.attrs?.isReceivingAnimation ? 2 : (child.attrs?.isInitialRenderAnimation ? 1 : 0))
                if (score > bestScore || (score === bestScore && endPos > (bestEndPos || 0))) {
                    bestScore = score
                    bestEndPos = endPos
                    bestChildCount = child.childCount
                    bestNodePos = nodePos
                }
            })
            return false
        })

        return bestEndPos !== undefined
            ? {
                found: true,
                endOfNodePos: bestEndPos,
                childCount: bestChildCount,
                nodePos: bestNodePos,
                responseMessagePos: bestNodePos,
            }
            : { found: false }
    }

    private getUnsectionedResponseRunScore(
        attrs: Record<string, any>,
        generationRun: MediaGenerationRunMeta | undefined,
    ): number {
        if (!generationRun) return 0

        const responseRequestId = attrs?.generationRequestId || ''
        const responseReasoningRunId = attrs?.reasoningRunId || ''
        const responseMediaRunId = attrs?.mediaRunId || ''
        const requestMatches = responseRequestId === generationRun.generationRequestId
        const isProvisional = !responseRequestId && !responseReasoningRunId && !responseMediaRunId

        if (generationRun.mediaRunId && responseMediaRunId === generationRun.mediaRunId) return 100
        if (generationRun.reasoningRunId && responseReasoningRunId === generationRun.reasoningRunId && requestMatches) return 90
        if (requestMatches && !responseMediaRunId) return 70
        if (isProvisional) return 10
        return -1
    }

    private findReasoningSection(generationRun: MediaGenerationRunMeta): TargetInfo {
        const requestId = generationRun.generationRequestId || ''
        let bestEndPos: number | undefined
        let bestChildCount: number | undefined
        let bestNodePos: number | undefined
        let bestResponseMessagePos: number | undefined
        let bestScore = -1

        this.engine.state.doc.descendants((threadNode: ProseMirrorNode, threadPos: number) => {
            if (threadNode.type.name !== aiChatThreadNodeType || threadNode.attrs?.threadId !== this.config.aiChatThreadId) return

            threadNode.forEach((responseNode: ProseMirrorNode, responseOffset: number) => {
                if (responseNode.type.name !== aiResponseMessageNodeType) return

                const responseRequestId = responseNode.attrs?.generationRequestId || ''
                const requestMatches = requestId ? responseRequestId === requestId : true
                const isProvisionalTemplate = Boolean(requestId && !responseRequestId)
                if (!requestMatches && !isProvisionalTemplate) return

                const responseMessagePos = threadPos + 1 + responseOffset
                responseNode.forEach((sectionNode: ProseMirrorNode, sectionOffset: number) => {
                    if (sectionNode.type.name !== aiReasoningSectionNodeType) return

                    let score = -1
                    if (sectionNode.attrs?.reasoningRunId === generationRun.reasoningRunId) {
                        score = 100
                    } else if (isProvisionalTemplate && this.reasoningTemplateMatchesGenerationRun(sectionNode.attrs, generationRun)) {
                        score = 50
                    } else if (requestMatches && this.reasoningTemplateMatchesGenerationRun(sectionNode.attrs, generationRun)) {
                        score = 40
                    }
                    if (score < 0) return

                    const nodePos = responseMessagePos + 1 + sectionOffset
                    const endPos = nodePos + sectionNode.nodeSize
                    score += sectionNode.attrs?.isReceivingAnimation ? 2 : 0
                    if (score > bestScore || (score === bestScore && endPos > (bestEndPos || 0))) {
                        bestScore = score
                        bestEndPos = endPos
                        bestChildCount = sectionNode.childCount
                        bestNodePos = nodePos
                        bestResponseMessagePos = responseMessagePos
                    }
                })
            })
            return false
        })

        return bestEndPos !== undefined
            ? {
                found: true,
                endOfNodePos: bestEndPos,
                childCount: bestChildCount,
                nodePos: bestNodePos,
                responseMessagePos: bestResponseMessagePos,
            }
            : { found: false }
    }

    private findResponseMessage(generationRun: MediaGenerationRunMeta | undefined): ResponseMessageInfo {
        let exactNodePos: number | undefined
        let exactContentEnd: number | undefined
        let templateNodePos: number | undefined
        let templateContentEnd: number | undefined
        const requestId = generationRun?.generationRequestId

        this.engine.state.doc.descendants((threadNode: ProseMirrorNode, threadPos: number) => {
            if (threadNode.type.name !== aiChatThreadNodeType || threadNode.attrs?.threadId !== this.config.aiChatThreadId) return

            threadNode.forEach((child: ProseMirrorNode, offset: number) => {
                if (child.type.name !== aiResponseMessageNodeType) return

                const nodePos = threadPos + 1 + offset
                const contentEnd = nodePos + child.nodeSize - 1
                const responseRequestId = child.attrs?.generationRequestId || ''

                if (requestId && responseRequestId === requestId) {
                    if (exactNodePos === undefined || nodePos > exactNodePos) {
                        exactNodePos = nodePos
                        exactContentEnd = contentEnd
                    }
                    return
                }

                if (!requestId || responseRequestId) return

                let matchingSectionFound = false
                child.forEach((sectionNode: ProseMirrorNode) => {
                    if (matchingSectionFound) return
                    if (sectionNode.type.name !== aiReasoningSectionNodeType) return
                    if (this.usesReasoningSection(generationRun) && !this.reasoningTemplateMatchesGenerationRun(sectionNode.attrs, generationRun)) return
                    matchingSectionFound = true
                })

                if (matchingSectionFound && (templateNodePos === undefined || nodePos > templateNodePos)) {
                    templateNodePos = nodePos
                    templateContentEnd = contentEnd
                }
            })
            return false
        })

        const nodePos = exactNodePos ?? templateNodePos
        const contentEndPos = exactContentEnd ?? templateContentEnd
        return nodePos !== undefined
            ? { found: true, nodePos, contentEndPos }
            : { found: false }
    }

    private findCollapsibleNode(generationRun: MediaGenerationRunMeta | undefined): TargetInfo {
        let exactResult: TargetInfo | undefined
        let templateResult: TargetInfo | undefined
        this.engine.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name !== aiChatThreadNodeType || node.attrs?.threadId !== this.config.aiChatThreadId) return

            node.descendants((child: ProseMirrorNode, relPos: number) => {
                if (child.type.name !== aiCollapsibleBlockNodeType) return
                if (this.usesReasoningSection(generationRun) && child.attrs?.reasoningRunId !== generationRun.reasoningRunId) return

                const nodePos = pos + relPos + 1
                const result = {
                    found: true,
                    nodePos,
                    endOfNodePos: nodePos + child.nodeSize,
                    childCount: child.childCount,
                }
                if (!generationRun?.mediaRunId) {
                    exactResult = result
                    return
                }
                if (child.attrs?.mediaRunId === generationRun.mediaRunId) {
                    exactResult = result
                    return
                }
                if (!child.attrs?.mediaRunId
                    && !child.attrs?.imageGenerationTrace
                    && !child.attrs?.videoGenerationTrace
                    && !child.attrs?.capabilityGenerationTrace) {
                    templateResult = result
                }
            })
            return false
        })
        return exactResult ?? templateResult ?? { found: false }
    }

    private updateContext(content: AiStreamContent): void {
        if (content.aiProvider) this.activeProvider = content.aiProvider
        if (content.generationRun) this.activeGenerationRun = content.generationRun
    }

    private usesReasoningSection(
        generationRun: MediaGenerationRunMeta | undefined,
    ): generationRun is MediaGenerationRunMeta & { requestKind: 'media-generation-matrix' } {
        return generationRun?.requestKind === 'media-generation-matrix'
    }

    private parseRunIndex(value: unknown): number | null {
        if (value === null || value === undefined || value === '') return null
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
    }

    private reasoningTemplateMatchesGenerationRun(
        attrs: Record<string, any>,
        generationRun: MediaGenerationRunMeta,
    ): boolean {
        if (attrs?.reasoningRunId) return attrs.reasoningRunId === generationRun.reasoningRunId

        const attrModelId = typeof attrs?.reasoningModelId === 'string' ? attrs.reasoningModelId : ''
        const runModelId = generationRun.reasoningModelId || ''
        if (attrModelId && runModelId && attrModelId !== runModelId) return false

        const attrIndex = this.parseRunIndex(attrs?.reasoningIndex)
        const runIndex = this.parseRunIndex(generationRun.reasoningIndex)
        return attrIndex === null || runIndex === null || attrIndex === runIndex
    }

    private getReasoningOnlyGenerationRun(generationRun: MediaGenerationRunMeta | undefined): MediaGenerationRunMeta | undefined {
        if (!this.usesReasoningSection(generationRun)) return undefined

        return {
            requestKind: generationRun.requestKind,
            generationRequestId: generationRun.generationRequestId,
            reasoningRunId: generationRun.reasoningRunId,
            reasoningModelId: generationRun.reasoningModelId,
            reasoningIndex: generationRun.reasoningIndex,
            lineageAssignment: generationRun.lineageAssignment,
        }
    }

    private buildGeneratedRunAttrs(
        generationRun: MediaGenerationRunMeta | undefined,
        previousAttrs: Partial<GeneratedRunAttrs> = {},
    ): GeneratedRunAttrs {
        return {
            generationRequestId: generationRun?.generationRequestId || previousAttrs.generationRequestId || '',
            reasoningRunId: generationRun?.reasoningRunId || previousAttrs.reasoningRunId || '',
            mediaRunId: generationRun?.mediaRunId || previousAttrs.mediaRunId || '',
            reasoningModelId: generationRun?.reasoningModelId || previousAttrs.reasoningModelId || '',
            mediaModelId: generationRun?.mediaModelId || previousAttrs.mediaModelId || '',
            mediaType: generationRun?.mediaType || previousAttrs.mediaType || '',
            variantIndex: generationRun?.variantIndex ?? previousAttrs.variantIndex ?? null,
        }
    }

    private buildGeneratedMediaRunAttrs(
        generationRun: MediaGenerationRunMeta | undefined,
        previousAttrs: Partial<GeneratedMediaRunAttrs> = {},
    ): GeneratedMediaRunAttrs {
        const lineageAssignment = generationRun?.lineageAssignment
        return {
            ...this.buildGeneratedRunAttrs(generationRun, previousAttrs),
            branchId: lineageAssignment?.branchId || previousAttrs.branchId || '',
            parentMediaNodeId: lineageAssignment?.parentMediaNodeId || previousAttrs.parentMediaNodeId || '',
            branchOriginNodeId: lineageAssignment?.branchOriginNodeId || previousAttrs.branchOriginNodeId || '',
            branchForkNodeId: lineageAssignment?.branchForkNodeId || previousAttrs.branchForkNodeId || '',
            branchLineNodeId: lineageAssignment?.branchLineNodeId || previousAttrs.branchLineNodeId || '',
            lineageParentNodeId: lineageAssignment?.lineageParentNodeId || previousAttrs.lineageParentNodeId || '',
        }
    }

    private buildMediaModelId(provider: string | undefined, model: string | undefined): string {
        if (!model) return ''
        return model.includes(':') || !provider ? model : `${provider}:${model}`
    }

    private normalizeAlignment(value: unknown): 'left' | 'center' | 'right' {
        return value === 'left' || value === 'center' || value === 'right'
            ? value
            : AI_GENERATED_MEDIA_ALIGNMENT
    }

    private normalizeTextWrap(value: unknown): 'none' | 'left' | 'right' {
        return value === 'left' || value === 'right' || value === 'none'
            ? value
            : AI_GENERATED_MEDIA_TEXT_WRAP
    }

    private normalizeAspectRatio(value: unknown, fallback: unknown): number {
        const rawValue = value ?? fallback
        if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue > 0) return rawValue
        if (typeof rawValue !== 'string') return 1.777

        const trimmed = rawValue.trim()
        const ratioMatch = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(trimmed)
        if (ratioMatch) {
            const width = Number(ratioMatch[1])
            const height = Number(ratioMatch[2])
            if (Number.isFinite(width) && Number.isFinite(height) && height > 0) return width / height
        }

        const parsed = Number(trimmed)
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1.777
    }

    private buildGeneratedImageAttrs(
        content: AiStreamContent,
        isPartial: boolean,
        partialIndex: number,
        previousAttrs: Record<string, any> = {},
        clearImageData = false,
    ): Record<string, any> {
        const runAttrs = this.buildGeneratedMediaRunAttrs(content.generationRun, previousAttrs)
        const mediaModelId = runAttrs.mediaModelId || this.buildMediaModelId(content.imageModelProvider, content.imageModelId)

        return {
            imageData: clearImageData ? '' : content.imageUrl || previousAttrs.imageData || '',
            assetId: content.assetId || previousAttrs.assetId || content.generationRun?.lineageAssignment?.assetId || '',
            revisedPrompt: content.revisedPrompt || previousAttrs.revisedPrompt || '',
            responseId: content.responseId || previousAttrs.responseId || '',
            aiModel: content.aiProvider || previousAttrs.aiModel || '',
            isPartial,
            partialIndex,
            width: previousAttrs.width || AI_GENERATED_MEDIA_WIDTH,
            alignment: this.normalizeAlignment(previousAttrs.alignment),
            textWrap: this.normalizeTextWrap(previousAttrs.textWrap),
            ...runAttrs,
            mediaModelId,
        }
    }

    private buildGeneratedVideoAttrs(
        content: AiStreamContent,
        isPending: boolean,
        errorMessage: string,
        previousAttrs: Record<string, any> = {},
    ): Record<string, any> {
        const runAttrs = this.buildGeneratedMediaRunAttrs(content.generationRun, previousAttrs)
        const mediaModelId = runAttrs.mediaModelId || this.buildMediaModelId(content.videoModelProvider, content.videoModelId)
        const videoModel = this.buildMediaModelId(content.videoModelProvider, content.videoModelId)
            || content.generationRun?.mediaModelId
            || previousAttrs.videoModel
            || mediaModelId

        return {
            videoUrl: content.videoUrl || previousAttrs.videoUrl || '',
            assetId: content.assetId || previousAttrs.assetId || content.generationRun?.lineageAssignment?.assetId || '',
            posterUrl: content.posterUrl || previousAttrs.posterUrl || '',
            durationSeconds: content.durationSeconds ?? previousAttrs.durationSeconds ?? 0,
            aspectRatio: this.normalizeAspectRatio(content.aspectRatio, previousAttrs.aspectRatio),
            hasAudio: content.hasAudio ?? previousAttrs.hasAudio ?? true,
            revisedPrompt: content.revisedPrompt || previousAttrs.revisedPrompt || '',
            responseId: content.responseId || previousAttrs.responseId || '',
            videoModel,
            isPending,
            errorMessage,
            width: previousAttrs.width || AI_GENERATED_MEDIA_WIDTH,
            alignment: this.normalizeAlignment(previousAttrs.alignment),
            textWrap: this.normalizeTextWrap(previousAttrs.textWrap),
            ...runAttrs,
            mediaModelId,
        }
    }

    private buildReasoningSectionAttrs(
        generationRun: MediaGenerationRunMeta,
        previousAttrs: Record<string, any> = {},
    ): Record<string, any> {
        return {
            ...previousAttrs,
            generationRequestId: generationRun.generationRequestId || previousAttrs.generationRequestId || '',
            reasoningRunId: generationRun.reasoningRunId || previousAttrs.reasoningRunId || '',
            reasoningModelId: generationRun.reasoningModelId || previousAttrs.reasoningModelId || '',
            reasoningIndex: generationRun.reasoningIndex ?? previousAttrs.reasoningIndex ?? null,
            branchOriginNodeId: generationRun.lineageAssignment?.branchOriginNodeId || previousAttrs.branchOriginNodeId || '',
            branchForkNodeId: generationRun.lineageAssignment?.branchForkNodeId || previousAttrs.branchForkNodeId || '',
            branchLineNodeId: generationRun.lineageAssignment?.branchLineNodeId || previousAttrs.branchLineNodeId || '',
            isReceivingAnimation: true,
        }
    }

    private buildResponseMessageAttrsForGenerationRun(
        generationRun: MediaGenerationRunMeta,
        previousAttrs: Record<string, any> = {},
    ): Record<string, any> {
        return {
            ...previousAttrs,
            id: previousAttrs.id || `resp-${generationRun.generationRequestId || this.streamId}`,
            isInitialRenderAnimation: previousAttrs.isInitialRenderAnimation ?? true,
            isReceivingAnimation: true,
            aiProvider: previousAttrs.aiProvider || this.activeProvider,
            generationRequestId: generationRun.generationRequestId || previousAttrs.generationRequestId || '',
        }
    }

    private getRunKey(generationRun: MediaGenerationRunMeta | undefined): string {
        return generationRun?.reasoningRunId || this.config.aiChatThreadId
    }

    private buildMessageId(kind: string, subjectSeq: number): string {
        return `pm-ai-${this.streamId}-${kind}-${subjectSeq}`
    }

    private createEmptyThreadDoc(): object {
        return {
            type: 'doc',
            content: [
                {
                    type: aiChatThreadNodeType,
                    attrs: {
                        threadId: this.config.aiChatThreadId,
                        status: 'active',
                    },
                },
            ],
        }
    }
}
