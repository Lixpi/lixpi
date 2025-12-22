import { Plugin, PluginKey } from 'prosemirror-state'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { servicesStore } from '../../../../stores/servicesStore.ts'
import AuthService from '../../../../services/auth-service.ts'
import { NATS_SUBJECTS } from '@lixpi/constants'

const { WORKSPACE_IMAGE_SUBJECTS } = NATS_SUBJECTS

export const imageLifecyclePluginKey = new PluginKey('imageLifecycle')

type TrackedImage = {
    fileId: string
    workspaceId: string
}

function findImagesWithFileId(doc: ProseMirrorNode): Map<string, TrackedImage> {
    const images = new Map<string, TrackedImage>()

    doc.descendants((node) => {
        if (node.type.name === 'image' && node.attrs.fileId && node.attrs.workspaceId) {
            images.set(node.attrs.fileId, {
                fileId: node.attrs.fileId,
                workspaceId: node.attrs.workspaceId,
            })
        }
    })

    return images
}

async function deleteImage(fileId: string, workspaceId: string): Promise<void> {
    try {
        const nats = servicesStore.getData('nats')
        if (!nats) {
            console.error('[imageLifecyclePlugin] NATS service not available')
            return
        }

        const token = await AuthService.getTokenSilently()
        if (!token) {
            console.error('[imageLifecyclePlugin] Failed to get auth token')
            return
        }

        const result = await nats.request(WORKSPACE_IMAGE_SUBJECTS.DELETE_IMAGE, {
            token,
            workspaceId,
            fileId,
        })

        if (result?.error) {
            console.error(`[imageLifecyclePlugin] Failed to delete image ${fileId}:`, result.error)
        } else {
            console.log(`[imageLifecyclePlugin] Deleted image ${fileId} from workspace ${workspaceId}`)
        }
    } catch (error) {
        console.error(`[imageLifecyclePlugin] Error deleting image ${fileId}:`, error)
    }
}

export function imageLifecyclePlugin(): Plugin {
    return new Plugin({
        key: imageLifecyclePluginKey,

        state: {
            init(_, state) {
                return findImagesWithFileId(state.doc)
            },

            apply(tr, previousImages, _, newState) {
                if (!tr.docChanged) {
                    return previousImages
                }

                const currentImages = findImagesWithFileId(newState.doc)

                // Find images that were removed
                for (const [fileId, trackedImage] of previousImages) {
                    if (!currentImages.has(fileId)) {
                        // Image was removed, schedule deletion
                        // Use setTimeout to avoid blocking the transaction
                        setTimeout(() => {
                            deleteImage(fileId, trackedImage.workspaceId)
                        }, 0)
                    }
                }

                return currentImages
            },
        },
    })
}
