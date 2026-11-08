import {
    MAX_UPLOAD_FILE_SIZE,
    type AudioCanvasNode,
    type CanvasState,
    type DocumentCanvasNode,
    type DocumentMediaCanvasNode,
    type ImageCanvasNode,
    type MediaKind,
    type OperationStatusCanvasNode,
    type VideoCanvasNode,
} from '@lixpi/constants'

export type WorkspaceCanvasInsertionNode =
    | Omit<DocumentCanvasNode, 'position'>
    | Omit<DocumentMediaCanvasNode, 'position'>
    | Omit<ImageCanvasNode, 'position'>
    | Omit<VideoCanvasNode, 'position'>
    | Omit<AudioCanvasNode, 'position'>

export type CanvasIngestResult = {
    assetId: string
    kind: MediaKind
}
export type CanvasIngestReply = CanvasIngestResult | { error: string } | null
export type CanvasUploadRequest = {
    workspaceId: string
    onStart: () => boolean
}
export type WorkspaceCanvasActionScope = {
    workspaceId: string
    organizationId: string
    revision: number
}

export type WorkspaceCanvasActionsPorts = {
    readScope: () => WorkspaceCanvasActionScope | null
    createId: () => string
    now: () => number
    insertionWidth: number
    createDocument: (request: {
        workspaceId: string
        organizationId: string
        title: string
    }) => Promise<{ assetId: string }>
    uploadFile: (request: CanvasUploadRequest & { file: File }) => Promise<CanvasIngestReply>
    importUrl: (request: CanvasUploadRequest & { url: string }) => Promise<CanvasIngestReply>
    refreshAsset: (
        assetId: string,
        workspaceId: string,
    ) => Promise<{ error?: string }>
    attach: (
        workspaceId: string,
        request: {
            assetId: string
            nodeId: string
            prepare: () => CanvasState
        },
    ) => Promise<CanvasState>
    insertPlaceholder: (node: Omit<OperationStatusCanvasNode, 'position'>) => void
    failPlaceholder: (
        nodeId: string,
        message: string,
    ) => void
    prepareInsertion: (
        node: WorkspaceCanvasInsertionNode,
        placeholderNodeId?: string,
    ) => CanvasState
    commitDocument: (state: CanvasState) => void
    commitMedia: (
        state: CanvasState,
        nodeId: string,
        placeholderNodeId?: string,
    ) => void
    closeUploadMenu: () => void
    reportError: (
        message: string,
        error: unknown,
    ) => void
}

type Action = {
    scope: WorkspaceCanvasActionScope
    revision: number
}

export class WorkspaceCanvasActions {
    private revision = 0
    private disposed = false

    constructor(private readonly ports: WorkspaceCanvasActionsPorts) {}

    clear(): void {
        this.revision += 1
    }

    destroy(): void {
        this.disposed = true
        this.clear()
    }

    async createDocument(): Promise<void> {
        const action = this.capture()

        if (!action)
            return

        try {
            const document = await this.ports.createDocument({
                workspaceId: action.scope.workspaceId,
                organizationId: action.scope.organizationId,
                title: 'New Document',
            })

            if (!this.isCurrent(action))
                return

            const node: Omit<DocumentCanvasNode, 'position'> = {
                nodeId: `node-${this.ports.createId()}`,
                type: 'document',
                assetId: document.assetId,
                dimensions: {
                    width: 400,
                    height: 350,
                },
            }
            const state = await this.ports.attach(
                action.scope.workspaceId,
                {
                    assetId: document.assetId,
                    nodeId: node.nodeId,
                    prepare: () => {
                        this.assertCurrent(action)

                        return this.ports.prepareInsertion(node)
                    },
                },
            )

            if (this.isCurrent(action))
                this.ports.commitDocument(state)
        } catch (error) {
            this.ports.reportError('Error creating document:', error)
        }
    }

    async uploadFile(file: File): Promise<void> {
        const action = this.capture()

        if (!action)
            return

        if (file.size > MAX_UPLOAD_FILE_SIZE) {
            const placeholderId = this.insertPlaceholder(file.name)

            if (this.isCurrent(action))
                this.ports.failPlaceholder(placeholderId, 'File is too large.')

            return
        }

        await this.ingest(
            action,
            file.name,
            'Upload failed',
            onStart => this.ports.uploadFile({
                workspaceId: action.scope.workspaceId,
                file,
                onStart,
            }),
            false,
        )
    }

    async importUrl(value: string): Promise<void> {
        const url = value.trim()
        const action = this.capture()

        if (
            !url
            || !action
        )
            return

        let title: string

        try {
            title = new URL(url).pathname.split('/').filter(Boolean).at(-1) || 'Remote file'
        } catch {
            title = 'Remote file'
        }

        await this.ingest(
            action,
            title,
            'File URL import failed',
            onStart => this.ports.importUrl({
                workspaceId: action.scope.workspaceId,
                url,
                onStart,
            }),
            true,
        )
    }

    private capture(): Action | null {
        const scope = this.ports.readScope()

        return this.disposed
            || !scope
            ? null
            : {
                scope: { ...scope },
                revision: this.revision,
            }
    }

    private isCurrent(action: Action): boolean {
        const current = this.ports.readScope()

        return !this.disposed && action.revision === this.revision && current?.revision === action.scope.revision
            && current.workspaceId === action.scope.workspaceId && current.organizationId === action.scope.organizationId
    }

    private assertCurrent(action: Action): void {
        if (!this.isCurrent(action))
            throw new Error('WORKSPACE_CHANGED_DURING_CANVAS_MUTATION')
    }

    private insertPlaceholder(title: string): string {
        const nodeId = `upload-${this.ports.createId()}`
        const now = this.ports.now()
        this.ports.insertPlaceholder({
            nodeId,
            type: 'operationStatus',
            operation: 'upload',
            title,
            status: 'in-progress',
            message: 'Creating a supported copy before adding it to the canvas.',
            dimensions: {
                width: 360,
                height: 84,
            },
            createdAt: now,
            updatedAt: now,
        })

        return nodeId
    }

    private async ingest(
        action: Action,
        title: string,
        failureMessage: string,
        request: (onStart: () => boolean) => Promise<CanvasIngestReply>,
        closeMenu: boolean,
    ): Promise<void> {
        let placeholderId: string | undefined

        try {
            const result = await request(() => {
                if (!this.isCurrent(action))
                    return false

                placeholderId ??= this.insertPlaceholder(title)

                return this.isCurrent(action)
            })

            if (
                !this.isCurrent(action)
                || !result
            )
                return

            if ('error' in result) {
                if (placeholderId)
                    this.ports.failPlaceholder(placeholderId, result.error || failureMessage)

                return
            }

            if (closeMenu)
                this.ports.closeUploadMenu()

            if (!this.isCurrent(action))
                return

            await this.addAsset(
                action,
                result,
                placeholderId,
            )
        } catch (error) {
            this.ports.reportError(failureMessage, error)

            if (
                placeholderId
                && this.isCurrent(action)
            )
                this.ports.failPlaceholder(placeholderId, failureMessage)
        }
    }

    private async addAsset(
        action: Action,
        result: CanvasIngestResult,
        placeholderId: string | undefined,
    ): Promise<void> {
        const asset = await this.ports.refreshAsset(result.assetId, action.scope.workspaceId)

        if (!this.isCurrent(action))
            return

        if (asset.error)
            throw new Error(asset.error)

        const nodeId = `node-${this.ports.createId()}`
        const width = this.ports.insertionWidth
        const dimensions = result.kind === 'audio'
            ? {
                width: 360,
                height: 96,
            }
            : {
                width,
                height: width / (result.kind === 'document' ? 0.7727 : 1),
            }
        const node = {
            nodeId,
            type: result.kind === 'document' ? 'mediaDocument' : result.kind,
            assetId: result.assetId,
            dimensions,
        } as WorkspaceCanvasInsertionNode
        const state = await this.ports.attach(
            action.scope.workspaceId,
            {
                assetId: result.assetId,
                nodeId,
                prepare: () => {
                    this.assertCurrent(action)

                    return this.ports.prepareInsertion(node, placeholderId)
                },
            },
        )

        if (this.isCurrent(action))
            this.ports.commitMedia(
                state,
                nodeId,
                placeholderId,
            )
    }
}
