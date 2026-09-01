import {
    type ContextPreviewEnvironment,
} from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import { settings } from '$src/settings.ts'
import { getCapabilityArtifactIcon } from '$src/installed-capabilities.ts'
import AuthService from '$src/services/auth-service.ts'
import { extractContentFromProseMirror } from '$src/utils/prosemirrorText.ts'
import {
    buildAssetRenditionPath,
    resolveAuthenticatedMediaUrl,
} from '$src/utils/mediaUrls.ts'

export function createContextPreviewEnvironment(sources: Pick<ContextPreviewEnvironment, 'document' | 'getDocuments' | 'getThreads' | 'getAsset'>): ContextPreviewEnvironment {
    return {
        ...sources,
        tooltipHideDelayMs: settings.helpTooltip.interactiveHideDelayMs,
        getArtifactIcon: getCapabilityArtifactIcon,
        extractDocumentText: content => extractContentFromProseMirror(content).text,
        initialRenditionUrl: buildAssetRenditionPath,
        resolveRenditionUrl: async (assetId, rendition, signal) => {
            if (signal.aborted) return ''
            return await resolveAuthenticatedMediaUrl(buildAssetRenditionPath(assetId, rendition), {
                apiBaseUrl: import.meta.env.VITE_API_URL || '',
                getAuthToken: () => AuthService.getTokenSilently(),
            })
        },
        onError: error => console.warn('Failed to resolve context preview media URL:', error),
    }
}
