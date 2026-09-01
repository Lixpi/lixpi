import {
    type AiInteractionMediaGenerationRequest,
    type Asset,
} from '@lixpi/constants'
import {
    buildCanvasConversationContent,
    contentJSONHasPromptReference,
    extractPromptTextFromContentJSON,
    getPromptReferenceCanvasNodeIds,
    type AiPromptComposerSubmitData,
} from '../composer/canvas-conversation-content.ts'

export type CanvasGenerationSubmitOptions = {
    explicitContextNodeIds?: string[]
    excludedCanvasNodeIds?: string[]
    regeneration?: NonNullable<AiInteractionMediaGenerationRequest['regeneration']>
}

export type CanvasGenerationSubmissionScope = {
    workspaceId: string
    organizationId: string
    sceneKey: string
    contextNodeIds: string[]
}

export type CanvasConversationRecord = {
    threadId: string
    assetId: string
    organizationId: string
    revision: number
    workspaceId: string
    content: object
    proseMirrorVersion: number
    aiModel: string
    title: string
    status: Asset['states']['conversation']
    createdAt: number
    updatedAt: number
}

export type CanvasGenerationSubmissionPorts = {
    readScope: () => CanvasGenerationSubmissionScope | null
    createId: () => string
    now: () => number
    createConversation: (request: {
        workspaceId: string
        organizationId: string
        assetId: string
        title: string
        initialDoc: object
    }) => Promise<Asset>
    activate: (threadId: string) => void
    cancel: (threadId: string) => void
    install: (request: {
        thread: CanvasConversationRecord
        submittedData: AiPromptComposerSubmitData
        explicitContextNodeIds: string[]
        excludedCanvasNodeIds?: string[]
        regeneration?: CanvasGenerationSubmitOptions['regeneration']
    }) => void
    reportError: (error: unknown) => void
}

type Submission = { threadId: string; epoch: number; cancelled: boolean }

export class CanvasGenerationSubmission {
    private readonly pending = new Set<Submission>()
    private epoch = 0
    private destroyed = false

    constructor(private readonly ports: CanvasGenerationSubmissionPorts) {}

    async submit(data: AiPromptComposerSubmitData, options: CanvasGenerationSubmitOptions = {}): Promise<void> {
        if (this.destroyed) return
        if (!data.aiReasoningModels[0]) {
            this.ports.reportError(new Error('Cannot submit generation without a reasoning model.'))
            return
        }
        const promptText = extractPromptTextFromContentJSON(data.contentJSON)
        if (!promptText && !contentJSONHasPromptReference(data.contentJSON)) return
        const currentScope = this.ports.readScope()
        if (!currentScope) return
        const scope = structuredClone(currentScope)
        const submittedData = structuredClone(data)
        const submittedOptions = structuredClone(options)
        const threadId = this.ports.createId()
        const submission: Submission = { threadId, epoch: this.epoch, cancelled: false }
        const explicitContextNodeIds = Array.from(
            new Set([
                ...(submittedOptions.explicitContextNodeIds ?? scope.contextNodeIds),
                ...getPromptReferenceCanvasNodeIds(submittedData.contentJSON),
            ]),
        )
        const initialContent = buildCanvasConversationContent(submittedData, {
            threadId,
            messageId: `msg-${this.ports.createId()}`,
            createdAt: this.ports.now(),
            referenceNodeIds: explicitContextNodeIds,
        })
        this.pending.add(submission)
        try {
            this.ports.activate(threadId)
            if (!this.isCurrent(submission, scope)) {
                this.cancel(submission)
                return
            }
            const asset = await this.ports.createConversation({
                organizationId: scope.organizationId,
                workspaceId: scope.workspaceId,
                assetId: threadId,
                title: promptText || 'Capability request',
                initialDoc: initialContent,
            })
            if (!this.isCurrent(submission, scope)) {
                this.cancel(submission)
                return
            }
            if (asset.assetId !== threadId) throw new Error('Created conversation does not match the submitted Asset identity')
            this.ports.install({
                thread: {
                    threadId: asset.assetId,
                    assetId: asset.assetId,
                    organizationId: asset.organizationId,
                    revision: asset.revision,
                    workspaceId: scope.workspaceId,
                    content: initialContent,
                    proseMirrorVersion: asset.documents.conversation?.version ?? 0,
                    aiModel: submittedData.aiReasoningModels[0] ?? '',
                    title: asset.title,
                    status: asset.states.conversation,
                    createdAt: asset.createdAt,
                    updatedAt: asset.updatedAt,
                },
                submittedData,
                explicitContextNodeIds,
                excludedCanvasNodeIds: submittedOptions.excludedCanvasNodeIds,
                regeneration: submittedOptions.regeneration,
            })
        } catch (error) {
            try {
                this.cancel(submission)
            } finally {
                this.ports.reportError(error)
            }
        } finally {
            this.pending.delete(submission)
        }
    }

    clear(): void {
        this.epoch += 1
        const pending = [...this.pending]
        this.pending.clear()
        const errors: unknown[] = []
        for (const submission of pending) {
            try {
                this.cancel(submission)
            } catch (error) {
                errors.push(error)
            }
        }
        if (errors.length > 0) throw new AggregateError(errors, 'Canvas submission cleanup failed')
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        this.clear()
    }

    private cancel(submission: Submission): void {
        if (submission.cancelled) return
        submission.cancelled = true
        this.ports.cancel(submission.threadId)
    }

    private isCurrent(submission: Submission, scope: CanvasGenerationSubmissionScope): boolean {
        if (this.destroyed || submission.cancelled || submission.epoch !== this.epoch) return false
        const current = this.ports.readScope()
        return current?.workspaceId === scope.workspaceId
            && current.organizationId === scope.organizationId
            && current.sceneKey === scope.sceneKey
    }
}
