import type {
    Asset,
    CanvasNode,
    CanvasState,
    CanvasGeometryUpdate,
    GeneratedOutputReviewRequest,
    GeneratedOutputReviewResponse,
    ImageCanvasNode,
    VideoCanvasNode,
    CapabilityArtifactCanvasNode,
    AiModelId,
    ImageGenerationTrace,
    VideoGenerationTrace,
} from '@lixpi/constants'
import type { CapabilityReplaySubmitData } from '@lixpi/capability-system/frontend'
import type { AiPromptComposerSubmitData } from '../composer/index.ts'
import type { CanvasGenerationSubmitOptions } from '../../shared/generation/canvas-generation-submission.ts'
import {
    isGeneratedOutputAcceptedForCanvas,
    isGeneratedOutputReadyForReview,
    getGeneratedMediaModelId,
    type GeneratedOutputCanvasNode,
} from '../../shared/index.ts'

export type GeneratedOutputRegenerationRequest = {
    scope: 'output-node'
    mode: 'existing-prompt'
    targetNodeId: string
    outputNodes: GeneratedOutputCanvasNode[]
} | {
    scope: 'branch-lineage'
    mode: 'existing-prompt' | 'regenerate-prompt'
    targetNodeId: string
    outputNodes: GeneratedOutputCanvasNode[]
}

type GeneratedMediaReplayDescriptor = {
    kind: 'media'
    node: ImageCanvasNode | VideoCanvasNode
    reasoningModelId: AiModelId
    mediaModelId: AiModelId
    mediaType: 'image' | 'video'
    finalPrompt: string
    imageSize?: string
    videoAspectRatio?: string
    videoResolution?: string
    videoDuration?: string
}

type GeneratedArtifactReplayDescriptor = {
    kind: 'artifact'
    node: CapabilityArtifactCanvasNode
    reasoningModelId: AiModelId
    capabilityInputs: CapabilityReplaySubmitData['capabilityInputs']
}

type GeneratedOutputReplayDescriptor = GeneratedMediaReplayDescriptor | GeneratedArtifactReplayDescriptor

type ReviewScope = { workspaceId: string; sceneKey: string; revision: number }

export type WorkspaceOutputReviewPorts = {
    readScope: () => { workspaceId: string; sceneKey: string }
    readCanvasState: () => CanvasState | null
    readAsset: (assetId: string) => Asset | undefined
    readProvenance: (assetId: string) => unknown
    readMediaHistory: (node: ImageCanvasNode | VideoCanvasNode) => unknown
    readArtifactReplay: (node: CapabilityArtifactCanvasNode) => CapabilityReplaySubmitData
    readPrompt: (node: GeneratedOutputCanvasNode) => string
    findNode: (nodeId: string) => CanvasNode | undefined
    review: (request: GeneratedOutputReviewRequest) => Promise<GeneratedOutputReviewResponse | { error: string }>
    refreshAsset: (assetId: string, workspaceId: string) => Promise<{ error?: string }>
    applyGeometry: (geometry: CanvasGeometryUpdate) => void
    removeContextChips: (nodeIds: string[]) => void
    refreshChrome: () => void
    refreshMarkers: () => void
    submit: (data: AiPromptComposerSubmitData, options: CanvasGenerationSubmitOptions) => Promise<void>
    reportError: (message: string, detail: unknown) => void
}

function uniqueAiModelIds(modelIds: Array<string | undefined>): AiModelId[] {
    const seen = new Set<string>()
    const unique: AiModelId[] = []
    for (const modelId of modelIds) {
        const trimmed = modelId?.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        unique.push(trimmed as AiModelId)
    }
    return unique
}

export class WorkspaceOutputReview {
    private revision = 0
    private disposed = false

    constructor(private readonly ports: WorkspaceOutputReviewPorts) {}

    clear(): void {
        this.revision += 1
    }

    destroy(): void {
        this.disposed = true
        this.clear()
    }

    private capture(): ReviewScope | null {
        if (this.disposed) return null
        return { ...this.ports.readScope(), revision: this.revision }
    }

    private isCurrent(scope: ReviewScope): boolean {
        const current = this.ports.readScope()
        return !this.disposed && scope.revision === this.revision
            && scope.workspaceId === current.workspaceId && scope.sceneKey === current.sceneKey
    }

    private admitReviewResponse(scope: ReviewScope, response: GeneratedOutputReviewResponse): boolean {
        if (!this.isCurrent(scope)) return false
        if (response.workspaceId === scope.workspaceId) return true
        this.ports.reportError('Generated output review response belongs to another workspace', response.workspaceId)
        return false
    }

    private applyReviewGeometry(scope: ReviewScope, geometry: CanvasGeometryUpdate, pruneChips: boolean): void {
        if (!this.isCurrent(scope)) return
        this.ports.applyGeometry(geometry)
        if (!this.isCurrent(scope)) return
        if (pruneChips) this.ports.removeContextChips(geometry.removedNodeIds ?? [])
        if (!this.isCurrent(scope)) return
        this.ports.refreshChrome()
        if (this.isCurrent(scope)) this.ports.refreshMarkers()
    }

    isGeneratedOutputAccepted(node: GeneratedOutputCanvasNode): boolean {
        return isGeneratedOutputAcceptedForCanvas({
            node,
            asset: this.ports.readAsset(node.assetId),
            nodes: this.ports.readCanvasState()?.nodes ?? [],
            edges: this.ports.readCanvasState()?.edges ?? [],
        })
    }

    // Single readiness rule for every generated output kind. Artifacts publish
    // their payload as a capability document, media publishes an original
    // rendition; both additionally require a sealed provenance history. The
    // terminal media projection is an API-authored compatibility signal while
    // the browser's Asset cache catches up: the review endpoint remains the
    // authority and validates the persisted Asset before changing anything.
    isGeneratedOutputReviewReady(node: GeneratedOutputCanvasNode): boolean {
        return isGeneratedOutputReadyForReview(node, this.ports.readAsset(node.assetId))
    }

    async acceptGeneratedOutput(scope: 'output-node' | 'branch-lineage', nodeId: string): Promise<void> {
        const scopeSnapshot = this.capture()
        if (!scopeSnapshot) return
        const result = await this.ports.review({
            workspaceId: scopeSnapshot.workspaceId,
            scope,
            action: 'accept',
            nodeId,
        })
        if ('error' in result) {
            this.ports.reportError('[CANVAS][generated-output-review] Unable to accept generated output:', result.error)
            return
        }
        if (!this.admitReviewResponse(scopeSnapshot, result)) return
        this.applyReviewGeometry(scopeSnapshot, result.canvasGeometry, true)
    }

    async rejectGeneratedOutput(
        scope: 'output-node' | 'branch-lineage',
        nodeId: string,
    ): Promise<'applied' | 'not-found' | 'failed'> {
        const scopeSnapshot = this.capture()
        if (!scopeSnapshot) return 'failed'
        const result = await this.ports.review({
            workspaceId: scopeSnapshot.workspaceId,
            scope,
            action: 'reject',
            nodeId,
        })
        if ('error' in result) {
            if (result.error === 'GENERATED_OUTPUT_NOT_FOUND') return 'not-found'
            this.ports.reportError('[CANVAS][generated-output-review] Unable to reject generated output:', result.error)
            return 'failed'
        }
        if (!this.admitReviewResponse(scopeSnapshot, result)) return 'failed'
        this.applyReviewGeometry(scopeSnapshot, result.canvasGeometry, true)
        return 'applied'
    }

    getGeneratedMediaTrace(
        node: ImageCanvasNode | VideoCanvasNode,
    ): ImageGenerationTrace | VideoGenerationTrace | null {
        const generatedBy = node.generatedBy
        if (!generatedBy) return null
        const content = this.ports.readMediaHistory(node)
        const usesSealedProvenance = Boolean(this.ports.readProvenance(node.assetId))
        const traces: Array<ImageGenerationTrace | VideoGenerationTrace> = []
        const visit = (value: unknown): void => {
            if (!value || typeof value !== 'object') return
            const record = value as Record<string, unknown>
            const attrs = record.attrs
            if (attrs && typeof attrs === 'object') {
                const attrRecord = attrs as Record<string, unknown>
                const imageTrace = attrRecord.imageGenerationTrace
                const videoTrace = attrRecord.videoGenerationTrace
                if (imageTrace && typeof imageTrace === 'object') traces.push(imageTrace as ImageGenerationTrace)
                if (videoTrace && typeof videoTrace === 'object') traces.push(videoTrace as VideoGenerationTrace)
            }
            if (Array.isArray(record.content)) record.content.forEach(visit)
        }
        visit(content)
        const matchesRun = (trace: ImageGenerationTrace | VideoGenerationTrace): boolean => {
            const run = trace.generationRun
            if (generatedBy.mediaRunId && run?.mediaRunId === generatedBy.mediaRunId) return true
            return Boolean(
                generatedBy.reasoningRunId
                    && run?.reasoningRunId === generatedBy.reasoningRunId
                    && generatedBy.mediaModelId
                    && run?.mediaModelId === generatedBy.mediaModelId,
            )
        }
        for (let index = traces.length - 1; index >= 0; index -= 1) {
            const trace = traces[index]
            if (trace && matchesRun(trace)) return trace
        }
        return usesSealedProvenance && traces.length === 1 ? traces[0]! : null
    }

    getGeneratedMediaReplayDescriptor(
        node: ImageCanvasNode | VideoCanvasNode,
    ): GeneratedMediaReplayDescriptor | null {
        const trace = this.getGeneratedMediaTrace(node)
        const reasoningModelId = node.generatedBy?.reasoningModelId
        const mediaModelId = node.generatedBy?.mediaModelId ?? getGeneratedMediaModelId(node)
        if (!trace?.finalPrompt || !reasoningModelId || !mediaModelId) return null
        if (trace.traceVersion === 'image-generation-trace-v1') {
            return {
                kind: 'media',
                node,
                reasoningModelId,
                mediaModelId: mediaModelId as AiModelId,
                mediaType: 'image',
                finalPrompt: trace.finalPrompt,
                imageSize: trace.imageSize,
            }
        }
        return {
            kind: 'media',
            node,
            reasoningModelId,
            mediaModelId: mediaModelId as AiModelId,
            mediaType: 'video',
            finalPrompt: trace.finalPrompt,
            videoAspectRatio: trace.aspectRatio,
            videoResolution: trace.resolution,
            videoDuration: String(trace.durationSeconds),
        }
    }

    getGeneratedArtifactReplayDescriptor(
        node: CapabilityArtifactCanvasNode,
    ): GeneratedArtifactReplayDescriptor | null {
        if (!node.generatedBy) return null
        const replay = this.ports.readArtifactReplay(node)
        const reasoningModelId = replay.reasoningModelIds[0]
        if (!reasoningModelId) return null
        return {
            kind: 'artifact',
            node,
            reasoningModelId: reasoningModelId as AiModelId,
            capabilityInputs: replay.capabilityInputs,
        }
    }

    // Single entry point that turns any generated output node into its replay
    // descriptor, so review controls never branch on the output kind.
    getGeneratedOutputReplayDescriptor(
        node: GeneratedOutputCanvasNode,
    ): GeneratedOutputReplayDescriptor | null {
        return node.type === 'capabilityArtifact'
            ? this.getGeneratedArtifactReplayDescriptor(node)
            : this.getGeneratedMediaReplayDescriptor(node)
    }

    buildRegenerationSubmitData(
        descriptors: GeneratedOutputReplayDescriptor[],
        promptText: string,
    ): AiPromptComposerSubmitData {
        const reasoningModels = uniqueAiModelIds(descriptors.map(descriptor => descriptor.reasoningModelId))
        const mediaDescriptors = descriptors
            .filter((descriptor): descriptor is GeneratedMediaReplayDescriptor => descriptor.kind === 'media')
        const capabilityInputs = descriptors.reduce<CapabilityReplaySubmitData['capabilityInputs']>(
            (merged, descriptor) =>
                descriptor.kind === 'artifact'
                    ? { ...merged, ...descriptor.capabilityInputs }
                    : merged,
            {},
        )
        const imageDescriptors = mediaDescriptors.filter(descriptor => descriptor.mediaType === 'image')
        const videoDescriptors = mediaDescriptors.filter(descriptor => descriptor.mediaType === 'video')
        const imageModels = uniqueAiModelIds(imageDescriptors.map(descriptor => descriptor.mediaModelId))
        const videoModels = uniqueAiModelIds(videoDescriptors.map(descriptor => descriptor.mediaModelId))
        const firstImage = imageDescriptors[0]
        const firstVideo = videoDescriptors[0]
        return {
            contentJSON: [{ type: 'paragraph', content: [{ type: 'text', text: promptText }] }],
            mediaGenerationMode: firstVideo && !firstImage ? 'video' : 'image',
            aiReasoningModels: reasoningModels,
            useMultipleReasoningModels: reasoningModels.length > 1,
            useMultipleImageModels: imageModels.length > 1,
            useMultipleVideoModels: videoModels.length > 1,
            capabilityInputs,
            ...(imageModels.length > 0
                ? {
                    imageOptions: {
                        aiImageModels: imageModels,
                        imageGenerationSize: firstImage?.imageSize ?? 'auto',
                        configGroups: imageModels.map((modelId, index) => {
                            const descriptor = imageDescriptors.find(candidate => candidate.mediaModelId === modelId)
                            return {
                                groupId: `regeneration-image-${index}`,
                                modelIds: [modelId],
                                values: { imageSize: descriptor?.imageSize ?? 'auto' },
                            }
                        }),
                    },
                }
                : {}),
            ...(videoModels.length > 0
                ? {
                    videoOptions: {
                        aiVideoModels: videoModels,
                        ...(firstVideo?.videoAspectRatio ? { videoAspectRatio: firstVideo.videoAspectRatio } : {}),
                        ...(firstVideo?.videoResolution ? { videoResolution: firstVideo.videoResolution } : {}),
                        ...(firstVideo?.videoDuration ? { videoDuration: firstVideo.videoDuration } : {}),
                        configGroups: videoModels.map((modelId, index) => {
                            const descriptor = videoDescriptors.find(candidate => candidate.mediaModelId === modelId)
                            return {
                                groupId: `regeneration-video-${index}`,
                                modelIds: [modelId],
                                values: {
                                    ...(descriptor?.videoAspectRatio ? { aspectRatio: descriptor.videoAspectRatio } : {}),
                                    ...(descriptor?.videoResolution ? { resolution: descriptor.videoResolution } : {}),
                                    ...(descriptor?.videoDuration ? { duration: descriptor.videoDuration } : {}),
                                },
                            }
                        }),
                    },
                }
                : {}),
        }
    }

    async regenerateGeneratedOutputs(request: GeneratedOutputRegenerationRequest): Promise<void> {
        const scopeSnapshot = this.capture()
        if (!scopeSnapshot) return
        request = structuredClone(request)
        const { scope, targetNodeId, outputNodes } = request
        const regeneratePrompt = request.mode === 'regenerate-prompt'
        if (scope === 'branch-lineage' && !regeneratePrompt && outputNodes.length > 1) {
            for (const outputNode of outputNodes) {
                if (!this.isCurrent(scopeSnapshot)) return
                await this.regenerateGeneratedOutputs({
                    scope: 'output-node',
                    mode: 'existing-prompt',
                    targetNodeId: outputNode.nodeId,
                    outputNodes: [outputNode],
                })
            }
            return
        }
        await Promise.all(outputNodes.map(async (node) => {
            if (this.ports.readProvenance(node.assetId)) return
            const result = await this.ports.refreshAsset(node.assetId, scopeSnapshot.workspaceId)
            if ('error' in result) {
                this.ports.reportError('[CANVAS][generated-output-review] Unable to load sealed provenance:', {
                    assetId: node.assetId,
                    error: result.error,
                })
            }
        }))
        if (!this.isCurrent(scopeSnapshot)) return
        const descriptors = outputNodes
            .map(node => this.getGeneratedOutputReplayDescriptor(node))
            .filter((descriptor): descriptor is GeneratedOutputReplayDescriptor => Boolean(descriptor))
        if (descriptors.length !== outputNodes.length) {
            this.ports.reportError('[CANVAS][generated-output-review] Generation history is not ready for regeneration.', {
                targetNodeId,
                outputNodeIds: outputNodes.map(node => node.nodeId),
                descriptorCount: descriptors.length,
            })
            return
        }
        const mediaDescriptors = descriptors
            .filter((descriptor): descriptor is GeneratedMediaReplayDescriptor => descriptor.kind === 'media')
        const promptText = this.ports.readPrompt(outputNodes[0]!)
        if (!promptText) return
        const lineageParentNodeId = scope === 'branch-lineage'
            ? targetNodeId
            : outputNodes[0]?.generatedBy?.lineageParentNodeId
                ?? outputNodes[0]?.generatedBy?.branchLineNodeId
                ?? outputNodes[0]?.generatedBy?.branchForkNodeId
                ?? outputNodes[0]?.generatedBy?.branchOriginNodeId
        const branchId = outputNodes[0]?.generatedBy?.branchId
        const lineageParentNode = lineageParentNodeId ? this.ports.findNode(lineageParentNodeId) : undefined
        const lineageParentType = lineageParentNode
                && ['branchOrigin', 'branchFork', 'branchLine'].includes(lineageParentNode.type)
            ? lineageParentNode.type as 'branchOrigin' | 'branchFork' | 'branchLine'
            : undefined
        // Replaying an existing prompt needs a media trace to pin the branch to.
        // Artifact-only branches carry no media trace, so they re-run from their
        // sealed capability inputs with the lineage preserved by the supersede call.
        const replaysExistingPrompt = !regeneratePrompt && mediaDescriptors.length > 0
        const sourceMediaNode = replaysExistingPrompt && mediaDescriptors.length === 1
            ? mediaDescriptors[0]!.node
            : undefined
        if (replaysExistingPrompt && (!lineageParentNodeId || !lineageParentType || !branchId)) {
            this.ports.reportError('[CANVAS][generated-output-review] Branch lineage is unavailable.', {
                targetNodeId,
                lineageParentNodeId,
                lineageParentType,
                branchId,
            })
            return
        }
        // Reference and context node IDs are media-generation inputs; artifacts
        // carry their own inputs inside capabilityInputs instead.
        const explicitContextNodeIds = [
            ...new Set(mediaDescriptors.flatMap(descriptor => [
                ...(descriptor.node.generatedBy?.referenceImageNodeIds ?? []),
                ...(descriptor.node.generatedBy?.sourceContextNodeIds ?? []),
            ])),
        ]
        const excludedCanvasNodeIds = [
            ...outputNodes.map(node => node.nodeId),
            ...(regeneratePrompt ? [targetNodeId] : []),
        ]
        if (!sourceMediaNode) {
            const result = request.scope === 'output-node'
                ? await this.ports.review({
                    workspaceId: scopeSnapshot.workspaceId,
                    scope: 'output-node',
                    action: 'supersede',
                    nodeId: targetNodeId,
                    preserveLineage: true,
                })
                : await this.ports.review({
                    workspaceId: scopeSnapshot.workspaceId,
                    scope: 'branch-lineage',
                    action: 'supersede',
                    nodeId: targetNodeId,
                    preserveLineage: request.mode === 'existing-prompt',
                })
            if ('error' in result) {
                this.ports.reportError('[CANVAS][generated-output-review] Unable to supersede generated output:', result.error)
                return
            }
            if (!this.admitReviewResponse(scopeSnapshot, result)) return
            this.applyReviewGeometry(scopeSnapshot, result.canvasGeometry, false)
        }
        if (!this.isCurrent(scopeSnapshot)) return
        const submitData = this.buildRegenerationSubmitData(descriptors, promptText)
        await this.ports.submit(submitData, {
            explicitContextNodeIds,
            excludedCanvasNodeIds,
            ...(regeneratePrompt
                ? {
                    regeneration: {
                        mode: 'regenerate-prompt',
                        forceFreshLineage: true,
                    } as const,
                }
                : replaysExistingPrompt && lineageParentNodeId && lineageParentType && branchId
                ? {
                    regeneration: {
                        mode: 'existing-prompt',
                        branchId,
                        lineageParentNodeId,
                        lineageParentType,
                        ...(sourceMediaNode ? { sourceNodeId: sourceMediaNode.nodeId } : {}),
                        replayPrompts: mediaDescriptors.map(descriptor => ({
                            sourceAssetId: descriptor.node.assetId,
                            reasoningModelId: descriptor.reasoningModelId,
                            mediaModelId: descriptor.mediaModelId,
                            mediaType: descriptor.mediaType,
                            finalPrompt: descriptor.finalPrompt,
                        })),
                    },
                }
                : {}),
        })
    }
}
