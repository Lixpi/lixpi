import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

const PACKAGE_NAMES = ['canvas-engine', 'canvas-components', 'canvas-components-lixpi-specific', 'ui-primitives', 'ui-kit']
const EXCLUDED = new Set(['node_modules', '.git', 'dist'])
const external = href => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('//')
const posix = value => value.split(path.sep).join('/')

export class DocumentationSources {
    pages = new Map()
    assets = new Map()
    routes = new Map()

    constructor(repoRoot, repoUrl = 'https://github.com/Lixpi/lixpi') {
        this.repoRoot = realpathSync(repoRoot)
        this.repoUrl = repoUrl.replace(/\/$/, '')
    }

    sourcePath(file) {
        const absolute = path.resolve(this.repoRoot, file)
        const relative = path.relative(this.repoRoot, absolute)
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Link escapes repository: ' + file)
        if (!existsSync(absolute)) throw new Error('Missing source: ' + posix(relative))
        const actual = realpathSync(absolute)
        const actualRelative = path.relative(this.repoRoot, actual)
        if (actualRelative === '..' || actualRelative.startsWith('..' + path.sep) || path.isAbsolute(actualRelative)) throw new Error('Link escapes repository through a symlink: ' + file)
        return actual
    }

    register(file, route, kind = 'page') {
        const source = this.sourcePath(file)
        const normalized = path.posix.normalize(route)
        if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) throw new Error('Invalid output route: ' + route)
        if (this.routes.has(normalized)) throw new Error('Duplicate output route: ' + normalized)
        if (this.pages.has(source) || this.assets.has(source)) throw new Error('Duplicate source: ' + file)
        if (!statSync(source).isFile()) throw new Error('Documentation source must be a file: ' + file)
        const entry = { source, route: normalized, kind, headings: new Set() }
        this.routes.set(normalized, entry)
        ;(kind === 'page' ? this.pages : this.assets).set(source, entry)
        return entry
    }

    discover() {
        this.walk('documentation', '', true)
        for (const name of PACKAGE_NAMES) {
            const root = 'packages/lixpi/' + name
            const route = 'packages/' + name
            this.register(root + '/README.md', route + '/index.html')
            if (existsSync(path.join(this.repoRoot, root, 'NOTICES.md'))) this.register(root + '/NOTICES.md', route + '/NOTICES.html')
            if (existsSync(path.join(this.repoRoot, root, 'docs'))) this.walk(root + '/docs', route + '/docs', false)
        }
        return this
    }

    walk(directory, routePrefix, central) {
        for (const entry of readdirSync(this.sourcePath(directory), { withFileTypes: true })) {
            if (entry.name.startsWith('.') || EXCLUDED.has(entry.name)) continue
            const file = path.posix.join(directory, entry.name)
            const route = path.posix.join(routePrefix, entry.name)
            if (entry.isDirectory()) {
                if (central && entry.name === 'site') {
                    this.register(file + '/README.md', route + '/README.html')
                    continue
                }
                this.walk(file, route, central)
            } else if (entry.name.toLowerCase().endsWith('.md')) {
                this.register(file, route.replace(/\.md$/i, '.html'))
            } else if (/\.(png|jpe?g|gif|webp|avif|svg|pdf|mp4|webm|woff2?)$/i.test(entry.name)) {
                this.register(file, route, 'asset')
            }
        }
    }

    setHeadings(file, headings) {
        const page = this.pages.get(this.sourcePath(file))
        if (!page) throw new Error('Unregistered page: ' + file)
        page.headings = new Set(headings)
    }

    resolve(author, href) {
        if (!href || external(href)) return href
        const page = this.pages.get(this.sourcePath(author))
        if (!page) throw new Error('Unregistered author: ' + author)
        const match = href.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/)
        if (!match) throw new Error('Invalid link: ' + href)
        const [, encodedTarget, query = '', hash = ''] = match
        const target = decodeURIComponent(encodedTarget)
        if (target.startsWith('/')) throw new Error('Use a relative repository link: ' + href)
        const source = this.sourcePath(target ? path.resolve(path.dirname(page.source), target) : page.source)
        const registered = this.pages.get(source) ?? this.assets.get(source)
        if (registered) {
            if (registered.kind === 'page' && hash && !registered.headings.has(decodeURIComponent(hash.slice(1)))) throw new Error('Missing heading ' + hash + ' in ' + posix(path.relative(this.repoRoot, source)))
            if (!target) return query + hash
            const relative = path.posix.relative(path.posix.dirname(page.route), registered.route)
            return relative.split('/').map(segment => encodeURIComponent(segment)).join('/') + query + hash
        }
        const repoPath = posix(path.relative(this.repoRoot, source)).split('/').map(segment => encodeURIComponent(segment)).join('/')
        return this.repoUrl + (statSync(source).isDirectory() ? '/tree/main/' : '/blob/main/') + repoPath + query + hash
    }
}
