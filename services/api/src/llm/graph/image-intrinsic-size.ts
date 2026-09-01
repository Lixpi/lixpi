'use strict'

// Intrinsic pixel size read straight from the PNG IHDR / JPEG SOF header bytes
// without an image-library dependency.
export function readImageIntrinsicSize(buffer: Buffer): { width: number; height: number } | null {
    if (
        buffer.length >= 24
        && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    ) {
        const width = buffer.readUInt32BE(16)
        const height = buffer.readUInt32BE(20)
        return width > 0 && height > 0 ? { width, height } : null
    }

    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
        let offset = 2
        while (offset + 9 < buffer.length) {
            if (buffer[offset] !== 0xff) {
                offset += 1
                continue
            }
            const marker = buffer[offset + 1]!
            if (marker === 0xff) {
                offset += 1
                continue
            }
            const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf
                && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
            if (isStartOfFrame) {
                const height = buffer.readUInt16BE(offset + 5)
                const width = buffer.readUInt16BE(offset + 7)
                return width > 0 && height > 0 ? { width, height } : null
            }
            const segmentLength = buffer.readUInt16BE(offset + 2)
            if (segmentLength < 2) return null
            offset += 2 + segmentLength
        }
    }

    return null
}
