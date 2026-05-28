'use strict'

import { v4 as uuid } from 'uuid'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import NATS_Service from '@lixpi/nats-service'
import { type DocumentFile } from '@lixpi/constants'
import { info, warn, err } from '@lixpi/debug-tools'

import Workspace from '../models/workspace.ts'

const getWorkspaceBucketName = (workspaceId: string): string =>
    `workspace-${workspaceId}-files`

export type StoreVideoInput = {
    workspaceId: string
    buffer: Buffer
    originalName?: string
    mimeType?: string
    useContentHash?: boolean
}

export type StoreVideoResult = {
    fileId: string
    url: string
    isDuplicate: boolean
    size: number
    mimeType: string
}

// Store a generated video (MP4) in the workspace NATS Object Store and register
// it in the workspace files array. Mirrors storeWorkspaceImage (same bucket,
// same SHA-256 content-hash dedup) but serves the bytes through the Range-capable
// video route rather than the image route.
export const storeWorkspaceVideo = async (input: StoreVideoInput): Promise<StoreVideoResult> => {
    const {
        workspaceId,
        buffer,
        originalName = 'generated-video.mp4',
        mimeType = 'video/mp4',
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
            info(`Duplicate video detected: ${fileId} (skipping upload)`)
            return {
                fileId,
                url: `/api/videos/${workspaceId}/${fileId}`,
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

        info(`Video stored: ${bucketName}/${fileId} (${buffer.length} bytes)${useContentHash ? ' [hash-based]' : ''}`)

        return {
            fileId,
            url: `/api/videos/${workspaceId}/${fileId}`,
            isDuplicate: false,
            size: buffer.length,
            mimeType,
        }
    } catch (e: any) {
        err(`storeWorkspaceVideo failed for workspace ${workspaceId}:`, e)
        throw e
    }
}

// Extract frame 0 of an MP4 as a PNG poster using ffmpeg. Best-effort: returns
// null if ffmpeg is unavailable or extraction fails, so video generation never
// fails just because a poster could not be produced. The PIXI media layer falls
// back to decoding the MP4 itself when no poster exists.
//
// ffmpeg needs a seekable input for reliable frame extraction (VEO MP4s are not
// guaranteed faststart), so the buffer is written to a temp file rather than
// piped through stdin.
export const extractPosterFrame = async (videoBuffer: Buffer): Promise<Buffer | null> => {
    let dir: string | undefined
    try {
        dir = await mkdtemp(join(tmpdir(), 'veo-poster-'))
        const inPath = join(dir, 'in.mp4')
        const outPath = join(dir, 'poster.png')
        await writeFile(inPath, videoBuffer)

        await new Promise<void>((resolve, reject) => {
            const ff = spawn('ffmpeg', [
                '-y',
                '-i', inPath,
                '-frames:v', '1',
                '-f', 'image2',
                '-c:v', 'png',
                outPath,
            ], { stdio: ['ignore', 'ignore', 'ignore'] })
            ff.on('error', reject)
            ff.on('close', (code) => {
                if (code === 0) resolve()
                else reject(new Error(`ffmpeg exited with code ${code}`))
            })
        })

        return await readFile(outPath)
    } catch (e: any) {
        warn(`extractPosterFrame failed (proceeding without poster): ${e?.message ?? e}`)
        return null
    } finally {
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
}
