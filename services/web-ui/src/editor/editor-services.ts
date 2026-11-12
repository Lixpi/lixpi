import {
    type EditorServices,
    type EditorPromptReferencePreviewRenderer,
    type AiUserMessageContextPreviewRenderer,
} from '@lixpi/prosemirror/frontend/editor'
import {
    createCapabilityPromptReferencePreview,
    createContextPreviewTile,
    createMediaPromptReferencePreview,
    createPromptReferenceChipElement,
    type ContextPreviewEnvironment,
    type PromptReferencePreviewRenderer,
} from '@lixpi/canvas-components/workspace/context'
import {
    createPromptMediaModeSwitch,
    createPromptModelMenuTrigger,
} from '@lixpi/canvas-components/workspace/composer'
import {
    type CanvasNode,
} from '@lixpi/constants'
import { renderMediaModelBadge } from '@lixpi/ui-kit/components/media-model-badge'
import {
    type AuthTokenProvider,
} from '@lixpi/auth-client'

import {
    applyAiModelMenuStyleSettings,
    createAiModelMenuContent,
    createMediaGenerationConfigMatrixView,
    getModelOptionsForCapability,
    transformModelsToOptions,
} from '$src/components/aiModelControls/index.ts'
import { createCapabilityRunProgress } from '$src/components/capabilityRun/index.ts'
import {
    applyMediaModelBadgeStyleProperties,
    resolveMediaModelBadgeConfig,
} from '$src/components/mediaModelBadge/mediaModelBadge.ts'
import {
    capabilityArtifactFrontendRegistry,
    ensureCapabilityStyles,
    getCapabilityArtifactIcon,
} from '$src/installed-capabilities.ts'
import SegmentsReceiver from '$src/services/segmentsReceiver-service.ts'
import { settings } from '$src/settings.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { downloadImage } from '$src/utils/downloadImage.ts'
import {
    buildAssetRenditionPath,
    resolveAuthenticatedMediaUrl,
} from '$src/utils/mediaUrls.ts'

// The web UI's implementation of every editor port: media signed with the
// user's token, the shared settings, the model catalog store, streamed
// segments, the installed Capabilities and the model controls.
export const createWebUiEditorServices = (auth: AuthTokenProvider): EditorServices => {
    const getAuthToken = () => auth.getTokenSilently()

    return {
        media: {
            resolveUrl: (url, options) => resolveAuthenticatedMediaUrl(
                url,
                {
                    apiBaseUrl: import.meta.env.VITE_API_URL || '',
                    getAuthToken,
                    ...options,
                },
            ),
            renditionPath: buildAssetRenditionPath,
            modelBadge: {
                decorate: container => applyMediaModelBadgeStyleProperties(container, { scale: settings.mediaNode.generatedMediaChrome.chatScale }),
                render: (target, modelId) => renderMediaModelBadge(
                    target,
                    resolveMediaModelBadgeConfig({ modelId }),
                ),
                subscribe: listener => aiModelsStore.subscribe(() => listener()),
            },
            downloadImage: src => downloadImage(src, { getAuthToken }),
        },
        settings,
        previews: {
            createReferenceChip: createPromptReferenceChipElement,
        },
        promptChrome: {
            createMediaModeSwitch: createPromptMediaModeSwitch,
            createModelMenuTrigger: createPromptModelMenuTrigger,
        },
        models: {
            getModels: () => aiModelsStore.getData(),
            getMediaGenerationConfigMatrix: () => aiModelsStore.getMediaGenerationConfigMatrix(),
            subscribe: listener => aiModelsStore.subscribe(() => listener()),
        },
        segments: SegmentsReceiver,
        capabilityArtifacts: {
            createPromptReferenceView: (artifactTypeId, options) =>
                capabilityArtifactFrontendRegistry.require(artifactTypeId).createPromptReferenceView(options),
            icon: getCapabilityArtifactIcon,
            ensureStyles: ensureCapabilityStyles,
        },
        createCapabilityRunProgress: (previewRenderer, outputPorts) => createCapabilityRunProgress(
            undefined,
            previewRenderer ? previewHosts.get(previewRenderer) : undefined,
            outputPorts,
        ),
        modelControls: {
            applyAiModelMenuStyleSettings,
            createAiModelMenuContent,
            createMediaGenerationConfigMatrixView,
            getModelOptionsForCapability,
            transformModelsToOptions,
        },
    }
}

const previewHosts = new WeakMap<EditorPromptReferencePreviewRenderer, PromptReferencePreviewRenderer>()

export const toEditorPromptReferencePreview = (renderer?: PromptReferencePreviewRenderer): EditorPromptReferencePreviewRenderer | undefined => {
    if (!renderer)
        return undefined

    const result: EditorPromptReferencePreviewRenderer = {
        document: renderer.environment.document,
        resolveMediaKind: assetId => renderer.environment.getAsset?.(assetId)?.media?.kind,
        createMediaPreview: reference => createMediaPromptReferencePreview(reference, renderer),
        createCapabilityPreview: renderer.getCapabilityModule
            ? reference => createCapabilityPromptReferencePreview(reference, renderer)
            : undefined,
    }
    previewHosts.set(result, renderer)

    return result
}

export const toEditorContextPreview = (source?: {
    getNodeById: (nodeId: string) => CanvasNode | undefined
    environment: ContextPreviewEnvironment
    inlinePopover?: boolean
}): AiUserMessageContextPreviewRenderer | undefined =>
    source
        ? {
            createReferencePreview: nodeId => {
                const node = source.getNodeById(nodeId)

                return node
                    ? createContextPreviewTile({
                        node,
                        getNode: () => source.getNodeById(nodeId) ?? node,
                        environment: source.environment,
                        preferredPlacement: 'bottom',
                        inlinePopover: source.inlinePopover,
                    })
                    : null
            },
        }
        : undefined
