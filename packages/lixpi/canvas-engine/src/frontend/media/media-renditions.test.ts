import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    mipmappedImageBytes,
    selectImageRendition,
} from './media-renditions.ts'
import {
    type MediaDescriptor,
} from './types.ts'

describe('image rendition selection', () => {
    const media: MediaDescriptor = {
        key: 'image',
        kind: 'image',
        version: '1',
        renditions: [
            { id: 'medium', width: 512, height: 256, mimeType: 'image/png' },
            { id: 'small', width: 128, height: 64, mimeType: 'image/png' },
            { id: 'full', width: 2048, height: 1024, mimeType: 'image/png' },
        ],
    }

    it('chooses the smallest declared rendition that covers both dimensions', () => {
        expect(selectImageRendition(media, { width: 100, height: 100 }).id).toBe('medium')
        expect(selectImageRendition(media, { width: 5000, height: 2500 }).id).toBe('full')
        expect(media.renditions[0].id).toBe('medium')
    })

    it('rejects unavailable image renditions without inventing a source', () => {
        expect(() => selectImageRendition({ ...media, renditions: [] }, { width: 100, height: 100 })).toThrow('no image rendition')
        expect(() => selectImageRendition(media, { width: NaN, height: 1 })).toThrow('positive')
    })

    it('includes every mip level in the cache estimate', () => {
        expect(mipmappedImageBytes({ width: 4, height: 2 })).toBe((8 + 2 + 1) * 4)
    })
})
