import { mediaFixtures } from './media-fixtures.ts'
import {
    createConversationSettings,
    type Asset,
    type AssetDocumentRole,
    type AssetMeta,
    type AssetPrimaryCategory,
    type ConversationSnapshot,
} from '@lixpi/constants'
import {
    type WorkspaceCanvasDocument,
    type WorkspaceCanvasConversation,
} from '@lixpi/canvas-components/workspace'
import {
    type LibraryAssetPorts,
} from '@lixpi/canvas-components/workspace/library'
import { createArtifactFixtures } from './artifact-fixtures.ts'
import { paragraphDocument } from './fixture-editor.ts'

export const workspaceId = 'component-library-workspace'
export const organizationId = 'component-library-organization'
export const userId = 'component-library-user'
export const fixtureTime = 1793743200000

export const conversationDocument = {
    type: 'doc',
    content: [{
        type: 'aiChatThread',
        attrs: { threadId: 'fixture-conversation' },
        content: [
            {
                type: 'aiUserMessage',
                attrs: {
                    id: 'fixture-user-message',
                    createdAt: fixtureTime,
                },
                content: [{
                    type: 'paragraph',
                    content: [{
                        type: 'text',
                        text: 'Use the canvas study as the reference and prepare a short sequence.',
                    }],
                }],
            },
            {
                type: 'aiResponseMessage',
                attrs: {
                    id: 'fixture-assistant-message',
                    generationRequestId: 'fixture-generation',
                },
                content: [{
                    type: 'paragraph',
                    content: [{
                        type: 'text',
                        text: 'The reference, timeline, pipeline, and sequence are ready for review. This conversation is a local fixture.',
                    }],
                }],
            },
        ],
    }],
}

type StoredDocument = {
    doc: object
    version: number
}

export class WorkspaceFixtures {
    readonly artifacts = createArtifactFixtures()
    readonly assets = new Map<string, Asset>()
    readonly categories = new Map<string, AssetPrimaryCategory>()
    readonly snapshots = new Map<string, Map<AssetDocumentRole, StoredDocument>>()
    readonly storageValues = new Map<string, string>()
    private readonly listeners = new Set<(snapshot: { items: ReadonlyMap<string, Asset> }) => void>()
    private nextId = 0
    private readonly conversations = new Map<string, ConversationSnapshot>()

    readonly storage: Pick<Storage, 'getItem' | 'setItem'> = {
        getItem: key => this.storageValues.get(key) ?? null,
        setItem: (key, value) => void this.storageValues.set(key, value),
    }

    constructor() {
        this.addAsset(
            'fixture-image',
            'Canvas study',
            'image',
        )
        this.addAsset(
            'fixture-video',
            'Motion study',
            'video',
        )
        this.addAsset(
            'fixture-audio',
            'Audio study',
            'audio',
        )
        this.addAsset(
            'fixture-media-document',
            'Imported document',
            'document',
        )
        this.addAsset(
            'fixture-document',
            'Canvas notes',
            'document',
            paragraphDocument('A shared document remains editable on the canvas. Select and resize its shell, then type here to change this local fixture.'),
        )
        this.addAsset(
            'fixture-conversation',
            'Reference planning',
            'conversation',
            conversationDocument,
        )

        for (const [assetId, doc] of this.artifacts.documents) {
            const artifactTypeId = assetId.replace('fixture-', '') === 'timeline'
                ? 'action-timeline'
                : assetId.replace('fixture-', '') === 'pipeline'
                    ? 'media-pipeline'
                    : 'media-sequence'
            const definition = this.artifacts.shared.require(artifactTypeId)
            const asset = this.addAsset(
                assetId,
                definition.displayName,
                'capabilityArtifact',
            )
            asset.artifact = {
                artifactTypeId,
                schemaVersion: definition.schemaVersion,
            }
            this.setDocument(
                assetId,
                'capabilityArtifact',
                doc,
            )
            this.setDocument(
                assetId,
                'provenance',
                conversationDocument,
            )
            asset.states.provenance = 'sealed'
            asset.generatedOutputReview = { status: 'candidate' }
        }

        this.conversations.set(
            'fixture-conversation',
            this.createConversation('fixture-conversation', 'Reference planning'),
        )
    }

    createId = (): string => `fixture-id-${++this.nextId}`

    addAsset(
        assetId: string,
        title: string,
        category: AssetPrimaryCategory,
        content?: object,
    ): Asset {
        const mediaKind = category === 'image'
            || category === 'video'
            || category === 'audio'
            || category === 'document'
            ? category
            : undefined
        const asset: Asset = {
            assetId,
            organizationId,
            title,
            scope: 'workspace',
            scopeOwnerId: workspaceId,
            originWorkspaceId: workspaceId,
            ownerUserId: userId,
            documents: {},
            depictionMedium: 'unknown',
            subjectIdentity: {
                classification: 'no-person',
                source: 'user-attestation',
                providerVerifications: [],
            },
            states: {
                lifecycle: 'active',
                media: mediaKind
                    && !content
                    ? 'ready'
                    : 'none',
                conversation: category === 'conversation' ? 'completed' : 'none',
                provenance: 'none',
            },
            referenceCount: 1,
            revision: 1,
            createdAt: fixtureTime,
            updatedAt: fixtureTime,
        }

        if (
            mediaKind
            && !content
        ) {
            const source = mediaKind === 'video'
                ? mediaFixtures.video
                : mediaKind === 'audio'
                    ? mediaFixtures.audio
                    : mediaFixtures.image
            const mimeType = mediaKind === 'video'
                ? 'video/webm'
                : mediaKind === 'audio'
                    ? 'audio/wav'
                    : 'image/png'
            asset.media = {
                kind: mediaKind,
                originalName: title,
                sourceMimeType: mimeType,
                modelSafe: true,
                width: source.width,
                height: source.height,
                durationSeconds: mediaKind === 'video'
                    || mediaKind === 'audio'
                    ? 3
                    : undefined,
                renditions: Object.fromEntries(
                    ['original', 'canonical', 'preview', 'thumbnail', 'poster', 'representativeFrame'].map(
                        name => [
                            name,
                            {
                                name,
                                status: 'ready',
                                blobHash: name === 'original'
                                    || name === 'canonical'
                                    ? source.blobHash
                                    : mediaFixtures.image.blobHash,
                                mimeType: name === 'original'
                                    || name === 'canonical'
                                    ? mimeType
                                    : 'image/png',
                                width: name === 'original'
                                    || name === 'canonical'
                                    ? source.width
                                    : mediaFixtures.image.width,
                                height: name === 'original'
                                    || name === 'canonical'
                                    ? source.height
                                    : mediaFixtures.image.height,
                                byteSize: name === 'original'
                                    || name === 'canonical'
                                    ? source.byteSize
                                    : mediaFixtures.image.byteSize,
                                updatedAt: fixtureTime,
                            },
                        ],
                    ),
                ),
            }
        }

        this.assets.set(assetId, asset)
        this.categories.set(assetId, category)

        if (content)
            this.setDocument(
                assetId,
                category === 'conversation' ? 'conversation' : 'content',
                content,
            )

        return asset
    }

    setDocument(
        assetId: string,
        role: AssetDocumentRole,
        doc: object,
    ): void {
        const previous = this.snapshots.get(assetId) ?? new Map<AssetDocumentRole, StoredDocument>()
        const version = (previous.get(role)?.version ?? 0) + 1
        previous.set(
            role,
            {
                doc,
                version,
            },
        )
        this.snapshots.set(assetId, previous)
        const asset = this.assets.get(assetId)

        if (asset)
            asset.documents[role] = {
                role,
                blobHash: `fixture-${assetId}-${role}`,
                version,
                schemaVersion: 'prosemirror-schema-v1',
                byteSize: JSON.stringify(doc).length,
                updatedAt: fixtureTime,
            }
    }

    readDocument = (
        assetId: string,
        role: AssetDocumentRole,
    ): StoredDocument | undefined => this.snapshots.get(assetId)?.get(role)

    getAsset = (assetId: string): Asset | undefined => this.assets.get(assetId)

    requireAsset = (assetId: string): Asset => {
        const asset = this.assets.get(assetId)

        if (!asset)
            throw new Error(`Unknown fixture Asset: ${assetId}`)

        return asset
    }

    publish = (): void => {
        for (const listener of this.listeners)
            listener({ items: this.assets })
    }

    subscribe = (listener: (snapshot: { items: ReadonlyMap<string, Asset> }) => void): (() => void) => {
        this.listeners.add(listener)

        return () => this.listeners.delete(listener)
    }

    updateAsset(
        assetId: string,
        patch: Partial<Asset>,
    ): Asset {
        const previous = this.requireAsset(assetId)
        const asset = {
            ...previous,
            ...patch,
            revision: previous.revision + 1,
        }
        this.assets.set(assetId, asset)
        this.publish()

        return asset
    }

    metadata = (asset: Asset): AssetMeta => ({
        scopeAndOwner: `${asset.scope}#${asset.scopeOwnerId}`,
        scope: asset.scope,
        scopeOwnerId: asset.scopeOwnerId,
        assetId: asset.assetId,
        organizationId,
        title: asset.title,
        primaryCategory: this.categories.get(asset.assetId) ?? 'image',
        ownerUserId: userId,
        originWorkspaceId: workspaceId,
        lifecycleStatus: asset.states.lifecycle,
        mediaStatus: asset.states.media,
        mimeType: asset.media?.sourceMimeType,
        byteSize: 1024,
        width: asset.media?.width,
        height: asset.media?.height,
        thumbnailBlobHash: asset.media ? 'fixture-thumbnail' : undefined,
        previewBlobHash: asset.media ? 'fixture-preview' : undefined,
        durationSeconds: asset.media?.durationSeconds,
        artifactTypeId: asset.artifact?.artifactTypeId,
        artifactSchemaVersion: asset.artifact?.schemaVersion,
        depictionMedium: asset.depictionMedium,
        subjectIdentityClassification: asset.subjectIdentity.classification,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
    })

    readonly libraryAssets: LibraryAssetPorts = {
        list: async query => ({
            items: [...this.assets.values()].filter(asset => !query.primaryCategory || this.categories.get(asset.assetId) === query.primaryCategory).map(this.metadata),
        }),
        get: async assetId => this.requireAsset(assetId),
        refresh: async assetId => this.requireAsset(assetId),
        updateMetadata: async (
            assetId,
            _revision,
            patch,
        ) => this.updateAsset(assetId, patch),
        changeScope: async (
            assetId,
            _revision,
            scope,
            scopeOwnerId,
        ) => this.updateAsset(
            assetId,
            {
                scope,
                scopeOwnerId,
            },
        ),
        resumeDocument: async () => undefined,
        getDocument: this.readDocument,
    }

    renditionUrl = (
        assetId: string,
        rendition: string,
    ): string => {
        if (
            assetId === 'fixture-video'
            && (rendition === 'original' || rendition === 'canonical')
        )
            return '/fixtures/canvas-sample.webm'

        if (
            assetId === 'fixture-audio'
            && (rendition === 'original' || rendition === 'canonical')
        )
            return '/fixtures/canvas-sample.wav'

        return '/fixtures/canvas-sample.png'
    }

    get documents(): WorkspaceCanvasDocument[] {
        return [...this.assets.values()].filter(asset => this.categories.get(asset.assetId) === 'document' && !asset.media).map(
            asset => ({
                documentId: asset.assetId,
                assetId: asset.assetId,
                workspaceId,
                organizationId,
                title: asset.title,
                content: this.readDocument(asset.assetId, 'content')?.doc,
                proseMirrorVersion: this.readDocument(asset.assetId, 'content')?.version ?? 0,
                revision: asset.revision,
            }),
        )
    }

    get threads(): WorkspaceCanvasConversation[] {
        return [...this.assets.values()].filter(asset => this.categories.get(asset.assetId) === 'conversation').map(
            asset => ({
                assetId: asset.assetId,
                threadId: asset.assetId,
                workspaceId,
                organizationId,
                title: asset.title,
                content: this.readDocument(asset.assetId, 'conversation')?.doc,
                proseMirrorVersion: this.readDocument(asset.assetId, 'conversation')?.version ?? 0,
                revision: asset.revision,
                status: 'completed',
                createdAt: asset.createdAt,
                updatedAt: asset.updatedAt,
            }),
        )
    }

    createConversation(
        conversationAssetId: string,
        title = 'Local conversation',
    ): ConversationSnapshot {
        const snapshot: ConversationSnapshot = {
            protocolVersion: 1,
            workspaceId,
            conversationAssetId,
            title,
            settings: createConversationSettings(),
            settingsRevision: 1,
            queueRevision: 1,
            queuePaused: false,
            queuedTurns: [],
            messages: [],
            documentRevision: 1,
            eventSeq: 0,
            createdAt: fixtureTime,
            updatedAt: fixtureTime,
        }
        this.conversations.set(conversationAssetId, snapshot)

        return snapshot
    }

    getConversation = (assetId: string): ConversationSnapshot => {
        const snapshot = this.conversations.get(assetId)

        if (!snapshot)
            throw new Error(`Unknown fixture conversation: ${assetId}`)

        return snapshot
    }

    listConversations = (): ConversationSnapshot[] => [...this.conversations.values()]

    destroy(): void {
        this.listeners.clear()
    }
}
