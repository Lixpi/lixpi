#!/usr/bin/env node
//
// Standalone Markdoc -> HTML static renderer for the Lixpi documentation set.
//
//   node build.mjs
//
// Registers central and package-local Markdown from their original paths,
// parses + validates + transforms each through @markdoc/markdoc, renders to an
// HTML string with the built-in HTML renderer, and writes a mirrored tree into
// documentation/site/dist/. No UI framework. The only dependency is
// @markdoc/markdoc.
//
// The build fails (non-zero exit) on any Markdoc parse/validate error or any
// dangling intra-doc .md link, so it doubles as a docs linter.

import Markdoc from '@markdoc/markdoc'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createConfig, collectHeadingIds } from './markdoc/config.mjs'
import { DocumentationSources } from './source-registry.mjs'
import { renderNav, renderPage } from './markdoc/template.mjs'

const SITE_DIR = path.dirname(fileURLToPath(import.meta.url))
const DOCS_ROOT = path.resolve(SITE_DIR, '..')
const DIST = path.join(SITE_DIR, 'dist')
const ASSETS_OUT = path.join(DIST, '_assets')

// Sidebar ordering: lower weight sorts first; unknown names get 0; README/index
// are pinned to the top. Tunable without touching logic.
const NAV_ORDER = {
    README: -100, index: -100,
    'PRODUCT-OVERVIEW': -90,
    platform: 10, packages: 15, canvas: 20, 'ai-chat': 30, 'media-generation': 40, library: 50, conventions: 60,
    'documentation-style-guides': 70, 'coding-style-guides': 71, 'development-workflow': 72, testing: 73,
    knowledge: 80, roadmap: 85, 'vendor-documentation': 90, 'Media-Posts': 95, memory: 96, 'tech-debt': 97, site: 98,
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

async function main() {
    const sources = new DocumentationSources(path.resolve(DOCS_ROOT, '..')).discover()
    const pages = []
    const errors = []
    for (const entry of sources.pages.values()) {
        const source = await fs.readFile(entry.source, 'utf8')
        const { data, body } = parseFrontmatter(source)
        try {
            const ast = Markdoc.parse(body)
            sources.setHeadings(entry.source, collectHeadingIds(ast))
            const relMd = path.relative(sources.repoRoot, entry.source).split(path.sep).join('/')
            pages.push({ ...entry, abs: entry.source, relMd, relHtml: entry.route, body, ast, title: data.title || deriveTitle(body, relMd), description: data.description || '' })
        } catch (error) { errors.push(entry.source + ': ' + error.message) }
    }
    for (const page of pages) {
        const config = createConfig({ sources, source: page.source })
        for (const item of Markdoc.validate(page.ast, config)) {
            if (['error', 'critical'].includes(item.error?.level || 'error')) errors.push(page.relMd + ': ' + item.error?.message)
        }
        for (const href of collectLinks(page.ast)) {
            try { sources.resolve(page.source, href) } catch (error) { errors.push(page.relMd + ' -> ' + href + ': ' + error.message) }
        }
    }
    if (errors.length) throw new Error(errors.join('\n'))

    const navTree = buildNavTree(pages)
    await fs.rm(DIST, { recursive: true, force: true })
    await fs.mkdir(ASSETS_OUT, { recursive: true })
    for (const page of pages) {
        const contentHtml = Markdoc.renderers.html(Markdoc.transform(page.ast, createConfig({ sources, source: page.source })))
        const depth = page.relHtml.split('/').length - 1
        const rootPrefix = depth === 0 ? './' : '../'.repeat(depth)
        const html = renderPage({
            title: page.title, description: page.description, contentHtml,
            navHtml: renderNav(navTree, rootPrefix, page.relHtml), rootPrefix,
            sourceUrl: sources.repoUrl + '/blob/main/' + page.relMd,
        })
        const output = path.join(DIST, page.relHtml)
        await fs.mkdir(path.dirname(output), { recursive: true })
        await fs.writeFile(output, html, 'utf8')
    }
    await fs.copyFile(path.join(SITE_DIR, 'assets', 'styles.css'), path.join(ASSETS_OUT, 'styles.css'))
    for (const asset of sources.assets.values()) {
        const output = path.join(DIST, asset.route)
        await fs.mkdir(path.dirname(output), { recursive: true })
        await fs.copyFile(asset.source, output)
    }
    await fs.copyFile(path.join(DIST, 'README.html'), path.join(DIST, 'index.html'))
    console.log('Rendered ' + pages.length + ' documentation pages into ' + DIST)
}

try { await main() } catch (error) {
    console.error(error)
    process.exitCode = 1
}
