'use strict'

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import path from 'node:path'

import sharp from 'sharp'

import {
    ALLOWED_IMAGE_MIME_TYPES,
    MAX_IMAGE_FILE_SIZE,
} from '@lixpi/constants'

import {
    storeWorkspaceImage,
    type StoreImageResult,
} from './image-storage.ts'

const MAX_REDIRECTS = 4
const FETCH_TIMEOUT_MS = 15_000

const isPrivateIPv4 = (address: string): boolean => {
    const octets = address.split('.').map(Number)
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true
    const [first, second] = octets
    return first === 0
        || first === 10
        || first === 127
        || (first === 169 && second === 254)
        || (first === 172 && second! >= 16 && second! <= 31)
        || (first === 192 && second === 168)
        || (first === 100 && second! >= 64 && second! <= 127)
        || first! >= 224
}

export const isPrivateNetworkAddress = (address: string): boolean => {
    const normalized = address.toLowerCase()
    if (isIP(normalized) === 4) return isPrivateIPv4(normalized)
    if (normalized === '::' || normalized === '::1') return true
    if (normalized.startsWith('::ffff:')) return isPrivateIPv4(normalized.substring(7))
    return normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe8')
        || normalized.startsWith('fe9')
        || normalized.startsWith('fea')
        || normalized.startsWith('feb')
}

export const assertRemoteImageUrlIsPublic = async (url: URL): Promise<void> => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Only public HTTP or HTTPS image URLs are supported')
    }
    if (url.username || url.password) {
        throw new Error('Remote image URL credentials are not allowed')
    }
    const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '')
    if (hostname.toLowerCase() === 'localhost') {
        throw new Error('Private network image URLs are not allowed')
    }

    const addresses = isIP(hostname)
        ? [{ address: hostname }]
        : await lookup(hostname, { all: true, verbatim: true })
    if (!addresses.length || addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
        throw new Error('Private network image URLs are not allowed')
    }
}

const readBoundedBody = async (response: Response): Promise<Buffer> => {
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_IMAGE_FILE_SIZE) {
        throw new Error('Remote image is too large')
    }
    if (!response.body) {
        throw new Error('Remote image response has no body')
    }

    const chunks: Uint8Array[] = []
    let totalLength = 0
    const reader = response.body.getReader()
    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue
        totalLength += value.length
        if (totalLength > MAX_IMAGE_FILE_SIZE) {
            await reader.cancel()
            throw new Error('Remote image is too large')
        }
        chunks.push(value)
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalLength)
}

const getRemoteFileName = (url: URL, mimeType: string): string => {
    const baseName = path.basename(decodeURIComponent(url.pathname))
    if (baseName && baseName !== '/' && baseName.includes('.')) return baseName
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.substring('image/'.length).replace('+xml', '')
    return `remote-image.${extension}`
}

export const importRemoteImageToWorkspace = async ({
    workspaceId,
    imageUrl,
}: {
    workspaceId: string
    imageUrl: string
}): Promise<StoreImageResult> => {
    let currentUrl: URL
    try {
        currentUrl = new URL(imageUrl)
    } catch {
        throw new Error('Invalid image URL')
    }

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        await assertRemoteImageUrlIsPublic(currentUrl)
        const response = await fetch(currentUrl, {
            redirect: 'manual',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })

        if (response.status >= 300 && response.status < 400) {
            const redirectLocation = response.headers.get('location')
            if (!redirectLocation || redirectCount === MAX_REDIRECTS) {
                throw new Error('Remote image redirected too many times')
            }
            currentUrl = new URL(redirectLocation, currentUrl)
            continue
        }
        if (!response.ok) {
            throw new Error(`Remote image fetch failed with status ${response.status}`)
        }

        const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
        if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
            throw new Error('Remote URL did not return a supported image type')
        }
        const buffer = await readBoundedBody(response)
        const metadata = await sharp(buffer).metadata()
        if (!metadata.width || !metadata.height) {
            throw new Error('Remote URL did not return a valid image')
        }
        return storeWorkspaceImage({
            workspaceId,
            buffer,
            originalName: getRemoteFileName(currentUrl, mimeType),
            mimeType,
        })
    }

    throw new Error('Remote image import failed')
}
