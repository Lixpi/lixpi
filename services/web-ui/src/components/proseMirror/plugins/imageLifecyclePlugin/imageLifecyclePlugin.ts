import { Plugin, PluginKey } from 'prosemirror-state'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { deleteImage } from '../../../../utils/imageUtils.ts'

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
