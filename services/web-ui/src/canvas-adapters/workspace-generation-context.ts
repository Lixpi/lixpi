import { WorkspaceGenerationContext } from '@lixpi/canvas-components-lixpi-specific/shared'
import { assetsStore } from '$src/stores/assetsStore.ts'
import { buildAssetRenditionPath } from '$src/utils/mediaUrls.ts'

export function createWorkspaceGenerationContext(): WorkspaceGenerationContext {
    return new WorkspaceGenerationContext({ readAsset: assetId => assetsStore.get(assetId), renditionPath: buildAssetRenditionPath })
}
