import {
    type CanvasNode,
    type CanvasGeneratedOutputDetailsTarget,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type CapabilityArtifactCanvasNode,
    type BranchOriginCanvasNode,
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
    type MediaGenerationProgressState,
} from '@lixpi/constants'
import {
    type AiLineageProjectionScope,
} from '@lixpi/prosemirror'
import {
    buildBranchMarkerTurnProjectionFromThreadContent,
    buildGeneratedMediaTurnProjectionFromThreadContent,
    getGeneratedMediaProgressFromThreadContent,
    type GeneratedMediaTurnLocator,
} from '@lixpi/prosemirror/shared/generated-media-turn-projection'
import {
    parseProseMirrorJsonContent,
    findAiChatThreadContentNode,
    getBranchMarkerConversationPreviewFromThreadContent,
    type BranchMarkerConversationPreview,
    type BranchMarkerTurnDescriptor,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'
import {
    type GeneratedOutputCanvasNode,
} from '../canvas-node/generated-media-node.ts'
import {
    getBranchMarkerPromptParts,
    getBranchMarkerPromptDisplayText,
    type BranchMarkerPromptPart,
} from '../branch-tree-layout/marker-prompt-parts.ts'
import { settleReadyMediaGenerationProgress } from '../generation/progress-state.ts'

type BranchMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode
type MediaNode = ImageCanvasNode | VideoCanvasNode
export type WorkspaceMediaHistoryTarget = {
    node: MediaNode
    lineageProjectionScope: AiLineageProjectionScope
    limitProjectionToSelectedMedia: boolean
}
export type WorkspaceBranchHistoryTarget = {
    marker: BranchMarkerNode
    lineageProjectionScope: AiLineageProjectionScope
}
type GeneratedMediaProjectionTarget = WorkspaceMediaHistoryTarget
type BranchMarkerProjectionTarget = WorkspaceBranchHistoryTarget
export type WorkspaceHistoryPorts = {
    getNodes: () => readonly CanvasNode[]
    getThreadContent: (threadId: string) => unknown
    getProvenanceContent: (assetId: string) => unknown
    isBranchActive: (node: BranchMarkerNode) => boolean
    isBranchGroupActive: (node: BranchMarkerNode) => boolean
    isBranchCancelled: (node: BranchMarkerNode) => boolean
}

const isBranchMarkerNode = (node: CanvasNode): node is BranchMarkerNode =>
    node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

export const getGeneratedMediaProjectionLocator = (node: MediaNode): GeneratedMediaTurnLocator | null => {
    const generatedBy = node.generatedBy

    if (!generatedBy)
        return null

    return {
        responseMessageId: generatedBy.responseMessageId,
        reasoningRunId: generatedBy.reasoningRunId,
        reasoningModelId: generatedBy.reasoningModelId,
        mediaRunId: generatedBy.mediaRunId,
        mediaType: generatedBy.mediaType ?? node.type,
        assetId: node.assetId,
        variantIndex: generatedBy.variantIndex ?? null,
    }
}

export const compareGeneratedMediaByGenerationOrder = (
    a: ImageCanvasNode | VideoCanvasNode | CapabilityArtifactCanvasNode,
    b: ImageCanvasNode | VideoCanvasNode | CapabilityArtifactCanvasNode,
): number => {
    const aVariant = a.generatedBy?.variantIndex ?? Number.MAX_SAFE_INTEGER
    const bVariant = b.generatedBy?.variantIndex ?? Number.MAX_SAFE_INTEGER

    if (aVariant !== bVariant)
        return aVariant - bVariant

    return ((a.generatedBy as { createdAt?: number } | undefined)?.createdAt ?? 0) - ((b.generatedBy as { createdAt?: number } | undefined)?.createdAt ?? 0)
}

export const countProseMirrorNodesByType = (
    value: unknown,
    nodeTypes: Set<string>,
): number => {
    if (
        !value
        || typeof value !== 'object'
    )
        return 0

    const candidate = value as {
        type?: unknown
        content?: unknown
    }
    const ownCount = typeof candidate.type === 'string'
        && nodeTypes.has(candidate.type)
        ? 1
        : 0

    if (!Array.isArray(candidate.content))
        return ownCount

    let childCount = 0

    for (const child of candidate.content) {
        childCount += countProseMirrorNodesByType(child, nodeTypes)
    }

    return ownCount + childCount
}

export const getBranchMarkerThreadId = (node: BranchMarkerNode): string => node.conversationAssetId ?? ''

export const parseBranchMarkerReasoningIndex = (value: unknown): number | null => {
    if (
        value === null
        || value === undefined
        || value === ''
    )
        return null

    const parsed = Number(value)

    return Number.isFinite(parsed) ? parsed : null
}

export const getBranchMarkerReasoningModelId = (node: BranchMarkerNode): string => {
    if (node.type === 'branchOrigin')
        return node.pendingState?.reasoningModelId ?? ''

    const runNode = node as BranchForkCanvasNode | BranchLineCanvasNode

    return node.pendingState?.reasoningModelId
        ?? runNode.reasoningModelId
        ?? runNode.provenance?.reasoningModelId
        ?? ''
}

export const getBranchMarkerReasoningIndex = (node: BranchMarkerNode): number | null => {
    if (node.type === 'branchOrigin')
        return parseBranchMarkerReasoningIndex(node.pendingState?.reasoningIndex)

    const runNode = node as BranchForkCanvasNode | BranchLineCanvasNode

    return parseBranchMarkerReasoningIndex(node.pendingState?.reasoningIndex ?? runNode.reasoningIndex)
}

export const getBranchMarkerTurnDescriptor = (node: BranchMarkerNode): BranchMarkerTurnDescriptor => {
    const reasoningRunId = node.type === 'branchOrigin'
        ? ''
        : (node as BranchForkCanvasNode | BranchLineCanvasNode).reasoningRunId ?? ''
    const markerNodeAttr = node.type === 'branchOrigin'
        ? 'branchOriginNodeId' as const
        : node.type === 'branchFork'
            ? 'branchForkNodeId' as const
            : 'branchLineNodeId' as const
    // 'canvas-' ids are synthetic client placeholders, never present in the doc.
    const generationRequestId = node.generationRequestId
        && !node.generationRequestId.startsWith('canvas-')
        ? node.generationRequestId
        : undefined

    return {
        ...(generationRequestId ? { generationRequestId } : {}),
        ...(reasoningRunId ? { reasoningRunId } : {}),
        ...(getBranchMarkerReasoningModelId(node) ? { reasoningModelId: getBranchMarkerReasoningModelId(node) } : {}),
        reasoningIndex: getBranchMarkerReasoningIndex(node),
        markerNodeId: node.nodeId,
        markerNodeAttr,
    }
}

export const getCapabilityArtifactTurnProjectionLocator = (node: CapabilityArtifactCanvasNode): {
    threadId: string
    descriptor: BranchMarkerTurnDescriptor
    lineageProjectionScope: AiLineageProjectionScope
} | null => {
    const generatedBy = node.generatedBy

    if (!generatedBy?.conversationAssetId)
        return null

    const candidates: Array<{
        nodeId: string | undefined
        markerNodeAttr: NonNullable<BranchMarkerTurnDescriptor['markerNodeAttr']>
        lineageProjectionScope: AiLineageProjectionScope
    }> = [
        {
            nodeId: generatedBy.branchLineNodeId,
            markerNodeAttr: 'branchLineNodeId',
            lineageProjectionScope: 'media-run',
        },
        {
            nodeId: generatedBy.branchForkNodeId,
            markerNodeAttr: 'branchForkNodeId',
            lineageProjectionScope: 'branch-fork',
        },
        {
            nodeId: generatedBy.branchOriginNodeId,
            markerNodeAttr: 'branchOriginNodeId',
            lineageProjectionScope: 'branch-origin',
        },
    ]
    const marker = candidates.find(candidate => candidate.nodeId)

    return {
        threadId: generatedBy.conversationAssetId,
        descriptor: {
            generationRequestId: generatedBy.generationRequestId,
            reasoningRunId: generatedBy.reasoningRunId,
            reasoningModelId: generatedBy.reasoningModelId,
            reasoningIndex: generatedBy.reasoningIndex ?? null,
            ...(marker?.nodeId
                ? {
                    markerNodeId: marker.nodeId,
                    markerNodeAttr: marker.markerNodeAttr,
                }
                : {}),
        },
        lineageProjectionScope: marker?.lineageProjectionScope ?? 'media-run',
    }
}

// Reads supplied snapshots without changing generation or persistence authority.
export class WorkspaceHistory {
    constructor(private readonly ports: WorkspaceHistoryPorts) {}

    getMediaGenerationTraceState(node: ImageCanvasNode | VideoCanvasNode): MediaGenerationProgressState | null {
        const persistedState = node.generationProgress ?? (() => {
            const locator = getGeneratedMediaProjectionLocator(node)

            if (!locator)
                return null

            return getGeneratedMediaProgressFromThreadContent(
                this.getGeneratedMediaHistoryContent(node),
                locator,
            )
        })()

        return persistedState
            ? settleReadyMediaGenerationProgress(persistedState, node.mediaGenerationPhase)
            : null
    }

    buildBranchMarkerTurnProjectionContent(
        marker: BranchMarkerNode,
        lineageProjectionScope: AiLineageProjectionScope,
    ): {
        threadId: string
        content: ProseMirrorJsonNode
    } | null {
        const threadId = getBranchMarkerThreadId(marker)

        if (!threadId)
            return null

        const projection = buildBranchMarkerTurnProjectionFromThreadContent(
            this.getAiChatThreadContentForBranchMarker(threadId),
            getBranchMarkerTurnDescriptor(marker),
            {
                threadId,
                forceGenerationDetailsOpen: true,
                lineageProjectionScope,
                allowLatestTurnFallback: this.canUseLatestBranchMarkerTurnFallback(marker),
            },
        )

        if (!projection)
            return null

        return {
            threadId: projection.threadId,
            content: projection.content,
        }
    }

    getBranchOriginGeneratedMediaNodes(branchOriginNodeId: string): Array<ImageCanvasNode | VideoCanvasNode> {
        return this.ports.getNodes().filter(
            (node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode =>
                    (node.type === 'image' || node.type === 'video')
                    && node.generatedBy?.branchOriginNodeId === branchOriginNodeId,
        )
            .sort(compareGeneratedMediaByGenerationOrder)
    }

    getBranchForkGeneratedMediaNodes(branchForkNodeId: string): Array<ImageCanvasNode | VideoCanvasNode> {
        return this.ports.getNodes().filter(
            (node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode =>
                    (node.type === 'image' || node.type === 'video')
                    && node.generatedBy?.branchForkNodeId === branchForkNodeId,
        )
            .sort(compareGeneratedMediaByGenerationOrder)
    }

    getBranchLineGeneratedMediaNodes(branchLineNodeId: string): Array<ImageCanvasNode | VideoCanvasNode> {
        return this.ports.getNodes().filter(
            (node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode =>
                    (node.type === 'image' || node.type === 'video')
                    && node.generatedBy?.branchLineNodeId === branchLineNodeId,
        )
            .sort(compareGeneratedMediaByGenerationOrder)
    }

    getBranchGeneratedArtifactNodes(
        field: 'branchOriginNodeId' | 'branchForkNodeId' | 'branchLineNodeId',
        nodeId: string,
    ): CapabilityArtifactCanvasNode[] {
        return this.ports.getNodes().filter(
            (node: CanvasNode): node is CapabilityArtifactCanvasNode => (
                    node.type === 'capabilityArtifact' && node.generatedBy?.[field] === nodeId
                ),
        )
            .sort(compareGeneratedMediaByGenerationOrder)
    }

    getGeneratedOutputUserMessageParts(node: GeneratedOutputCanvasNode): BranchMarkerPromptPart[] {
        if (node.type === 'capabilityArtifact') {
            const generatedBy = node.generatedBy

            if (!generatedBy)
                return []

            const projection = this.buildCapabilityArtifactTurnProjectionContent(node)
            const root = parseProseMirrorJsonContent(projection?.content)
            const thread = root ? findAiChatThreadContentNode(root, generatedBy.conversationAssetId) : null
            const userMessage = thread?.content?.find(child => child.type === 'aiUserMessage')
            const inputPrompt = typeof generatedBy.input.prompt === 'string'
                ? generatedBy.input.prompt.trim()
                : ''

            return getBranchMarkerPromptParts(userMessage, generatedBy.promptText?.trim() || inputPrompt)
        }

        const generatedBy = node.generatedBy

        if (!generatedBy)
            return []

        const locator = getGeneratedMediaProjectionLocator(node)
        const projection = locator
            ? buildGeneratedMediaTurnProjectionFromThreadContent(
                this.getGeneratedMediaHistoryContent(node),
                locator,
                {
                    threadId: generatedBy.conversationAssetId,
                    limitToLocatorMedia: true,
                    lineageProjectionScope: 'media-run',
                },
            )
            : null
        const root = parseProseMirrorJsonContent(projection?.content)
        const thread = root ? findAiChatThreadContentNode(root, generatedBy.conversationAssetId) : null
        const userMessage = thread?.content?.find(child => child.type === 'aiUserMessage')

        return getBranchMarkerPromptParts(userMessage, generatedBy.promptText?.trim() || '')
    }

    getGeneratedOutputUserMessageText(node: GeneratedOutputCanvasNode): string {
        return getBranchMarkerPromptDisplayText(
            this.getGeneratedOutputUserMessageParts(node),
        ).trim()
    }

    buildCapabilityArtifactTurnProjectionContent(node: CapabilityArtifactCanvasNode): {
        threadId: string
        content: ProseMirrorJsonNode
        lineageProjectionScope: AiLineageProjectionScope
    } | null {
        const locator = getCapabilityArtifactTurnProjectionLocator(node)

        if (!locator)
            return null

        const projection = buildBranchMarkerTurnProjectionFromThreadContent(
            this.ports.getThreadContent(locator.threadId),
            locator.descriptor,
            {
                threadId: locator.threadId,
                forceGenerationDetailsOpen: true,
                lineageProjectionScope: locator.lineageProjectionScope,
                allowLatestTurnFallback: false,
            },
        )

        return projection ? {
            ...projection,
            lineageProjectionScope: locator.lineageProjectionScope,
        } : null
    }

    getBranchMarkerMediaProjectionTarget(marker: BranchMarkerNode): GeneratedMediaProjectionTarget | null {
        if (marker.type === 'branchOrigin') {
            const node = this.getBranchOriginGeneratedMediaNodes(marker.nodeId)[0]

            return node
                ? {
                    node,
                    lineageProjectionScope: 'branch-origin',
                    limitProjectionToSelectedMedia: false,
                }
                : null
        }

        if (marker.type === 'branchFork') {
            const node = this.getBranchForkGeneratedMediaNodes(marker.nodeId)[0]

            return node
                ? {
                    node,
                    lineageProjectionScope: 'branch-fork',
                    limitProjectionToSelectedMedia: false,
                }
                : null
        }

        const node = this.getBranchLineGeneratedMediaNodes(marker.nodeId)[0]

        return node
            ? {
                node,
                lineageProjectionScope: 'media-run',
                limitProjectionToSelectedMedia: true,
            }
            : null
    }

    getMediaNodeBranchMarkerProjectionTarget(node: ImageCanvasNode | VideoCanvasNode): BranchMarkerProjectionTarget | null {
        const lineage = node.generatedBy ?? node.generationProgress?.lineageAssignment

        if (!lineage)
            return null

        const candidates: Array<{
            nodeId: string | undefined
            type: BranchMarkerNode['type']
            lineageProjectionScope: AiLineageProjectionScope
        }> = [
            {
                nodeId: lineage.branchLineNodeId,
                type: 'branchLine',
                lineageProjectionScope: 'media-run',
            },
            {
                nodeId: lineage.branchForkNodeId,
                type: 'branchFork',
                lineageProjectionScope: 'branch-fork',
            },
            {
                nodeId: lineage.branchOriginNodeId,
                type: 'branchOrigin',
                lineageProjectionScope: 'branch-origin',
            },
        ]

        for (const candidate of candidates) {
            if (!candidate.nodeId)
                continue

            const marker = this.ports.getNodes().find(canvasNode => canvasNode.nodeId === candidate.nodeId)

            if (
                !marker
                || !isBranchMarkerNode(marker)
                || marker.type !== candidate.type
            )
                continue

            return {
                marker,
                lineageProjectionScope: candidate.lineageProjectionScope,
            }
        }

        return null
    }

    resolveGeneratedOutputDetailsNode(target: CanvasGeneratedOutputDetailsTarget | undefined): GeneratedOutputCanvasNode | BranchMarkerNode | null {
        if (!target)
            return null

        const node = this.ports.getNodes().find(candidate => candidate.nodeId === target.nodeId)

        if (!node)
            return null

        if (target.kind === 'branch-marker')
            return isBranchMarkerNode(node) ? node : null

        return node.type === 'image'
            || node.type === 'video'
            || node.type === 'capabilityArtifact'
            ? node
            : null
    }

    getGeneratedMediaHistoryContent(node: ImageCanvasNode | VideoCanvasNode): unknown {
        // Sealed provenance is the immutable history for candidates as well as
        // accepted outputs. Replay controls are enabled only after it exists, so
        // reading it here keeps the UI descriptor identical to the API source.
        const provenanceDocument = this.ports.getProvenanceContent(node.assetId)

        if (provenanceDocument)
            return provenanceDocument

        return this.ports.getThreadContent(node.generatedBy?.conversationAssetId ?? '')
    }

    getAiChatThreadContentForBranchMarker(threadId: string): unknown {
        return this.ports.getThreadContent(threadId)
    }

    canUseLatestBranchMarkerTurnFallback(
        node: BranchMarkerNode,
        content: unknown = this.getAiChatThreadContentForBranchMarker(getBranchMarkerThreadId(node) ?? ''),
    ): boolean {
        const userMessageCount = countProseMirrorNodesByType(
            content,
            new Set(['aiUserMessage']),
        )
        const responseMessageCount = countProseMirrorNodesByType(
            content,
            new Set(['aiResponseMessage']),
        )

        return this.ports.isBranchActive(node)
            || this.ports.isBranchGroupActive(node)
            || Boolean(node.pendingState)
            || this.getBranchMarkerGeneratedArtifactNodes(node).length > 0
            || (userMessageCount === 1 && responseMessageCount <= 1)
    }

    getBranchMarkerConversationPreview(node: BranchMarkerNode): BranchMarkerConversationPreview | null {
        const threadId = getBranchMarkerThreadId(node)

        if (!threadId)
            return null

        const preview = getBranchMarkerConversationPreviewFromThreadContent(
            this.getAiChatThreadContentForBranchMarker(threadId),
            threadId,
            getBranchMarkerTurnDescriptor(node),
            {
                generationActive: this.ports.isBranchActive(node),
                allowLatestTurnFallback: this.canUseLatestBranchMarkerTurnFallback(node),
            },
        )

        if (
            !preview
            || !this.ports.isBranchCancelled(node)
        )
            return preview

        return {
            ...preview,
            phase: 'done',
            isReceiving: false,
            streamIsReceiving: false,
        }
    }

    getBranchMarkerGeneratedMediaNodes(node: BranchMarkerNode): Array<ImageCanvasNode | VideoCanvasNode> {
        if (node.type === 'branchOrigin')
            return this.getBranchOriginGeneratedMediaNodes(node.nodeId)

        if (node.type === 'branchFork')
            return this.getBranchForkGeneratedMediaNodes(node.nodeId)

        return this.getBranchLineGeneratedMediaNodes(node.nodeId)
    }

    getBranchMarkerGeneratedArtifactNodes(node: BranchMarkerNode): CapabilityArtifactCanvasNode[] {
        if (node.type === 'branchOrigin')
            return this.getBranchGeneratedArtifactNodes('branchOriginNodeId', node.nodeId)

        if (node.type === 'branchFork')
            return this.getBranchGeneratedArtifactNodes('branchForkNodeId', node.nodeId)

        return this.getBranchGeneratedArtifactNodes('branchLineNodeId', node.nodeId)
    }

    getBranchMarkerGeneratedOutputNodes(node: BranchMarkerNode): GeneratedOutputCanvasNode[] {
        return [
            ...this.getBranchMarkerGeneratedMediaNodes(node),
            ...this.getBranchMarkerGeneratedArtifactNodes(node),
        ]
    }
}
