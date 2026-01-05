import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'
import { NATS_SUBJECTS } from '@lixpi/constants'

const { IMAGE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

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

        const result = await nats.request(IMAGE_SUBJECTS.DELETE_IMAGE, {
            token,
            workspaceId,
            fileId,
        })

        if (result?.error) {
            console.error(`[imageUtils] Failed to delete image ${fileId}:`, result.error)
        } else {
            console.log(`[imageUtils] Deleted image ${fileId} from workspace ${workspaceId}`)
        }
    } catch (error) {
        console.error(`[imageUtils] Error deleting image ${fileId}:`, error)
    }
}
