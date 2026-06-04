#!/usr/bin/env node
//
// Standalone Markdoc -> HTML static renderer for the Lixpi documentation set.
//
//   node build.mjs
//
// Walks every .md file under documentation/ (excluding this site/ folder),
// parses + validates + transforms each through @markdoc/markdoc, renders to an
// HTML string with the built-in HTML renderer, and writes a mirrored tree into
// documentation/site/dist/. No UI framework. The only dependency is
// @markdoc/markdoc.
//
// The build fails (non-zero exit) on any Markdoc parse/validate error or any
// dangling intra-doc .md link, so it doubles as a docs linter.

import Markdoc from '@markdoc/markdoc'
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createConfig, rewriteHref } from './markdoc/config.mjs'
import { renderNav, renderPage } from './markdoc/template.mjs'

const SITE_DIR = path.dirname(fileURLToPath(import.meta.url))
const DOCS_ROOT = path.resolve(SITE_DIR, '..')
const DIST = path.join(SITE_DIR, 'dist')
const ASSETS_OUT = path.join(DIST, '_assets')

// `dist` is the build output; `node_modules` is dependencies. Everything else
// under documentation/ (including site/README.md, which documents this build)
// is rendered so its cross-links resolve.
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist'])

// Sidebar ordering: lower weight sorts first; unknown names get 0; README/index
// are pinned to the top. Tunable without touching logic.
const NAV_ORDER = {
    README: -100, index: -100,
    'PRODUCT-OVERVIEW': -90,
    platform: 10, canvas: 20, 'ai-chat': 30, 'media-generation': 40, library: 50, conventions: 60,
    'documentation-style-guides': 70, 'coding-style-guides': 71, 'development-workflow': 72, testing: 73,
    knowledge: 80, roadmap: 85, 'vendor-documentation': 90, 'Media-Posts': 95, memory: 96, 'tech-debt': 97,
    features: 5,
}

const WORD_OVERRIDES = { ai: 'AI', nats: 'NATS', api: 'API', ui: 'UI', veo: 'VEO', vlm: 'VLM' }

function prettifyLabel(name) {
    return name
        .replace(/\.md$/i, '')
        .split(/[-_]/)
        .map((w) => WORD_OVERRIDES[w.toLowerCase()] || (w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ')
}

// --- frontmatter (tiny, no YAML dep) ---------------------------------------

function parseFrontmatter(source) {
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
    if (!match) return { data: {}, body: source }
    const data = {}
    for (const line of match[1].split(/\r?\n/)) {
        const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
        if (!kv) continue
        let value = kv[2].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }
        data[kv[1]] = value
    }
    return { data, body: source.slice(match[0].length) }
}

function deriveTitle(body, relMd) {
    const heading = body.match(/^#\s+(.+?)\s*$/m)
    if (heading) return heading[1].replace(/[`*_]/g, '').trim()
    return prettifyLabel(path.basename(relMd))
}

// --- filesystem walk --------------------------------------------------------

async function findMarkdown(dir) {
    const found = []
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            if (EXCLUDE_DIRS.has(entry.name)) continue
            found.push(...(await findMarkdown(full)))
        } else if (entry.name.toLowerCase().endsWith('.md')) {
            found.push(full)
        }
    }
    return found
}

// --- navigation tree --------------------------------------------------------

function weightFor(name) {
    const key = name.replace(/\.md$/i, '').replace(/\.html$/i, '')
    return NAV_ORDER[key] ?? 0
}

function buildNavTree(pages) {
    const root = { kind: 'dir', label: 'root', children: [] }
    for (const page of pages) {
        const parts = page.relHtml.split('/')
        let node = root
        for (let i = 0; i < parts.length; i += 1) {
            const part = parts[i]
            const isLeaf = i === parts.length - 1
            if (isLeaf) {
                node.children.push({ kind: 'page', name: part, label: page.title, rel: page.relHtml })
            } else {
                let dir = node.children.find((c) => c.kind === 'dir' && c.name === part)
                if (!dir) {
                    dir = { kind: 'dir', name: part, label: prettifyLabel(part), children: [] }
                    node.children.push(dir)
                }
                node = dir
            }
        }
    }
    const sortChildren = (n) => {
        n.children.sort((a, b) => {
            const wa = weightFor(a.name)
            const wb = weightFor(b.name)
            if (wa !== wb) return wa - wb
            return a.label.localeCompare(b.label)
        })
        n.children.filter((c) => c.kind === 'dir').forEach(sortChildren)
    }
    sortChildren(root)
    return root
}

// --- link resolution for the dangling-link gate ----------------------------

function collectLinks(ast) {
    const hrefs = []
    for (const node of ast.walk()) {
        if (node.type === 'link' && node.attributes && typeof node.attributes.href === 'string') {
            hrefs.push(node.attributes.href)
        }
        if (node.type === 'image' && node.attributes && typeof node.attributes.src === 'string') {
            hrefs.push(node.attributes.src)
        }
    }
    return hrefs
}

function isExternal(href) {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('//')
}

async function main() {
    const files = await findMarkdown(DOCS_ROOT)
    if (files.length === 0) {
        console.error('No markdown files found under', DOCS_ROOT)
        process.exit(1)
    }

    // Pass 1: read + frontmatter + titles, build the page index.
    const pages = []
    for (const abs of files) {
        const source = await fs.readFile(abs, 'utf8')
        const { data, body } = parseFrontmatter(source)
        const relMd = path.relative(DOCS_ROOT, abs).split(path.sep).join('/')
        const relHtml = relMd.replace(/\.md$/i, '.html')
        pages.push({
            abs,
            relMd,
            relHtml,
            body,
            title: data.title || deriveTitle(body, relMd),
            description: data.description || '',
        })
    }

    const outputSet = new Set(pages.map((p) => p.relHtml))
    const navTree = buildNavTree(pages)
    const config = createConfig()

    await fs.rm(DIST, { recursive: true, force: true })
    await fs.mkdir(ASSETS_OUT, { recursive: true })

    const parseErrors = []
    const validateErrors = []
    const danglingLinks = []
    const assetWarnings = []

    // Pass 2: render each page.
    for (const page of pages) {
        let ast
        try {
            ast = Markdoc.parse(page.body)
        } catch (err) {
            parseErrors.push(`${page.relMd}: ${err.message}`)
            continue
        }

        for (const item of Markdoc.validate(ast, config)) {
            const level = item.error?.level || 'error'
            if (level === 'error' || level === 'critical') {
                validateErrors.push(`${page.relMd}:${item.lines?.[0] ?? '?'} [${item.error?.id}] ${item.error?.message}`)
            }
        }

        // Dangling-link gate (intra-doc .md links must resolve to a built page).
        for (const href of collectLinks(ast)) {
            if (!href || isExternal(href) || href.startsWith('#')) continue
            const [target] = href.split('#')
            if (!target) continue
            const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(page.relMd), target))
            // Links that escape documentation/ point at repo source files or
            // external READMEs (valid on GitHub), not at rendered site pages.
            // They are intentional; don't treat them as site links.
            if (resolved.startsWith('..')) continue
            if (/\.md$/i.test(target)) {
                const resolvedHtml = resolved.replace(/\.md$/i, '.html')
                if (!outputSet.has(resolvedHtml)) {
                    danglingLinks.push(`${page.relMd} -> ${href} (expected ${resolvedHtml})`)
                }
            } else {
                // intra-doc asset/image: warn if missing on disk
                const onDisk = path.join(DOCS_ROOT, resolved)
                if (!existsSync(onDisk)) assetWarnings.push(`${page.relMd} -> ${href}`)
            }
        }

        const content = Markdoc.transform(ast, config)
        const contentHtml = Markdoc.renderers.html(content)

        const depth = page.relHtml.split('/').length - 1
        const rootPrefix = depth === 0 ? './' : '../'.repeat(depth)
        const navHtml = renderNav(navTree, rootPrefix, page.relHtml)
        const html = renderPage({
            title: page.title,
            description: page.description,
            contentHtml,
            navHtml,
            rootPrefix,
        })

        const outPath = path.join(DIST, page.relHtml)
        await fs.mkdir(path.dirname(outPath), { recursive: true })
        await fs.writeFile(outPath, html, 'utf8')
    }

    // Stylesheet + any documentation/assets (images) the docs reference.
    await fs.copyFile(path.join(SITE_DIR, 'assets', 'styles.css'), path.join(ASSETS_OUT, 'styles.css'))
    const docsAssets = path.join(DOCS_ROOT, 'assets')
    if (existsSync(docsAssets)) {
        await fs.cp(docsAssets, path.join(DIST, 'assets'), { recursive: true })
    }

    // Home page: prefer the documentation index (README.md).
    const readme = pages.find((p) => p.relHtml.toLowerCase() === 'readme.html')
    if (readme) {
        await fs.copyFile(path.join(DIST, readme.relHtml), path.join(DIST, 'index.html'))
    }

    // --- report ---
    const fail = parseErrors.length > 0 || validateErrors.length > 0 || danglingLinks.length > 0
    console.log(`\nLixpi docs build`)
    console.log(`  pages rendered : ${pages.length}`)
    console.log(`  output         : ${path.relative(process.cwd(), DIST)}/`)
    if (assetWarnings.length) {
        console.log(`\n  ⚠ ${assetWarnings.length} non-.md link(s) not found on disk (assets):`)
        assetWarnings.forEach((w) => console.log(`    - ${w}`))
    }
    if (parseErrors.length) {
        console.log(`\n  ✗ ${parseErrors.length} parse error(s):`)
        parseErrors.forEach((e) => console.log(`    - ${e}`))
    }
    if (validateErrors.length) {
        console.log(`\n  ✗ ${validateErrors.length} validation error(s):`)
        validateErrors.forEach((e) => console.log(`    - ${e}`))
    }
    if (danglingLinks.length) {
        console.log(`\n  ✗ ${danglingLinks.length} dangling intra-doc link(s):`)
        danglingLinks.forEach((d) => console.log(`    - ${d}`))
    }
    console.log(fail ? '\nBuild FAILED.\n' : '\nBuild OK.\n')
    process.exit(fail ? 1 : 0)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
