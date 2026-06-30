'use strict'

import sharp from 'sharp'

// Transcode an exotic image (HEIC/HEIF/AVIF/TIFF/SVG) to a model-safe canonical
// format. The target is driven by the policy table's `canonicalMime`, never by
// branching on the input format — so adding a new exotic format that maps to PNG
// or JPEG needs only a MEDIA_POLICY row, not a code change here.
export const transcodeImage = async (buffer: Buffer, canonicalMime: string): Promise<Buffer> => {
    const pipeline = sharp(buffer, { failOn: 'none' })
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
// default rather than failing the upload).
export const getImageAspectRatio = async (buffer: Buffer): Promise<number | null> => {
    try {
        const { width, height } = await sharp(buffer, { failOn: 'none' }).metadata()
        if (!width || !height) return null
        return width / height
    } catch {
        return null
    }
}
