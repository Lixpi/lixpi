import {
    LoadingStatus,
    MEDIA_DESCRIPTOR_VERSION,
    type CanvasState,
} from '@lixpi/constants'
import { createLixpiUiSettings } from '@lixpi/canvas-components/workspace/settings'
import {
    resolveWorkspaceCanvasTheme,
    updateWorkspaceCanvasSettings,
    type WorkspaceCanvasAppearance,
    type WorkspaceCanvasHost,
    type WorkspaceConversationPorts,
} from '@lixpi/canvas-components/workspace'
import {
    type ContextPreviewEnvironment,
} from '@lixpi/canvas-components/workspace/context'
import {
    type WorkspaceAssetDetailsPorts,
} from '@lixpi/canvas-components/workspace/review'
import { designSystemDocumentKinds } from './document-kinds.ts'
import {
    collectProseMirrorText,
    parseProseMirrorJsonContent,
} from '@lixpi/prosemirror/shared/thread-doc'
import { orderedListIcon } from '@lixpi/ui-kit/svg'
import {
    FixtureEditor,
    mountConversationEditor,
    mountPromptEditor,
} from './fixture-editor.ts'
import {
    fixtureTime,
    organizationId,
    userId,
    workspaceId,
    type WorkspaceFixtures,
} from './fixtures.ts'
import { ensureArtifactStyles } from './artifact-fixtures.ts'
import { FixtureCapabilityCatalog } from './capability-fixtures.ts'
import {
    type CanvasThemeStore,
} from '@lixpi/canvas-components/theme'
import { getExampleTheme } from '../example-theme.ts'

export const createAppearance = (): WorkspaceCanvasAppearance => createLixpiUiSettings()

export class FixtureWorkspaceHost {
    readonly host: WorkspaceCanvasHost
    private readonly baseAppearance = createAppearance()
    private readonly releaseTheme: () => void
    readonly theme: CanvasThemeStore
    readonly appearance: WorkspaceCanvasAppearance
    readonly conversations: WorkspaceConversationPorts
    readonly assetDetails: WorkspaceAssetDetailsPorts

    constructor(
        readonly fixtures: WorkspaceFixtures,
        readonly document: Document,
        private readonly report: (message: string) => void,
        readState: () => CanvasState | null = () => null,
    ) {
        this.theme = getExampleTheme(document.body)
        this.appearance = resolveWorkspaceCanvasTheme(this.theme.value, this.baseAppearance)
        this.conversations = {
            create: async request => fixtures.createConversation(request.clientConversationId),
            list: async () => ({ conversations: fixtures.listConversations() }),
            get: async request => fixtures.getConversation(request.conversationAssetId),
            rename: async (
                _workspaceId,
                assetId,
                title,
            ) => {
                fixtures.getConversation(assetId).title = title
                this.report(`Local conversation renamed to "${title}".`)
            },
            submit: async request => {
                this.report('The composer submitted to the local fixture. No model request was sent.')

                return {
                    status: 'rejected',
                    clientMessageId: request.clientMessageId,
                    error: {
                        code: 'LOCAL_FIXTURE',
                        message: 'This component example does not execute model requests.',
                        recoverable: true,
                    },
                }
            },
            settings: async request => {
                const snapshot = fixtures.getConversation(request.conversationAssetId)
                snapshot.settings = {
                    ...snapshot.settings,
                    ...request.patch,
                }
                snapshot.settingsRevision += 1

                return snapshot
            },
            stop: async () => void this.report('Stopped the simulated conversation.'),
            queue: async () => void this.report('Updated the simulated conversation queue.'),
            replay: async () => ({
                events: [],
                hasMore: false,
                snapshotRequired: false,
                eventSeq: 0,
            }),
            subscribe: () => () => {},
        }
        const mountAsset: WorkspaceAssetDetailsPorts['mountEditor'] = request => new FixtureEditor(
            request.host,
            request.content,
            designSystemDocumentKinds.schema(request.documentType),
            [],
            request.onChange,
        )
        this.assetDetails = {
            document,
            workspaceId,
            userId,
            tooltipHideDelayMs: 120,
            getAsset: fixtures.getAsset,
            getContentDocument: assetId => fixtures.readDocument(assetId, 'content'),
            mountEditor: mountAsset,
            updateMetadata: async (
                assetId,
                _revision,
                patch,
            ) => fixtures.updateAsset(assetId, patch),
            changeScope: async (
                assetId,
                _revision,
                scope,
                scopeOwnerId,
            ) => fixtures.updateAsset(
                assetId,
                {
                    scope,
                    scopeOwnerId,
                },
            ),
            attestSubjectIdentity: async (
                assetId,
                _revision,
                classification,
            ) => {
                const previous = fixtures.requireAsset(assetId)

                return fixtures.updateAsset(
                    assetId,
                    {
                        subjectIdentity: {
                            ...previous.subjectIdentity,
                            classification,
                            source: 'user-attestation',
                        },
                    },
                )
            },
            onChanged: () => fixtures.publish(),
            onError: error => this.report(
                String(error),
            ),
        }
        this.host = {
            createId: fixtures.createId,
            openExternalUrl: () => this.report('External provider navigation is simulated in this example.'),
            settings: this.baseAppearance,
            theme: this.theme,
            editors: {
                createPrompt: integration => request => mountPromptEditor(
                    request,
                    integration,
                    this.theme,
                    this.report,
                ),
                createConversation: () => mountConversationEditor,
                mountAsset,
                mountDocument: request => {
                    request.onLeaseStateChange({ readOnly: false })

                    return new FixtureEditor(
                        request.container,
                        request.document.content ?? {},
                        designSystemDocumentKinds.schema('assetContent'),
                        [],
                        content => {
                            fixtures.setDocument(
                                request.node.assetId,
                                'content',
                                content,
                            )
                            request.onChange(content)
                        },
                    )
                },
                mountCapability: request => {
                    const schema = designSystemDocumentKinds.schema(request.documentView.kindId)

                    return new FixtureEditor(
                        request.container,
                        request.document,
                        schema,
                        request.documentView.features.flatMap(feature => feature.create({
                            schema,
                            context: {},
                        }).plugins ?? []),
                        content => {
                            fixtures.setDocument(
                                request.node.assetId,
                                'capabilityArtifact',
                                content,
                            )
                            request.onContentChange()
                        },
                    )
                },
                mountHistory: request =>
                    new FixtureEditor(
                        request.mount,
                        request.content,
                        designSystemDocumentKinds.schema(request.documentType ?? 'assetConversation'),
                        [],
                        () => {},
                        true,
                    ),
            },
            assets: {
                read: fixtures.getAsset,
                upsert: asset => {
                    fixtures.assets.set(asset.assetId, asset)
                    fixtures.publish()
                },
                readDocument: fixtures.readDocument,
                subscribe: fixtures.subscribe,
                create: async request => fixtures.addAsset(
                    request.assetId,
                    request.title,
                    'conversation',
                    request.initialDoc,
                ),
                get: async assetId => fixtures.requireAsset(assetId),
                refresh: async assetId => fixtures.requireAsset(assetId),
                loadWorkspaceAssets: async () => [...fixtures.assets.values()],
                ensureAssetsLoaded: async assetIds => assetIds.flatMap(assetId => {
                    const asset = fixtures.getAsset(assetId)

                    return asset ? [asset] : []
                }),
                updateMetadata: this.assetDetails.updateMetadata,
                changeScope: this.assetDetails.changeScope,
                attestSubjectIdentity: this.assetDetails.attestSubjectIdentity,
                reviewGeneratedOutput: async request => {
                    const state = readState()
                    const node = state?.nodes.find(candidate => candidate.nodeId === request.nodeId)
                    const assetId = node
                        && 'assetId' in node
                        ? node.assetId
                        : undefined

                    if (
                        request.action !== 'accept'
                        || !assetId
                    )
                        return { error: 'The local fixture supports acceptance of an existing output only.' }

                    fixtures.updateAsset(assetId, { generatedOutputReview: { status: 'accepted' } })
                    this.report('Accepted the local output.')

                    return {
                        success: true,
                        workspaceId,
                        affectedAssetIds: [assetId],
                        acceptedAssetIds: [assetId],
                        supersededAssetIds: [],
                        rejectedAssetIds: [],
                        canvasGeometry: {
                            layoutRevision: fixtureTime,
                            nodes: [],
                        },
                    }
                },
                list: fixtures.libraryAssets.list,
                resumeDocument: async () => undefined,
                detach: async () => void this.report('Removed the local catalog reference.'),
            },
            generation: {
                connect: () => ({
                    send: async () => void this.report('Submitted to the local transport fixture.'),
                    stop: async () => undefined,
                    disconnect: () => {},
                }),
                fetchConversation: async request => fixtures.threads.find(thread => thread.threadId === request.threadId) ?? null,
                subscribe: () => () => {},
                replay: async () => {
                    throw new Error('Generation recovery requires an active backend request; this example has none.')
                },
                get: async () => {
                    throw new Error('This example has no active backend generation request.')
                },
                cancel: async () => this.report('Cancelled the simulated request.'),
                resolveReference: async () => this.report('Resolved the simulated Asset reference.'),
                startVerification: async () => {
                    this.report('Provider verification is simulated.')

                    return {
                        verificationUrl: '#simulated-verification',
                        expiresAt: fixtureTime + 60000,
                        requestRevision: 1,
                    }
                },
                stopConversation: async () => ({ status: 'stopped' }),
                describeMedia: async () => ({
                    summary: 'Deterministic component-library fixture.',
                    entityTags: [],
                    styleTags: [],
                }),
            },
            conversations: this.conversations,
            workspace: {
                organizationId: () => organizationId,
                userId: () => userId,
                loadingStatus: () => LoadingStatus.success,
                reload: async () => fixtures.publish(),
                subscribe: () => () => {},
            },
            models: {
                read: () => [],
                subscribe: () => () => {},
                modelIcon: () => null,
                providerIcon: () => null,
                createBadge: () => null,
                styleBadge: () => {},
            },
            capabilities: {
                frontend: fixtures.artifacts.frontend,
                shared: fixtures.artifacts.shared,
                ensureStyles: ensureArtifactStyles,
                catalog: () => new FixtureCapabilityCatalog(),
                promptCatalog: () => ({
                    list: async () => ({
                        items: [],
                        recents: [],
                    }),
                    listModules: async () => [],
                    getModule: async () => {
                        throw new Error('Module lookup is not connected in this local fixture.')
                    },
                }),
            },
            media: {
                sources: {
                    getAsset: fixtures.getAsset,
                    resolveAssetRendition: async request => ({
                        url: fixtures.renditionUrl(request.assetId, request.renditionId),
                        release: () => {},
                    }),
                    resolveTransientSource: async url => ({
                        url,
                        release: () => {},
                    }),
                },
                renditionPath: fixtures.renditionUrl,
                prepareRenditionUrls: async () => fixtures.renditionUrl,
                download: async () => void this.report('Download selected. Fixture media stays local to this service.'),
                uploadReplacement: async () => {
                    this.report('Replacement upload is simulated. Select a fixture through the example controls.')

                    return null
                },
            },
            contextEnvironment: sources => this.contextEnvironment(sources),
            extractText: content => collectProseMirrorText(parseProseMirrorJsonContent(content) ?? undefined),
            traceDetail: () => ({}),
            storage: fixtures.storage,
            debugEnabled: () => false,
        }

        for (const asset of fixtures.assets.values()) {
            asset.descriptor = {
                status: 'ready',
                summary: `${asset.title}. Deterministic local component fixture.`,
                entityTags: [],
                styleTags: [],
                source: 'analysis',
                version: MEDIA_DESCRIPTOR_VERSION,
                updatedAt: fixtureTime,
            }
        }

        this.releaseTheme = this.theme.subscribe(
            theme => updateWorkspaceCanvasSettings(
                this.appearance,
                resolveWorkspaceCanvasTheme(theme, this.baseAppearance),
            ),
        )
    }

    destroy(): void {
        this.releaseTheme()
    }

    contextEnvironment(
        sources: Pick<ContextPreviewEnvironment, 'document' | 'getDocuments' | 'getThreads' | 'getAsset'> = {
            document: this.document,
            getDocuments: () => this.fixtures.documents,
            getThreads: () => this.fixtures.threads,
            getAsset: this.fixtures.getAsset,
        },
    ): ContextPreviewEnvironment {
        return {
            ...sources,
            tooltipHideDelayMs: 120,
            getArtifactIcon: () => `<svg viewBox="0 0 768 896" aria-hidden="true"><path d="${orderedListIcon}"></path></svg>`,
            extractDocumentText: content => typeof content === 'string' ? content : collectProseMirrorText(
                parseProseMirrorJsonContent(content) ?? undefined,
            ),
            initialRenditionUrl: this.fixtures.renditionUrl,
            resolveRenditionUrl: async (assetId, rendition) => this.fixtures.renditionUrl(assetId, rendition),
            onError: error => this.report(
                String(error),
            ),
        }
    }
}
