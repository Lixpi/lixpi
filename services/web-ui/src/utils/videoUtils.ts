import { NATS_SUBJECTS } from '@lixpi/constants'
import { servicesStore } from '$src/stores/servicesStore.ts'

const { VIDEO_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

// Sibling of utils/imageUtils.ts. Removes both the MP4 file and its companion
// poster image from the workspace Object Store. The poster is just a normal
// workspace image, so we route it through the standard image delete subject
// rather than the video subject — that keeps server-side ownership simple and
// matches how the storeWorkspaceVideo + storeWorkspaceImage publishers split
// the two assets at completion time.
export async function deleteVideo(fileId: string, workspaceId: string, posterFileId?: string): Promise<void> {
    if (!fileId || !workspaceId) return

    const nats = servicesStore.getData('nats')
    if (!nats) return

    try {
        await nats.request(VIDEO_SUBJECTS.DELETE_VIDEO, {
            workspaceId,
            fileId,
        })
    } catch (e) {
        console.warn('[videoUtils] deleteVideo failed', { fileId, workspaceId, error: e })
    }

    if (posterFileId) {
        try {
            await nats.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.IMAGE_SUBJECTS.DELETE_IMAGE, {
                workspaceId,
                fileId: posterFileId,
            })
        } catch (e) {
            // Poster cleanup is best-effort — if the underlying mp4 is gone the
            // orphan poster is harmless and will be reaped on workspace delete.
            console.warn('[videoUtils] poster cleanup failed', { posterFileId, workspaceId, error: e })
        }
    }
}
