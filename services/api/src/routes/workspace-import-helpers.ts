'use strict'

import { type DocumentFile } from '@lixpi/constants'

type ImageCanvasNode = {
    type: 'image'
    fileId: string
    src?: string
    workspaceId?: string
    [key: string]: unknown
}

type CanvasNode = ImageCanvasNode | { type: string; [key: string]: unknown }

type ImageEntry = {
    fileId: string
    ext: string
}

// Collect all image fileIds referenced by canvas nodes that aren't
// already tracked in the files array. Returns the set of extra fileIds.
export function collectCanvasImageFileIds(
    canvasNodes: CanvasNode[],
    alreadyExported: Set<string>
): string[] {
    const extra: string[] = []
    for (const node of canvasNodes) {
        if (node.type !== 'image' || !('fileId' in node) || !node.fileId) continue
        if (alreadyExported.has(node.fileId as string)) continue
        extra.push(node.fileId as string)
    }
    return extra
}

// Ensure every imported image has a corresponding DocumentFile entry.
// Mutates files array in place, returns the number of entries added.
export function reconcileFilesWithImages(
    files: DocumentFile[],
    imageEntries: ImageEntry[]
): number {
    const fileIdSet = new Set(files.map((f: DocumentFile) => f.id))
    let added = 0
    const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.avif': 'image/avif',
    }
    for (const image of imageEntries) {
        if (!fileIdSet.has(image.fileId)) {
            files.push({
                id: image.fileId,
                name: `${image.fileId}${image.ext}`,
                mimeType: mimeMap[image.ext] || 'image/png',
            })
            fileIdSet.add(image.fileId)
            added++
        }
    }
    return added
}

// Rewrite image canvas node src and workspaceId to point at the
// target workspace. Returns the number of nodes rewritten.
export function rewriteCanvasImageNodes(
    nodes: CanvasNode[],
    targetWorkspaceId: string
): number {
    let rewritten = 0
    for (const node of nodes) {
        if (node.type === 'image' && 'fileId' in node && node.fileId) {
            const imgNode = node as ImageCanvasNode
            imgNode.src = `/api/images/${targetWorkspaceId}/${imgNode.fileId}`
            imgNode.workspaceId = targetWorkspaceId
            rewritten++
        }
    }
    return rewritten
}
