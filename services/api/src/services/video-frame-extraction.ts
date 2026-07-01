'use strict'

import { v4 as uuid } from 'uuid'

import NATS_Service from '@lixpi/nats-service'
import { NATS_SUBJECTS, type ExtractFramesRequest, type ExtractFramesResult } from '@lixpi/constants'
import { warn } from '@lixpi/debug-tools'

const { FILE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

const getWorkspaceBucketName = (workspaceId: string): string => `workspace-${workspaceId}-files`

// Frame extraction is heavy ffmpeg work and must not run on the API. This stages
// the freshly generated video to a temp Object Store key, asks the NEX
// file-conversion workload to extract the poster + representative frame, reads
// them back, and deletes every temp object it touched.
//
// Best-effort by design (matches the old in-process extractors): on any failure
// it returns null buffers and the caller proceeds without a poster/anchor frame,
// exactly as before — a video generation never fails solely because frames could
// not be produced.
export const extractVideoFramesViaWorkload = async ({
    workspaceId,
    videoBuffer,
    atSeconds,
}: {
    workspaceId: string
    videoBuffer: Buffer
    atSeconds?: number
}): Promise<{ posterBuffer: Buffer | null; frameBuffer: Buffer | null }> => {
    const empty = { posterBuffer: null, frameBuffer: null }

    const natsService = NATS_Service.getInstance()
    if (!natsService) {
        warn('extractVideoFramesViaWorkload: NATS service unavailable; proceeding without frames')
        return empty
    }

    const bucketName = getWorkspaceBucketName(workspaceId)
    const videoFileId = `tmp-frames-${uuid()}`
    const tempObjectIds: string[] = [videoFileId]

    try {
        await natsService.putObject(bucketName, videoFileId, videoBuffer, { name: videoFileId })

        const result = await natsService.request<ExtractFramesRequest, ExtractFramesResult>(
            FILE_SUBJECTS.EXTRACT_FRAMES,
            { workspaceId, videoFileId, atSeconds },
            120_000,
        )

        if (!result.success) {
            warn(`extractVideoFramesViaWorkload: workload reported failure: ${result.error}`)
            return empty
        }

        let posterBuffer: Buffer | null = null
        let frameBuffer: Buffer | null = null
        if (result.posterFileId) {
            tempObjectIds.push(result.posterFileId)
            const data = await natsService.getObject(bucketName, result.posterFileId)
            posterBuffer = data ? Buffer.from(data) : null
        }
        if (result.frameFileId) {
            tempObjectIds.push(result.frameFileId)
            const data = await natsService.getObject(bucketName, result.frameFileId)
            frameBuffer = data ? Buffer.from(data) : null
        }
        return { posterBuffer, frameBuffer }
    } catch (e: any) {
        warn(`extractVideoFramesViaWorkload failed (proceeding without frames): ${e?.message ?? e}`)
        return empty
    } finally {
        for (const id of tempObjectIds) {
            await natsService.deleteObject(bucketName, id).catch(() => {})
        }
    }
}
