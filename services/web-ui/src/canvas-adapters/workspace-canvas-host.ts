import {
    type WorkspaceCanvasHost,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import { WorkspaceMediaAdapter } from './workspace-media.ts'
import { createMediaModelBadge } from '@lixpi/ui-kit/components/media-model-badge'
import { createWorkspaceCanvasEditors } from './workspace-editors.ts'
import { createConversationProjectionFetch } from './conversation-projection.ts'
import { createCanvasConversationTransport } from './conversation-editor.ts'
import { subscribeCanvasMediaOperation } from './media-operation-events.ts'
import { createContextPreviewEnvironment } from './context-preview-environment.ts'
import { createExecutionTraceTimelineDetailAdapter } from '$src/components/executionTrace/index.ts'
import {
    applyMediaModelBadgeStyleProperties,
    resolveMediaModelBadgeConfig,
} from '$src/components/mediaModelBadge/mediaModelBadge.ts'
import {
    getAiModelIcon,
    getAiProviderIcon,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiProviderIcons.ts'
import {
    capabilityArtifactFrontendRegistry,
    capabilityArtifactSharedRegistry,
    ensureCapabilityStyles,
} from '$src/installed-capabilities.ts'
import { settings } from '$src/settings.ts'
import AssetService from '$src/services/asset-service.ts'
import AuthService from '$src/services/auth-service.ts'
import { loadWorkspaceRouteData } from '$src/services/router-service.ts'
import { createDefaultCapabilityCatalogClient } from '$src/services/capability-catalog-client.ts'
import { createPromptReferenceCatalogClient } from '$src/services/prompt-reference-catalog-client.ts'
import { describeMedia } from '$src/services/media-descriptor-service.ts'
import {
    cancelMediaGenerationRequest,
    getMediaGenerationRequest,
    replayMediaGenerationRequest,
    resolveMediaGenerationReference,
    startMediaGenerationVerification,
    stopAiChatMessageForThread,
} from '$src/services/ai-interaction-service.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'
import { userStore } from '$src/stores/userStore.ts'
import { assetsStore } from '$src/stores/assetsStore.ts'
import { assetDocumentsStore } from '$src/stores/assetDocumentsStore.ts'
import { extractContentFromProseMirror } from '$src/utils/prosemirrorText.ts'

export const createWorkspaceCanvasHost = (): WorkspaceCanvasHost => {
    const assets = new AssetService()
    const apiBaseUrl = import.meta.env.VITE_API_URL || ''

    return {
        createId: () => crypto.randomUUID(),
        openExternalUrl: url => void window.open(
            url,
            '_blank',
            'noopener,noreferrer',
        ),
        onOpenCapabilityLibrary: callback => {
            const listener = (event: Event): void => void callback((event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId)
            window.addEventListener('lixpi:open-capability-library', listener)

            return () => window.removeEventListener('lixpi:open-capability-library', listener)
        },
        settings,
        editors: createWorkspaceCanvasEditors(),
        assets: {
            read: assetId => assetsStore.get(assetId),
            upsert: asset => assetsStore.upsert(asset),
            subscribe: changed => assetsStore.subscribe(changed),
            readDocument: (assetId, role) => assetDocumentsStore.get(assetId, role),
            create: request => assets.create(request),
            get: (assetId, workspaceId) => assets.get(assetId, workspaceId),
            refresh: (assetId, workspaceId) => assets.refresh(assetId, workspaceId),
            loadWorkspaceAssets: workspaceId => assets.loadWorkspaceAssets(workspaceId),
            ensureAssetsLoaded: assetIds => assets.ensureAssetsLoaded(assetIds),
            updateMetadata: (
                assetId,
                revision,
                patch,
            ) => assets.updateMetadata(
                assetId,
                revision,
                patch,
            ),
            changeScope: (
                assetId,
                revision,
                scope,
                ownerId,
            ) => assets.changeScope(
                assetId,
                revision,
                scope,
                ownerId,
            ),
            attestSubjectIdentity: (
                assetId,
                revision,
                classification,
            ) => assets.attestSubjectIdentity(
                assetId,
                revision,
                classification,
            ),
            reviewGeneratedOutput: request => assets.reviewGeneratedOutput(request),
            list: query => assets.list(query),
            resumeDocument: request => assets.resumeDocument(request),
            detach: request => assets.detach(request),
        },
        generation: {
            connect: createCanvasConversationTransport,
            fetchConversation: createConversationProjectionFetch(assets),
            subscribe: subscribeCanvasMediaOperation,
            get: getMediaGenerationRequest,
            replay: replayMediaGenerationRequest,
            cancel: cancelMediaGenerationRequest,
            resolveReference: resolveMediaGenerationReference,
            startVerification: startMediaGenerationVerification,
            stopConversation: stopAiChatMessageForThread,
            describeMedia,
        },
        workspace: {
            organizationId: () => workspaceStore.getData('organizationId'),
            userId: () => userStore.getData('userId'),
            loadingStatus: () => workspaceStore.getMeta('loadingStatus'),
            subscribe: changed => workspaceStore.subscribe(
                ({
                    meta,
                    data,
                }) => changed({
                    loadingStatus: meta.loadingStatus,
                    error: data.error,
                }),
            ),
            reload: loadWorkspaceRouteData,
        },
        models: {
            read: () => aiModelsStore.getData() ?? [],
            subscribe: changed => aiModelsStore.subscribe(changed),
            modelIcon: getAiModelIcon,
            providerIcon: getAiProviderIcon,
            createBadge: options => createMediaModelBadge(
                resolveMediaModelBadgeConfig(options),
            ),
            styleBadge: applyMediaModelBadgeStyleProperties,
        },
        capabilities: {
            frontend: capabilityArtifactFrontendRegistry,
            shared: capabilityArtifactSharedRegistry,
            ensureStyles: ensureCapabilityStyles,
            catalog: createDefaultCapabilityCatalogClient,
            promptCatalog: createPromptReferenceCatalogClient,
        },
        media: new WorkspaceMediaAdapter({
            apiBaseUrl,
            getToken: () => AuthService.getTokenSilently(),
            getAsset: assetId => assetsStore.get(assetId),
            fetch,
        }),
        contextEnvironment: createContextPreviewEnvironment,
        extractText: content => extractContentFromProseMirror(typeof content === 'string'
            || content && typeof content === 'object'
            ? content
            : '').text,
        traceDetail: createExecutionTraceTimelineDetailAdapter,
        storage: {
            getItem: key => localStorage.getItem(key),
            setItem: (key, value) => localStorage.setItem(key, value),
        },
        debugEnabled: () => {
            try {
                return localStorage.getItem('lixpi.debug.workspaceCanvas') === '1'
            } catch {
                return false
            }
        },
    }
}
