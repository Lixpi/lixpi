import { describe, it, expect } from 'vitest'
import { select } from 'd3-selection'
import { extractSvgPathIcon, appendSvgPathIcon } from './svgIconPaths.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

describe('svg icon path utility functions', () => {
    it('extracts path data and viewBox-based geometry', () => {
        const icon = `
            <svg viewBox="2, 4, 18, 10" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 2"/>
                <path d="M3 4"/>
                <path d=""/>
            </svg>
        `
        const parsed = extractSvgPathIcon(icon)

        expect(parsed.pathData).toEqual(['M1 2', 'M3 4'])
        expect(parsed.minX).toBe(2)
        expect(parsed.minY).toBe(4)
        expect(parsed.width).toBe(18)
        expect(parsed.height).toBe(10)
    })

    it('falls back to width/height when viewBox is missing and ignores invalid dimensions', () => {
        const icon = `
            <svg width="0" height="-12" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 0h1"/>
            </svg>
        `
        const parsed = extractSvgPathIcon(icon)

        expect(parsed.pathData).toEqual(['M0 0h1'])
        expect(parsed.minX).toBe(0)
        expect(parsed.minY).toBe(0)
        expect(parsed.width).toBe(24)
        expect(parsed.height).toBe(24)
    })

    it('appends normalized path geometry and replaces prior icon children', () => {
        const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
        document.body.appendChild(svg)
        const host = select(svg).append('g')

        appendSvgPathIcon(host, '<svg viewBox="0 0 20 10"><path d="M1 1h18v8h-18z"/></svg>', {
            x: 2,
            y: 3,
            size: 10,
            fill: '#123456',
        })

        expect(host.selectAll('path').size()).toBe(1)
        const firstPath = host.select('path').node()!
        expect(firstPath.getAttribute('fill')).toBe('#123456')
        expect(firstPath.getAttribute('transform')).toBe('translate(2, 5.5) scale(0.5) translate(0, 0)')

        appendSvgPathIcon(host, '<svg viewBox="1 1 12 12" xmlns="http://www.w3.org/2000/svg"><path d="A"/></svg>', {
            x: 0,
            y: 0,
            size: 12,
            fill: '#654321',
        })

        expect(host.selectAll('path').size()).toBe(1)
        const secondPath = host.select('path').node()!
        expect(secondPath.getAttribute('fill')).toBe('#654321')
        expect(secondPath.getAttribute('transform')).toBe('translate(0, 0) scale(1) translate(-1, -1)')
    })
})
