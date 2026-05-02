'use strict'

import { v4 as uuid } from 'uuid'
import { createHash } from 'node:crypto'

import NATS_Service from '@lixpi/nats-service'
import { type DocumentFile } from '@lixpi/constants'
import { info, err } from '@lixpi/debug-tools'

import Workspace from '../models/workspace.ts'

const getWorkspaceBucketName = (workspaceId: string): string =>
    `workspace-${workspaceId}-files`

export type StoreImageInput = {
    workspaceId: string
    buffer: Buffer
    originalName?: string
    mimeType?: string
    useContentHash?: boolean
}

export type StoreImageResult = {
    fileId: string
    url: string
    isDuplicate: boolean
    size: number
    mimeType: string
}

// Store an image in the workspace's NATS Object Store and register it in the
// workspace's files array. Supports SHA-256 content-hash deduplication for AI-
// generated images (so identical images aren't uploaded twice).
//
// Throws on workspace-not-found and storage failures.
export const storeWorkspaceImage = async (input: StoreImageInput): Promise<StoreImageResult> => {
    const {
        workspaceId,
        buffer,
        originalName = 'ai-generated-image.png',
        mimeType = 'image/png',
        useContentHash = false,
    } = input

    const workspace = await Workspace.getWorkspaceInternal({ workspaceId })
    if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`)
    }

    let fileId: string
    if (useContentHash) {
        const hash = createHash('sha256').update(buffer).digest('hex')
        fileId = `hash-${hash}`

        const existing = workspace.files?.find((f: DocumentFile) => f.id === fileId)
        if (existing) {
            info(`Duplicate image detected: ${fileId} (skipping upload)`)
            return {
                fileId,
                url: `/api/images/${workspaceId}/${fileId}`,
                isDuplicate: true,
                size: existing.size,
                mimeType: existing.mimeType,
            }
        }
    } else {
        fileId = uuid()
    }

    const natsService = NATS_Service.getInstance()
    if (!natsService) {
        throw new Error('NATS service unavailable')
    }

    const bucketName = getWorkspaceBucketName(workspaceId)

    try {
        await natsService.putObject(bucketName, fileId, buffer, {
            name: fileId,
            description: originalName,
        })

        const fileMetadata: DocumentFile = {
            id: fileId,
            name: originalName,
            mimeType,
            size: buffer.length,
            uploadedAt: Date.now(),
        }

        await Workspace.addFile({ workspaceId, file: fileMetadata })

        info(`Image stored: ${bucketName}/${fileId} (${buffer.length} bytes)${useContentHash ? ' [hash-based]' : ''}`)

        return {
            fileId,
            url: `/api/images/${workspaceId}/${fileId}`,
            isDuplicate: false,
            size: buffer.length,
            mimeType,
        }
    } catch (e: any) {
        err(`storeWorkspaceImage failed for workspace ${workspaceId}:`, e)
        throw e
    }
}
