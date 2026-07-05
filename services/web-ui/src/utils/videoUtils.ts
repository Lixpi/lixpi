import { NATS_SUBJECTS } from '@lixpi/constants'
import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'

const { VIDEO_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS
const FILE_STILL_REFERENCED_BY_CANVAS = 'FILE_STILL_REFERENCED_BY_CANVAS'
const DELETE_VIDEO_RETRY_DELAYS_MS = [750, 2000, 5000]

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

async function requestDeleteWithReferencedRetry(config: {
    subject: string
    token: string
    workspaceId: string
    fileId: string
    retryDelaysMs: number[]
}): Promise<{ success: boolean; error?: string }> {
    for (let attempt = 0; attempt <= config.retryDelaysMs.length; attempt += 1) {
        const result = await servicesStore.getData('nats')!.request(config.subject, {
            token: config.token,
            workspaceId: config.workspaceId,
            fileId: config.fileId,
        })

        if (result?.error === FILE_STILL_REFERENCED_BY_CANVAS && attempt < config.retryDelaysMs.length) {
            await wait(config.retryDelaysMs[attempt])
            continue
        }

        if (result?.error) {
            return { success: false, error: result.error }
        }

        return { success: true }
    }

    return { success: false, error: FILE_STILL_REFERENCED_BY_CANVAS }
}

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

    const token = await AuthService.getTokenSilently()
    if (!token) return

    try {
        const result = await requestDeleteWithReferencedRetry({
            subject: VIDEO_SUBJECTS.DELETE_VIDEO,
            token,
            workspaceId,
            fileId,
            retryDelaysMs: DELETE_VIDEO_RETRY_DELAYS_MS,
        })
        if (!result.success) {
            const message = result.error === FILE_STILL_REFERENCED_BY_CANVAS
                ? '[videoUtils] deleteVideo deferred because file is still referenced by canvas'
                : '[videoUtils] deleteVideo refused'
            console.warn(message, { fileId, workspaceId, error: result.error })
            return
        }
    } catch (e) {
        console.warn('[videoUtils] deleteVideo failed', { fileId, workspaceId, error: e })
        return
    }

    if (posterFileId) {
        try {
            const posterResult = await requestDeleteWithReferencedRetry({
                subject: NATS_SUBJECTS.WORKSPACE_SUBJECTS.IMAGE_SUBJECTS.DELETE_IMAGE,
                token,
                workspaceId,
                fileId: posterFileId,
                retryDelaysMs: DELETE_VIDEO_RETRY_DELAYS_MS,
            })
            if (!posterResult.success) {
                console.warn('[videoUtils] poster cleanup failed', { posterFileId, workspaceId, error: posterResult.error })
            }
        } catch (e) {
            // Poster cleanup is best-effort — if the underlying mp4 is gone the
            // orphan poster is harmless and will be reaped on workspace delete.
            console.warn('[videoUtils] poster cleanup failed', { posterFileId, workspaceId, error: e })
        }
    }
}
