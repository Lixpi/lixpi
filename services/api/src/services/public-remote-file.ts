'use strict'

import path from 'node:path'

import { MAX_UPLOAD_FILE_SIZE } from '@lixpi/constants'

import { assertRemoteImageUrlIsPublic } from './remote-image-import.ts'

const MAX_REDIRECTS = 4
const FETCH_TIMEOUT_MS = 15000

const readBoundedBody = async (response: Response): Promise<Buffer> => {
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_UPLOAD_FILE_SIZE) throw new Error('Remote file is too large')
    if (!response.body) throw new Error('Remote file response has no body')
    const chunks: Uint8Array[] = []
    let totalLength = 0
    const reader = response.body.getReader()
    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue
        totalLength += value.length
        if (totalLength > MAX_UPLOAD_FILE_SIZE) {
            await reader.cancel()
            throw new Error('Remote file is too large')
        }
        chunks.push(value)
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalLength)
}

const getRemoteFileName = (url: URL): string => {
    const baseName = path.basename(decodeURIComponent(url.pathname))
    return baseName && baseName !== '/' && baseName.includes('.') ? baseName : 'remote-file'
}

export const fetchPublicRemoteFile = async (url: string): Promise<{ buffer: Buffer; originalName: string }> => {
    let currentUrl: URL
    try {
        currentUrl = new URL(url)
    } catch {
        throw new Error('Invalid file URL')
    }
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        await assertRemoteImageUrlIsPublic(currentUrl)
        const response = await fetch(currentUrl, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location')
            if (!location || redirectCount === MAX_REDIRECTS) throw new Error('Remote file redirected too many times')
            currentUrl = new URL(location, currentUrl)
            continue
        }
        if (!response.ok) throw new Error(`Remote file fetch failed with status ${response.status}`)
        return { buffer: await readBoundedBody(response), originalName: getRemoteFileName(currentUrl) }
    }
    throw new Error('Remote file import failed')
}
