import {
    describe,
    expect,
    it,
} from 'vitest'
import { svgToCssImageUrl } from './svgCssImage.ts'

describe('svgToCssImageUrl', () => {
    it('encodes caller artwork without letting quotes, hashes or line breaks escape the CSS URL', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg">\n<path fill="#123456" d="M0 0L1 1"/>\n</svg>'
        const css = svgToCssImageUrl(svg)
        expect(css.startsWith('url("data:image/svg+xml,')).toBe(true)
        expect(css.endsWith('")')).toBe(true)
        const encoded = css.slice('url("data:image/svg+xml,'.length, -2)
        expect(encoded).not.toContain('"')
        expect(encoded).not.toContain('#')
        expect(encoded).not.toContain('\n')
        expect(decodeURIComponent(encoded)).toBe(svg)
    })
})
