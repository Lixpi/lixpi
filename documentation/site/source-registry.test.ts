import {
    mkdtempSync,
    mkdirSync,
    writeFileSync,
    rmSync,
    symlinkSync,
    readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest'
import Markdoc from '@markdoc/markdoc'
import { DocumentationSources } from './source-registry.mjs'
import {
    collectHeadingIds,
    createConfig,
} from './markdoc/config.mjs'

const roots: string[] = []
function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'canvas-docs-'))
    roots.push(root)
    const write = (file: string, content = '# Content\n') => {
        const absolute = path.join(root, file)
        mkdirSync(path.dirname(absolute), { recursive: true })
        writeFileSync(absolute, content)
        return absolute
    }
    const index = write('documentation/README.md', '# Docs\n')
    const engine = write('packages/lixpi/canvas-engine/README.md', '# Engine\n\n## Named **ports**\n\n## Named **ports**\n')
    const picture = write('packages/lixpi/canvas-engine/docs/assets/diagram.svg', '<svg/>')
    const source = write('packages/lixpi/canvas-engine/src/index.ts', 'export {}\n')
    const registry = new DocumentationSources(root)
    registry.register(index, 'README.html')
    registry.register(engine, 'packages/canvas-engine/index.html')
    registry.register(picture, 'packages/canvas-engine/docs/assets/diagram.svg', 'asset')
    registry.setHeadings(engine, collectHeadingIds(Markdoc.parse(readFileSync(engine, 'utf8'))))
    registry.setHeadings(index, ['docs'])
    return { root, write, index, engine, source, registry }
}
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('documentation source registry', () => {
    it('resolves package pages from their original source paths in both directions', () => {
        const { registry, index, engine } = fixture()
        expect(registry.resolve(index, '../packages/lixpi/canvas-engine/README.md#named-ports')).toBe('packages/canvas-engine/index.html#named-ports')
        expect(registry.resolve(engine, '../../../documentation/README.md')).toBe('../../README.html')
        expect(registry.resolve(engine, '#named-ports-1')).toBe('#named-ports-1')
    })
    it('renders package-local links and images with the same resolver used by validation', () => {
        const { registry, engine } = fixture()
        const ast = Markdoc.parse('[Docs](../../../documentation/README.md)\n\n![Diagram](docs/assets/diagram.svg)\n\n# Engine\n\n## Named **ports**\n\n## Named **ports**')
        const html = Markdoc.renderers.html(Markdoc.transform(ast, createConfig({ sources: registry, source: engine })))
        expect(html).toContain('href="../../README.html"')
        expect(html).toContain('src="docs/assets/diagram.svg"')
        expect(html).toContain('id="named-ports-1"')
    })
    it('keeps source links as repository links and preserves query and line anchors', () => {
        const { registry, engine } = fixture()
        expect(registry.resolve(engine, 'src/index.ts?plain=1#L1')).toBe('https://github.com/Lixpi/lixpi/blob/main/packages/lixpi/canvas-engine/src/index.ts?plain=1#L1')
        expect(registry.resolve(engine, 'src')).toBe('https://github.com/Lixpi/lixpi/tree/main/packages/lixpi/canvas-engine/src')
    })
    it('rejects duplicate routes, missing sources and missing heading anchors', () => {
        const { registry, index, source, engine } = fixture()
        expect(() => registry.register(source, 'README.html')).toThrow('Duplicate output route')
        expect(() => registry.resolve(index, 'missing.md')).toThrow('Missing source')
        expect(() => registry.resolve(engine, '#absent')).toThrow('Missing heading')
    })
    it('rejects path traversal and symlinks that escape the repository', () => {
        const { registry, index, root } = fixture()
        expect(() => registry.resolve(index, '../../outside.md')).toThrow('escapes repository')
        symlinkSync(tmpdir(), path.join(root, 'outside'))
        expect(() => registry.resolve(index, '../outside')).toThrow('symlink')
        expect(() => registry.resolve(index, '/etc/passwd')).toThrow('relative repository')
    })
    it('preserves external links and encodes package-local asset names', () => {
        const { registry, index, write } = fixture()
        const asset = write('documentation/assets/a b.svg')
        registry.register(asset, 'assets/a b.svg', 'asset')
        expect(registry.resolve(index, 'assets/a%20b.svg')).toBe('assets/a%20b.svg')
        expect(registry.resolve(index, 'https://example.com/a.md')).toBe('https://example.com/a.md')
    })
    it('discovers explicit documentation roots without ingesting package source, dependencies or examples', () => {
        const { root, write } = fixture()
        write('documentation/site/README.md')
        write('documentation/site/node_modules/ignored.md')
        for (const name of ['canvas-engine', 'canvas-components', 'canvas-components-lixpi-specific', 'ui-primitives', 'ui-kit']) {
            write('packages/lixpi/' + name + '/README.md')
            write('packages/lixpi/' + name + '/docs/GUIDE.md')
            write('packages/lixpi/' + name + '/src/ignored.md')
            write('packages/lixpi/' + name + '/examples/ignored.md')
        }
        const registry = new DocumentationSources(root).discover()
        expect([...registry.pages.keys()].some(file => file.endsWith('ignored.md'))).toBe(false)
        expect([...registry.pages.values()].filter(page => page.route.startsWith('packages/'))).toHaveLength(10)
    })
    it('ignores apparent headings inside fenced code and matches rendered inline heading text', () => {
        const ast = Markdoc.parse('# Public **Node**\n\n~~~ts\n# Not a heading\n~~~\n\n## Links & **nodes**')
        expect([...collectHeadingIds(ast)]).toEqual(['public-node', 'links-and-nodes'])
    })
})

describe('repository documentation', () => {
    it('resolves authored documentation links without building the site', () => {
        const registry = new DocumentationSources('/repository').discover()
        const documents = [...registry.pages.values()].map(page => {
            const ast = Markdoc.parse(readFileSync(page.source, 'utf8'))
            registry.setHeadings(page.source, collectHeadingIds(ast))
            return { page, ast }
        })
        const failures: string[] = []
        for (const { page, ast } of documents) {
            if (page.route.startsWith('packages/')) {
                const config = createConfig({ sources: registry, source: page.source })
                for (const item of Markdoc.validate(ast, config)) {
                    if (['error', 'critical'].includes(item.error.level)) failures.push(page.route + ': ' + item.error.message)
                }
                try {
                    const html = Markdoc.renderers.html(Markdoc.transform(ast, config))
                    expect(html.includes('<h1'), page.route + ' has a rendered title').toBe(true)
                } catch (error) {
                    failures.push(page.route + ': ' + (error as Error).message)
                }
            }
            for (const node of ast.walk()) {
                const href = node.type === 'link' ? node.attributes.href : node.type === 'image' ? node.attributes.src : undefined
                if (typeof href !== 'string') continue
                try {
                    registry.resolve(page.source, href)
                } catch (error) {
                    failures.push(path.relative('/repository', page.source) + ': ' + href + ': ' + (error as Error).message)
                }
            }
        }
        expect(failures).toEqual([])
    })
})
