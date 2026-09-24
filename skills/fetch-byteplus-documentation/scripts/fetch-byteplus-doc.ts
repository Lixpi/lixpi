#!/usr/bin/env node
// Fetch a BytePlus documentation page as Markdown.
//
// docs.byteplus.com is a Modern.js app. A plain fetch usually looks like it only serves JavaScript,
// which is why agents give up on these pages. It doesn't: the server-rendered HTML embeds the whole
// document, including the exact Markdown the page's "copy as Markdown" button puts on the clipboard,
// inside a `window._ROUTER_DATA = {...}` script tag as `curDoc.MDContent`.
//
// The catch is that the same URL answers in two shapes. Most requests return the ~80KB
// server-rendered page carrying _ROUTER_DATA; some return a ~10KB client-side-rendered shell with no
// document data at all, and which shape you get is not a property of the URL. That is the whole
// reason this needs a retry loop rather than a one-shot fetch. Browser-like Accept and
// Accept-Language headers make the server-rendered shape far more likely.
//
// Runs under Node's native type stripping, so every construct here is erasable syntax: no enums, no
// namespaces, no parameter properties, and type-only imports written as `import type`. There is no
// tsconfig and no build step, and adding either would break the "just run the file" contract.
//
// Must run inside the lixpi-utils container. See ${LIXPI_REPOSITORY_PATH}/documentation/development-workflow/SKILL-EXECUTION-GUIDE.md.

import { writeFile } from 'node:fs/promises'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const DEFAULT_ATTEMPTS = 5
const RETRY_BASE_MS = 400

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

// The subset of BytePlus's curDoc payload this script reads. Their route data carries a good deal
// more (SeoConfig, PDFURL, a Quill delta in Content); none of it is needed to render Markdown.
export type BytePlusDoc = {
    Title: string
    MDContent: string
    DocumentCode: string
    LibraryCode: string
    UpdatedTime?: string
}

export type RouterData = {
    loaderData?: Record<string, unknown>
}

export type DocTarget = {
    lib: string
    code: string
    fragment: string | null
    url: string
}

export type Heading = {
    level: number
    text: string
    anchor: string
    anchors: string[]
}

export type Options = {
    targets: string[]
    out: string | null
    attempts: number
    metadata: boolean
    section: string | null
    listSections: boolean
    help: boolean
}

// ---------------------------------------------------------------------------
// ARGUMENTS
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): Options {
    const opts: Options = {
        targets: [],
        out: null,
        attempts: DEFAULT_ATTEMPTS,
        metadata: true,
        section: null,
        listSections: false,
        help: false,
    }

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]

        switch (arg) {
            case '--out':
            case '-o':
                opts.out = argv[++i]
                break
            case '--attempts':
                opts.attempts = Number(argv[++i])
                break
            case '--section':
                opts.section = argv[++i]
                break
            case '--list-sections':
                opts.listSections = true
                break
            case '--no-metadata':
                opts.metadata = false
                break
            case '--help':
            case '-h':
                opts.help = true
                break
            default:
                if (arg.startsWith('-')) throw new Error(`Unknown flag: ${arg}`)
                opts.targets.push(arg)
        }
    }

    return opts
}

const HELP = `Fetch BytePlus documentation as Markdown.

Usage:
  fetch-byteplus-doc.ts <url-or-doc-ref> [more refs...] [options]

A reference is either a full docs.byteplus.com URL or a "Library/DocCode" pair such as
ModelArk/2377608. Query strings and #anchors are accepted and ignored for fetching; an #anchor is
used as --section when you pass no explicit one.

Options:
  -o, --out FILE       Write to FILE instead of stdout (one file per doc if several refs are
                       given, suffixed with the doc code).
      --section ID     Print only the section under that heading anchor.
      --list-sections  Print the heading outline instead of the body.
      --attempts N     Fetch attempts per doc before failing (default ${DEFAULT_ATTEMPTS}).
      --no-metadata    Omit the title/URL/updated-at header block.
  -h, --help           Show this help.
`

// ---------------------------------------------------------------------------
// URL HANDLING
// ---------------------------------------------------------------------------

// Accepts a full URL or a bare "ModelArk/2377608" reference and normalises both to a canonical
// /en/docs/<lib>/<code> URL. The query string is dropped because BytePlus tracking params (_vtm_ and
// friends) are noise, and the fragment is returned separately so it can default --section.
export function normaliseTarget(target: string): DocTarget {
    let lib: string
    let code: string
    let fragment: string | null = null

    if (/^https?:\/\//i.test(target)) {
        const url = new URL(target)

        if (!/(^|\.)byteplus\.com$/i.test(url.hostname)) {
            throw new Error(`Not a BytePlus docs URL: ${target}`)
        }

        const parts = url.pathname.split('/').filter(Boolean)
        const docsAt = parts.indexOf('docs')

        // Path is /<lang>/docs/<lib>/<code>, but the lang segment is optional.
        if (docsAt === -1 || parts.length < docsAt + 3) {
            throw new Error(`Cannot read a library and doc code out of: ${target}`)
        }

        lib = parts[docsAt + 1]
        code = parts[docsAt + 2]
        fragment = url.hash ? url.hash.slice(1) : null
    } else {
        const [ref, hash] = target.split('#')
        const parts = ref.split('/').filter(Boolean)

        if (parts.length !== 2) {
            throw new Error(`Expected "Library/DocCode" or a full URL, got: ${target}`)
        }

        lib = parts[0]
        code = parts[1]
        fragment = hash || null
    }

    return { lib, code, fragment, url: `https://docs.byteplus.com/en/docs/${lib}/${code}` }
}

// ---------------------------------------------------------------------------
// FETCHING
// ---------------------------------------------------------------------------

async function fetchHtml(url: string): Promise<string> {
    const response = await fetch(url, {
        redirect: 'follow',
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
        },
    })

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    return response.text()
}

// The payload is a JSON object literal assigned in a script tag, so it is not delimited by anything
// we can regex to the end of. Locating the assignment and then walking the braces is what makes this
// robust against nested strings that happen to contain "}".
export function extractRouterData(html: string): RouterData | null {
    const marker = /window\._ROUTER_DATA\s*=\s*/.exec(html)
    if (!marker) return null

    const start = html.indexOf('{', marker.index + marker[0].length - 1)
    if (start === -1) return null

    let depth = 0
    let inString = false
    let escaped = false

    for (let i = start; i < html.length; i++) {
        const char = html[i]

        if (inString) {
            if (escaped) escaped = false
            else if (char === '\\') escaped = true
            else if (char === '"') inString = false
            continue
        }

        if (char === '"') inString = true
        else if (char === '{') depth++
        else if (char === '}' && --depth === 0) {
            try {
                return JSON.parse(html.slice(start, i + 1)) as RouterData
            } catch {
                return null
            }
        }
    }

    return null
}

// The route key carrying the document varies with the page type, so match on the shape (a loader
// whose data has a curDoc object) rather than the key name.
export function findDoc(routerData: RouterData | null): BytePlusDoc | null {
    const loaders = routerData?.loaderData
    if (!loaders) return null

    for (const value of Object.values(loaders)) {
        if (value && typeof value === 'object') {
            const curDoc = (value as { curDoc?: unknown }).curDoc

            if (curDoc && typeof curDoc === 'object') return curDoc as BytePlusDoc
        }
    }

    return null
}

async function fetchDoc(target: DocTarget, attempts: number): Promise<BytePlusDoc> {
    const problems: string[] = []

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const html = await fetchHtml(target.url)
            const routerData = extractRouterData(html)

            if (!routerData) {
                // The client-side-rendered shell. Retrying is the fix.
                problems.push(`attempt ${attempt}: no _ROUTER_DATA (${html.length} bytes, CSR shell)`)
            } else {
                const doc = findDoc(routerData)

                if (!doc) problems.push(`attempt ${attempt}: _ROUTER_DATA carried no curDoc`)
                else if (!doc.MDContent) problems.push(`attempt ${attempt}: curDoc has no MDContent`)
                else return doc
            }
        } catch (error) {
            problems.push(`attempt ${attempt}: ${(error as Error).message}`)
        }

        if (attempt < attempts) {
            await new Promise(resolve => setTimeout(resolve, RETRY_BASE_MS * attempt))
        }
    }

    throw new Error(`Could not fetch ${target.url} in ${attempts} attempts:\n  ${problems.join('\n  ')}`)
}

// ---------------------------------------------------------------------------
// HEADINGS AND SECTIONS
// ---------------------------------------------------------------------------

// BytePlus anchors are not slugified heading text: the exported Markdown emits an explicit
// `<span id="trust-model-output"></span>` immediately before the heading it labels, and that id is
// what a #fragment in a copied URL points at. We index those ids first and fall back to a slug of
// the heading text, so both a real BytePlus anchor and a guessed one resolve.
export function headingAnchor(text: string): string {
    return text
        .toLowerCase()
        .replace(/`/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]*>/g, '')
        .replace(/\\(.)/g, '$1')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
}

const SPAN_ANCHOR = /<span\s+id="([^"]+)"\s*>\s*<\/span>/i
const HEADING = /^(#{1,6})\s+(.*\S)\s*$/
const FENCE = /^(`{3,}|~{3,})/

// These docs are full of shell and Python samples whose comments start with "#", so a heading scan
// that ignores code fences reports them as headings. Every walk over the body tracks fences through
// this helper, which returns the fence state after the line and whether the line was a fence marker.
function stepFence(line: string, fence: string | null): { fence: string | null; isMarker: boolean } {
    const match = FENCE.exec(line)

    if (!match) return { fence, isMarker: false }
    if (fence === null) return { fence: match[1][0], isMarker: true }
    if (match[1][0] === fence) return { fence: null, isMarker: true }

    return { fence, isMarker: true }
}

export function outlineOf(markdown: string): Heading[] {
    const headings: Heading[] = []
    let pendingAnchor: string | null = null
    let fence: string | null = null

    for (const raw of markdown.split('\n')) {
        const line = raw.trim()
        const stepped = stepFence(line, fence)

        fence = stepped.fence
        if (stepped.isMarker || fence !== null) continue

        const span = SPAN_ANCHOR.exec(line)
        if (span) {
            pendingAnchor = span[1]
            continue
        }

        const match = HEADING.exec(raw)
        if (match) {
            const text = match[2].replace(SPAN_ANCHOR, '').trim()
            const slug = headingAnchor(text)
            const anchors = pendingAnchor && pendingAnchor !== slug ? [pendingAnchor, slug] : [slug]

            headings.push({ level: match[1].length, text, anchor: anchors[0], anchors })
            pendingAnchor = null
        } else if (line !== '') {
            // Only a blank line may sit between the marker and its heading.
            pendingAnchor = null
        }
    }

    return headings
}

// Returns the requested heading plus everything under it, stopping at the next heading of the same
// or higher level so a section arrives with its subsections.
export function sliceSection(markdown: string, wanted: string): string | null {
    const lines = markdown.split('\n')
    const outline = outlineOf(markdown)
    const target = outline.find(heading => heading.anchors.includes(wanted))

    if (!target) return null

    // A document can repeat a heading, so match the same occurrence the outline pass identified
    // rather than the first textual hit.
    const occurrence = outline.filter(h => h.text === target.text && h.level === target.level).indexOf(target)

    let start = -1
    let fence: string | null = null
    let seen = 0

    for (let i = 0; i < lines.length; i++) {
        const stepped = stepFence(lines[i].trim(), fence)

        fence = stepped.fence
        if (stepped.isMarker || fence !== null) continue

        const match = HEADING.exec(lines[i])
        if (!match) continue

        const text = match[2].replace(SPAN_ANCHOR, '').trim()

        if (text === target.text && match[1].length === target.level) {
            if (seen === occurrence) {
                start = i
                break
            }

            seen++
        }
    }

    if (start === -1) return null

    fence = null

    for (let i = start + 1; i < lines.length; i++) {
        const stepped = stepFence(lines[i].trim(), fence)

        fence = stepped.fence
        if (stepped.isMarker || fence !== null) continue

        const match = HEADING.exec(lines[i])
        if (match && match[1].length <= target.level) {
            return lines.slice(start, i).join('\n').trim()
        }
    }

    return lines.slice(start).join('\n').trim()
}

// ---------------------------------------------------------------------------
// RENDERING
// ---------------------------------------------------------------------------

export function render(doc: BytePlusDoc, target: DocTarget, opts: Options): string {
    const body = doc.MDContent

    if (opts.listSections) {
        const outline = outlineOf(body)

        if (outline.length === 0) return `${doc.Title}\n\n(no headings)`

        const rows = outline.map(h => `${'  '.repeat(h.level - 1)}${'#'.repeat(h.level)} ${h.text}  [${h.anchors.map(a => `#${a}`).join(' ')}]`)

        return [doc.Title, '', ...rows].join('\n')
    }

    const section = opts.section ?? target.fragment
    let content = body

    if (section) {
        const sliced = sliceSection(body, section)

        if (sliced === null) {
            const available = outlineOf(body).flatMap(h => h.anchors).map(a => `#${a}`).join(', ')

            throw new Error(`No section "#${section}" in ${target.url}.\nHeadings present: ${available || '(none)'}`)
        }

        content = sliced
    }

    if (!opts.metadata) return content

    const header = [
        `# ${doc.Title}`,
        '',
        `Source: ${target.url}`,
        `Library: ${doc.LibraryCode}  Doc code: ${doc.DocumentCode}`,
    ]

    if (doc.UpdatedTime) header.push(`Updated: ${doc.UpdatedTime}`)
    if (section) header.push(`Section: #${section}`)

    return `${header.join('\n')}\n\n---\n\n${content}\n`
}

// ---------------------------------------------------------------------------
// ENTRY POINT
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2))

    if (opts.help || opts.targets.length === 0) {
        process.stdout.write(HELP)
        process.exit(opts.help ? 0 : 1)
    }

    if (!Number.isInteger(opts.attempts) || opts.attempts < 1) {
        throw new Error('--attempts needs a positive integer')
    }

    const many = opts.targets.length > 1
    const rendered: { target: DocTarget; text: string }[] = []

    for (const raw of opts.targets) {
        const target = normaliseTarget(raw)
        const doc = await fetchDoc(target, opts.attempts)

        rendered.push({ target, text: render(doc, target, opts) })
    }

    if (!opts.out) {
        process.stdout.write(rendered.map(entry => entry.text).join('\n\n---\n\n'))
        return
    }

    for (const { target, text } of rendered) {
        const path = many ? opts.out.replace(/(\.md)?$/i, `-${target.code}$1`) : opts.out

        await writeFile(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
        process.stderr.write(`wrote ${path}\n`)
    }
}

// Guarded so the parsing helpers above can be imported by a test without the CLI running as a side
// effect.
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error: Error) => {
        process.stderr.write(`${error.message}\n`)
        process.exit(1)
    })
}
