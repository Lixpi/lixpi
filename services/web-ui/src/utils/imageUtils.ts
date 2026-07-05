import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'
import { NATS_SUBJECTS } from '@lixpi/constants'

const { IMAGE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS
const FILE_STILL_REFERENCED_BY_CANVAS = 'FILE_STILL_REFERENCED_BY_CANVAS'
const DELETE_IMAGE_RETRY_DELAYS_MS = [750, 2000, 5000]

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

export async function deleteImage(fileId: string, workspaceId: string): Promise<void> {
    try {
        const nats = servicesStore.getData('nats')
        if (!nats) {
            console.error('[imageUtils] NATS service not available')
            return
        }

        const token = await AuthService.getTokenSilently()
        if (!token) {
            console.error('[imageUtils] Failed to get auth token')
            return
        }

        for (let attempt = 0; attempt <= DELETE_IMAGE_RETRY_DELAYS_MS.length; attempt += 1) {
            const result = await nats.request(IMAGE_SUBJECTS.DELETE_IMAGE, {
                token,
                workspaceId,
                fileId,
            })

            if (result?.error === FILE_STILL_REFERENCED_BY_CANVAS && attempt < DELETE_IMAGE_RETRY_DELAYS_MS.length) {
                await wait(DELETE_IMAGE_RETRY_DELAYS_MS[attempt])
                continue
            }

            if (result?.error === FILE_STILL_REFERENCED_BY_CANVAS) {
                console.warn(`[imageUtils] Image ${fileId} is still referenced by canvas after cleanup retry.`)
                return
            }

            if (result?.error) {
                console.error(`[imageUtils] Failed to delete image ${fileId}:`, result.error)
            } else {
                console.log(`[imageUtils] Deleted image ${fileId} from workspace ${workspaceId}`)
            }
            return
        }
    } catch (error) {
        console.error(`[imageUtils] Error deleting image ${fileId}:`, error)
    }
}
