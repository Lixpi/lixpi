import { writeFile } from 'node:fs/promises'
import {
    describe,
    it,
    expect,
    beforeEach,
    vi,
} from 'vitest'
import sharp from 'sharp'

import {
    transcodeImage,
    getImageAspectRatio,
} from './image.ts'

const runProcessMock = vi.fn()

vi.mock('./run-process.ts', async () => {
    const actual = await vi.importActual<typeof import('./run-process.ts')>('./run-process.ts')
    return {
        ...actual,
        runProcess: (...args: Parameters<typeof runProcessMock>) => runProcessMock(...args),
    }
})

beforeEach(() => {
    runProcessMock.mockReset()
})

describe('transcodeImage', () => {
    it('transcodes to PNG from an in-memory source', async () => {
        const input = await sharp({
            create: { width: 3, height: 1, channels: 3, background: { r: 80, g: 90, b: 100 } },
        }).jpeg().toBuffer()
        const output = await transcodeImage(input, 'image/png')
        const meta = await sharp(output).metadata()
        expect(meta.format).toBe('png')
    })

    it('transcodes to JPEG with quality settings', async () => {
        const input = await sharp({
            create: { width: 2, height: 2, channels: 3, background: { r: 120, g: 130, b: 140 } },
        }).png().toBuffer()
        const output = await transcodeImage(input, 'image/jpeg', { unlimited: true })
        const meta = await sharp(output).metadata()
        expect(meta.format).toBe('jpeg')
    })

    it('transcodes to WebP', async () => {
        const input = await sharp({
            create: { width: 2, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
        }).png().toBuffer()
        const output = await transcodeImage(input, 'image/webp')
        const meta = await sharp(output).metadata()
        expect(meta.format).toBe('webp')
    })

    it('uses heif-convert for HEIC/HEIF and returns the decoded bytes', async () => {
        runProcessMock.mockImplementation(async (_command, args) => {
            const outPath = args[3]
            await writeFile(outPath, Buffer.from('converted-heif'))
        })

        const output = await transcodeImage(Buffer.from('heic-bytes'), 'image/jpeg', {
            sourceMime: 'image/heic',
        })

        expect(runProcessMock).toHaveBeenCalledWith(
            'heif-convert',
            ['-q', '90', expect.stringContaining('in.heic'), expect.stringContaining('out.jpg')],
            { timeoutMs: 120000 },
        )
        expect(output.toString()).toBe('converted-heif')
    })

    it('throws on unsupported canonical mime', async () => {
        const input = await sharp({
            create: { width: 1, height: 1, channels: 3, background: { r: 1, g: 2, b: 3 } },
        }).png().toBuffer()
        await expect(transcodeImage(input, 'image/bmp')).rejects.toThrow('Unsupported image canonical mime: image/bmp')
    })
})

describe('getImageAspectRatio', () => {
    it('returns width / height for valid image bytes', async () => {
        const input = await sharp({
            create: { width: 12, height: 6, channels: 3, background: { r: 11, g: 22, b: 33 } },
        }).png().toBuffer()
        const ratio = await getImageAspectRatio(input)
        expect(ratio).toBe(2)
    })

    it('returns null for malformed image buffers', async () => {
        const ratio = await getImageAspectRatio(Buffer.from('not-an-image'))
        expect(ratio).toBeNull()
    })
})
