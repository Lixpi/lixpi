'use strict'

import { v4 as uuid } from 'uuid'
import { createHash } from 'node:crypto'

import NATS_Service from '@lixpi/nats-service'
import { type DocumentFile, type MediaKind } from '@lixpi/constants'
import { info, warn, err } from '@lixpi/debug-tools'

import Workspace from '../models/workspace.ts'

const getWorkspaceBucketName = (workspaceId: string): string =>
    `workspace-${workspaceId}-files`

// Kind-agnostic store of an uploaded or generated file. Always stores the
// original; when `canonical` is supplied (the modelSafe === false case) it also
// stores the transcoded derivative under `{fileId}-canonical` and records the
// pointer on the file record. Carries over the SHA-256 content-hash dedup and
// dangling-object self-heal from the retired image/video storage services.
export type StoreFileInput = {
    workspaceId: string
    buffer: Buffer
    originalName: string
    mimeType: string            // sniffed mime of the original
    kind: MediaKind
    modelSafe: boolean
    canonical?: {
        buffer: Buffer
        mimeType: string
    }
    useContentHash?: boolean
}

export type StoreFileResult = {
    fileId: string
    url: string
    isDuplicate: boolean
    size: number
    mimeType: string
    kind: MediaKind
    modelSafe: boolean
    canonicalFileId?: string
    canonicalMimeType?: string
}

export const storeWorkspaceFile = async (input: StoreFileInput): Promise<StoreFileResult> => {
    const {
        workspaceId,
        buffer,
        originalName,
        mimeType,
        kind,
        modelSafe,
        canonical,
        useContentHash = false,
    } = input

    const workspace = await Workspace.getWorkspaceInternal({ workspaceId })
    if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`)
    }

    const natsService = NATS_Service.getInstance()
    if (!natsService) {
        throw new Error('NATS service unavailable')
    }

    const bucketName = getWorkspaceBucketName(workspaceId)

    let fileId: string
    if (useContentHash) {
        const hash = createHash('sha256').update(buffer).digest('hex')
        fileId = `hash-${hash}`

        const existing = workspace.files?.find((f: DocumentFile) => f.id === fileId)
        if (existing) {
            // Only short-circuit as a duplicate if the bytes are ACTUALLY still in
            // storage. If the object is gone, fall through and re-store it so the
            // dangling reference self-heals instead of staying permanently broken.
            const storedInfo = await natsService.getObjectInfo(bucketName, fileId).catch(() => null)
            if (storedInfo && !storedInfo.deleted) {
                info(`Duplicate file detected: ${fileId} (skipping upload)`)
                return {
                    fileId,
                    url: `/api/files/${workspaceId}/${fileId}`,
                    isDuplicate: true,
                    size: existing.size,
                    mimeType: existing.mimeType,
                    kind: existing.kind,
                    modelSafe: existing.modelSafe,
                    canonicalFileId: existing.canonicalFileId,
                    canonicalMimeType: existing.canonicalMimeType,
                }
            }
            warn(`Hash ${fileId} is registered in workspace ${workspaceId} but its bytes are missing from storage — re-storing`)
        }
    } else {
        fileId = uuid()
    }

    try {
        await natsService.putObject(bucketName, fileId, buffer, {
            name: fileId,
            description: originalName,
        })

        let canonicalFileId: string | undefined
        let canonicalMimeType: string | undefined
        if (canonical) {
            canonicalFileId = `${fileId}-canonical`
            canonicalMimeType = canonical.mimeType
            await natsService.putObject(bucketName, canonicalFileId, canonical.buffer, {
                name: canonicalFileId,
                description: `${originalName} (canonical)`,
            })
        }

        const fileMetadata: DocumentFile = {
            id: fileId,
            name: originalName,
            mimeType,
            size: buffer.length,
            uploadedAt: Date.now(),
            kind,
            modelSafe,
            ...(canonicalFileId ? { canonicalFileId, canonicalMimeType } : {}),
        }

        await Workspace.addFile({ workspaceId, file: fileMetadata })

        info(`File stored: ${bucketName}/${fileId} (${buffer.length} bytes, kind=${kind})${canonicalFileId ? ` + canonical ${canonicalFileId}` : ''}${useContentHash ? ' [hash-based]' : ''}`)

        return {
            fileId,
            url: `/api/files/${workspaceId}/${fileId}`,
            isDuplicate: false,
            size: buffer.length,
            mimeType,
            kind,
            modelSafe,
            canonicalFileId,
            canonicalMimeType,
        }
    } catch (e: any) {
        err(`storeWorkspaceFile failed for workspace ${workspaceId}:`, e)
        throw e
    }
}
