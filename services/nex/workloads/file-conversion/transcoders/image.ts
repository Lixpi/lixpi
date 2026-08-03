'use strict'

import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import sharp from 'sharp'

import { runProcess, withTempDir } from './run-process.ts'

export type TranscodeImageOptions = {
    unlimited?: boolean
    sourceMime?: string
}

// Decode HEIC/HEIF via the system libheif (`heif-convert`) instead of sharp.
// sharp's bundled libheif fails on common Apple HEIC variants (the `MiHB`/`MiHA`
// branded files iPhones produce) with "bad seek … Decoder plugin generated an
// error", while the system libheif decodes them reliably. heif-convert picks the
// output format from the file extension.
const heifConvert = async (buffer: Buffer, canonicalMime: string): Promise<Buffer> =>
    withTempDir('heif-convert-', async (dir) => {
        const ext = canonicalMime === 'image/png' ? 'png' : 'jpg'
        const inPath = join(dir, 'in.heic')
        const outPath = join(dir, `out.${ext}`)
        await writeFile(inPath, buffer)
        await runProcess('heif-convert', ['-q', '90', inPath, outPath], { timeoutMs: 120000 })
        return readFile(outPath)
    })

// Transcode an exotic image (HEIC/HEIF/AVIF/TIFF/SVG) to a model-safe canonical
// format. The target is driven by the policy table's `canonicalMime`, never by
// branching on the input format — so adding a new exotic format that maps to PNG
// or JPEG needs only a MEDIA_POLICY row, not a code change here.
export const transcodeImage = async (buffer: Buffer, canonicalMime: string, options: TranscodeImageOptions = {}): Promise<Buffer> => {
    // HEIC/HEIF take the system-libheif path (see heifConvert). HEIC/HEIF only
    // ever map to JPEG/PNG in MEDIA_POLICY, both of which heif-convert produces.
    if (options.sourceMime === 'image/heic' || options.sourceMime === 'image/heif') {
        return heifConvert(buffer, canonicalMime)
    }

    const pipeline = sharp(buffer, { failOn: 'none', ...(options.unlimited ? { unlimited: true } : {}) })
    switch (canonicalMime) {
        case 'image/png':
            return pipeline.png().toBuffer()
        case 'image/jpeg':
            return pipeline.jpeg({ quality: 90 }).toBuffer()
        case 'image/webp':
            return pipeline.webp({ quality: 90 }).toBuffer()
        default:
            throw new Error(`Unsupported image canonical mime: ${canonicalMime}`)
    }
}

// width / height of an image buffer, used for the canvas node's aspectRatio.
// Returns null when sharp cannot read the dimensions (the caller falls back to a
// default rather than failing the upload). The buffer here is always the
// model-safe canonical (JPEG/PNG/WebP), which sharp reads fine — only HEIC
// decoding is delegated above.
export const getImageAspectRatio = async (buffer: Buffer): Promise<number | null> => {
    try {
        const { width, height } = await sharp(buffer, { failOn: 'none' }).metadata()
        if (!width || !height) return null
        return width / height
    } catch {
        return null
    }
}

export const createImageRendition = async ({
    buffer,
    maxWidth,
    maxHeight,
    quality,
}: {
    buffer: Buffer
    maxWidth: number
    maxHeight: number
    quality: number
}): Promise<{ data: Buffer; width: number; height: number }> => {
    const { data, info } = await sharp(buffer, { failOn: 'none' })
        .rotate()
        .resize({
            width: maxWidth,
            height: maxHeight,
            fit: 'inside',
            withoutEnlargement: true,
        })
        .webp({ quality })
        .toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
}
