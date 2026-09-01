import { join } from 'node:path'
import {
    mkdir,
    writeFile,
} from 'node:fs/promises'
import {
    describe,
    it,
    expect,
    beforeEach,
    vi,
} from 'vitest'

import {
    convertDocumentToPdf,
    renderPdfFirstPagePoster,
    getPdfPageCount,
} from './document.ts'

const runProcessMock = vi.fn()

vi.mock('@lixpi/debug-tools', () => ({
    warn: () => undefined,
}))

vi.mock('./run-process.ts', async () => {
    const actual = await vi.importActual<typeof import('./run-process.ts')>('./run-process.ts')
    return {
        ...actual,
        runProcess: (...args: Parameters<typeof runProcessMock>) => runProcessMock(...args),
    }
})

const extractShOutputPath = (command: string): string => {
    const match = />\s+"([^"]+)"$/.exec(command)
    if (!match) {
        throw new Error(`cannot parse sh output path: ${command}`)
    }
    return match[1]
}

beforeEach(() => {
    runProcessMock.mockReset()
})

describe('convertDocumentToPdf', () => {
    it('stores the generated PDF that soffice writes into the output directory', async () => {
        runProcessMock.mockImplementation(async (_command, args) => {
            const outDir = args[args.indexOf('--outdir') + 1]
            await mkdir(outDir, { recursive: true })
            const pdfPath = join(outDir, 'report.pdf')
            await writeFile(pdfPath, Buffer.from('%PDF-1.4'))
        })

        const pdf = await convertDocumentToPdf(Buffer.from('doc-bytes'), 'report.docx')
        expect(Buffer.isBuffer(pdf)).toBe(true)
        expect(pdf.toString()).toBe('%PDF-1.4')
        expect(runProcessMock).toHaveBeenCalledWith(
            'soffice',
            expect.arrayContaining(['--headless', '--convert-to', 'pdf', '--outdir']),
            { timeoutMs: 120000 },
        )
    })

    it('throws when no PDF output is produced', async () => {
        runProcessMock.mockImplementation(async (_command, args) => {
            const outDir = args[args.indexOf('--outdir') + 1]
            await mkdir(outDir, { recursive: true })
        })
        await expect(convertDocumentToPdf(Buffer.from('doc-bytes'), 'report.docx')).rejects
            .toThrow('LibreOffice produced no PDF output')
    })
})

describe('renderPdfFirstPagePoster', () => {
    it('renders a first-page PNG poster when poppler succeeds', async () => {
        runProcessMock.mockImplementation(async (_command, args) => {
            const prefix = args.at(-1)
            await writeFile(`${prefix}.png`, Buffer.from('poster'))
        })

        const poster = await renderPdfFirstPagePoster(Buffer.from('%PDF-1.4'))
        expect(poster).not.toBeNull()
        expect(poster?.toString()).toBe('poster')
        expect(runProcessMock).toHaveBeenCalledWith(
            'pdftocairo',
            ['-png', '-f', '1', '-l', '1', '-singlefile', '-scale-to', '1024', expect.any(String), expect.any(String)],
            { timeoutMs: 60000 },
        )
    })

    it('returns null when renderer fails', async () => {
        runProcessMock.mockRejectedValue(new Error('pdftocairo missing'))
        const poster = await renderPdfFirstPagePoster(Buffer.from('%PDF-1.4'))
        expect(poster).toBeNull()
    })
})

describe('getPdfPageCount', () => {
    it('reads Pages from pdfinfo output', async () => {
        runProcessMock.mockImplementation(async (_command, args) => {
            const outPath = extractShOutputPath(args[1])
            await writeFile(outPath, 'Producer: x\nPages: 17\nSubject: y')
        })

        const pageCount = await getPdfPageCount(Buffer.from('%PDF-1.4'))
        expect(pageCount).toBe(17)
    })

    it('returns null on malformed pdfinfo output', async () => {
        runProcessMock.mockImplementation(async (_command, args) => {
            const outPath = extractShOutputPath(args[1])
            await writeFile(outPath, 'Producer: x\nNoPages: no')
        })
        expect(await getPdfPageCount(Buffer.from('%PDF-1.4'))).toBeNull()
    })

    it('returns null when extractor fails', async () => {
        runProcessMock.mockRejectedValue(new Error('pdfinfo missing'))
        expect(await getPdfPageCount(Buffer.from('%PDF-1.4'))).toBeNull()
    })
})
