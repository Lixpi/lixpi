#!/usr/bin/env node
// Zero-dependency static file server for the built docs (dist/).
// Pure Node — no python, no external packages. Run after build.mjs.
//
//   node serve.mjs            # serves dist/ on http://localhost:8080
//   PORT=9000 node serve.mjs

import http from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const PORT = Number(process.env.PORT) || 8080

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
}

const server = http.createServer(async (req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    if (urlPath.endsWith('/')) urlPath += 'index.html'

    const filePath = path.join(DIST, path.normalize(urlPath))
    if (!filePath.startsWith(DIST)) {
        res.writeHead(403)
        res.end('Forbidden')
        return
    }

    let target = filePath
    let data = await fs.readFile(target).catch(() => null)
    if (!data) {
        // Allow extensionless links to resolve to their .html page.
        target = `${filePath}.html`
        data = await fs.readFile(target).catch(() => null)
    }
    if (!data) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<h1>404 — not found</h1>')
        return
    }

    res.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream' })
    res.end(data)
})

server.listen(PORT, () => {
    console.log(`Lixpi docs served at http://localhost:${PORT} (serving ${path.relative(process.cwd(), DIST)}/)`)
})
