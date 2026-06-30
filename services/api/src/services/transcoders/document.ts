'use strict'

import { writeFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { warn } from '@lixpi/debug-tools'

import { runProcess, withTempDir } from './run-process.ts'

// Convert an office/exotic document (DOC, DOCX, PPT, PPTX, ODT, RTF, …) to PDF
// via LibreOffice headless. PDF preserves layout AND embedded imagery — the form
// a vision model recognizes best — rather than flattening to plain text. Plain
// text and Markdown are already model-safe and never reach this transcoder.
//
// soffice writes the converted file into the output dir using the input's base
// name with a .pdf extension; we read whichever .pdf it produced rather than
// guessing the name.
export const convertDocumentToPdf = async (buffer: Buffer, originalName: string): Promise<Buffer> =>
    withTempDir('doc-convert-', async (dir) => {
        const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'document'
        const inPath = join(dir, safeName)
        const outDir = join(dir, 'out')
        await writeFile(inPath, buffer)

        await runProcess('soffice', [
            '--headless', '--norestore', '--nologo',
            '--convert-to', 'pdf',
            '--outdir', outDir,
            inPath,
        ], { timeoutMs: 120_000 })

        const produced = (await readdir(outDir)).find((name) => name.toLowerCase().endsWith('.pdf'))
        if (!produced) {
            throw new Error('LibreOffice produced no PDF output')
        }
        return readFile(join(outDir, produced))
    })

// Render the first page of a PDF to a PNG poster via poppler's pdftoppm. Best-
// effort — returns null when poppler is unavailable or rendering fails, so a
// document upload never fails solely because a thumbnail could not be produced.
export const renderPdfFirstPagePoster = async (pdfBuffer: Buffer): Promise<Buffer | null> => {
    try {
        return await withTempDir('pdf-poster-', async (dir) => {
            const inPath = join(dir, 'in.pdf')
            const outPrefix = join(dir, 'poster')
            await writeFile(inPath, pdfBuffer)

            await runProcess('pdftoppm', [
                '-png', '-f', '1', '-l', '1', '-singlefile', '-scale-to', '1024',
                inPath, outPrefix,
            ], { timeoutMs: 60_000 })

            return readFile(`${outPrefix}.png`)
        })
    } catch (e: any) {
        warn(`renderPdfFirstPagePoster failed (proceeding without poster): ${e?.message ?? e}`)
        return null
    }
}

// Page count of a PDF via poppler's pdfinfo. Best-effort — returns null when
// poppler is unavailable or the count can't be parsed.
export const getPdfPageCount = async (pdfBuffer: Buffer): Promise<number | null> => {
    try {
        return await withTempDir('pdf-info-', async (dir) => {
            const inPath = join(dir, 'in.pdf')
            const outPath = join(dir, 'info.txt')
            await writeFile(inPath, pdfBuffer)
            await runProcess('sh', ['-c', `pdfinfo "${inPath}" > "${outPath}"`], { timeoutMs: 30_000 })

            const info = await readFile(outPath, 'utf-8')
            const match = /^Pages:\s+(\d+)/m.exec(info)
            return match ? Number(match[1]) : null
        })
    } catch (e: any) {
        warn(`getPdfPageCount failed (proceeding without page count): ${e?.message ?? e}`)
        return null
    }
}
