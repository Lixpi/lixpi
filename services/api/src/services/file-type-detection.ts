'use strict'

import { fileTypeFromBuffer } from 'file-type'

import {
    MEDIA_POLICY,
    UPLOAD_DENYLIST_MIME,
    type MediaKind,
} from '@lixpi/constants'

// Outcome of resolving an uploaded buffer against the media policy. The bytes are
// the source of truth — the browser-supplied MIME and the filename extension are
// advisory only and never authoritative.
export type FileTypeResolution =
    | {
          rejected: false
          mimeType: string       // sniffed mime of the original
          kind: MediaKind
          modelSafe: boolean
          canonicalMime: string  // transcode target (== mimeType when modelSafe)
      }
    | {
          rejected: true
          reason: string         // user-facing rejection message
      }

// Human-readable rejection messages keyed by deny-list class. Lets the route
// tell the user WHY a file was refused rather than a generic "unsupported".
const EXECUTABLE_MIME = new Set([
    'application/x-msdownload', 'application/x-executable', 'application/x-mach-binary',
    'application/x-elf', 'application/vnd.microsoft.portable-executable', 'application/x-msi',
])
const SCRIPT_MIME = new Set(['application/x-sh', 'application/x-shellscript', 'text/x-shellscript'])
const ARCHIVE_MIME = new Set([
    'application/zip', 'application/x-tar', 'application/gzip',
    'application/x-rar-compressed', 'application/x-7z-compressed',
    'application/java-archive', 'application/x-apple-diskimage',
])

const denyReasonFor = (mime: string): string => {
    if (EXECUTABLE_MIME.has(mime)) return 'Executable files are not permitted.'
    if (SCRIPT_MIME.has(mime)) return 'Script files are not permitted.'
    if (ARCHIVE_MIME.has(mime)) return 'Archive files are not permitted.'
    if (mime.includes('macroEnabled')) return 'Macro-enabled office files are not permitted.'
    return 'This file type is not permitted.'
}

// `file-type` deliberately does not sniff plain text, Markdown, SVG, or CSV (they
// have no reliable magic bytes). This thin textual check runs only when the binary
// sniff returns nothing, so a renamed binary can never reach it. It validates the
// buffer is real UTF-8 text first, then classifies SVG vs. Markdown vs. plain text.
const looksLikeUtf8Text = (buffer: Buffer): boolean => {
    // Reject NUL bytes outright — they never appear in the textual formats we
    // accept and are a strong signal of binary content.
    const sample = buffer.subarray(0, 4096)
    if (sample.includes(0)) return false
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(sample)
        return true
    } catch {
        return false
    }
}

const detectTextualMime = (buffer: Buffer, declaredName?: string): string | undefined => {
    if (!looksLikeUtf8Text(buffer)) return undefined

    const head = buffer.subarray(0, 4096).toString('utf-8').trimStart()
    const lowerHead = head.toLowerCase()

    // SVG is XML with an <svg> root, possibly behind an XML/doctype prolog.
    if (lowerHead.startsWith('<?xml') || lowerHead.startsWith('<svg') || lowerHead.startsWith('<!doctype svg')) {
        if (lowerHead.includes('<svg')) return 'image/svg+xml'
    }

    const ext = declaredName?.toLowerCase().split('.').at(-1) ?? ''
    if (ext === 'md' || ext === 'markdown') return 'text/markdown'
    return 'text/plain'
}

// Sniff the real type of an uploaded buffer and resolve it against the media
// policy. Deny-list is checked first (specific error), then the allow-list
// (MEDIA_POLICY); a MIME with no allow-list entry is rejected.
export const detectFileType = async (buffer: Buffer, declaredName?: string): Promise<FileTypeResolution> => {
    if (buffer.length === 0) {
        return { rejected: true, reason: 'The uploaded file is empty.' }
    }

    const sniffed = await fileTypeFromBuffer(buffer)
    const mimeType = sniffed?.mime ?? detectTextualMime(buffer, declaredName)

    if (!mimeType) {
        return { rejected: true, reason: 'Could not recognize this file type.' }
    }

    if (UPLOAD_DENYLIST_MIME.includes(mimeType)) {
        return { rejected: true, reason: denyReasonFor(mimeType) }
    }

    const policy = MEDIA_POLICY[mimeType]
    if (!policy) {
        return { rejected: true, reason: `Files of type "${mimeType}" are not supported.` }
    }

    return {
        rejected: false,
        mimeType,
        kind: policy.kind,
        modelSafe: policy.modelSafe,
        canonicalMime: policy.canonicalMime,
    }
}
