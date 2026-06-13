import { describe, it, expect, beforeEach, vi } from 'vitest'
import { select } from 'd3-selection'
import { createTagPill } from '$src/components/tagPill/tagPill.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

type TagPillConfig = Parameters<typeof createTagPill>[1]

function mountWithConfig(config: Partial<TagPillConfig> = {}, includeDefaultWidth = true) {
    const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
    document.body.appendChild(svg)
    const onClick = vi.fn()
    const onClose = vi.fn()
    const widthConfig = includeDefaultWidth ? { width: 120 } : {}

    const tagPill = createTagPill(select(svg), {
        id: 'tag-pill',
        x: 0,
        y: 0,
        label: 'Alpha',
        onClick,
        onClose,
        ...widthConfig,
        ...config,
    })

    return { svg, tagPill, onClick, onClose }
}

function mount(selected = false, hovered = false, disabled = false, closable = false) {
    return mountWithConfig({ selected, hovered, disabled, closable })
}

const labels = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.tag-pill-label'))
const groups = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.tag-pill-group'))
const closes = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.tag-pill-close'))
const backgrounds = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.tag-pill-background'))

describe('createTagPill', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
    })

    it('renders the pill surface and text', () => {
        const { svg } = mount()

        expect(svg.querySelector('.tag-pill-group')).not.toBeNull()
        expect(svg.querySelector('.tag-pill-background')).not.toBeNull()
        expect(labels(svg)[0]!.textContent).toBe('Alpha')
        expect(groups(svg)[0]!.getAttribute('role')).toBe('button')
    })

    it('updates fill state from setSelected and render state', () => {
        const { svg, tagPill } = mount(false)
        const background = svg.querySelector('.tag-pill-background')!

        expect(background.getAttribute('fill')).toBe('rgba(108, 117, 135, 0.08)')

        tagPill.setSelected(true)
        expect(background.getAttribute('fill')).toBe('rgba(255, 255, 255, 0.72)')
        expect(background.getAttribute('stroke')).toBe('rgba(105, 115, 133, 0.12)')

        tagPill.render({ selected: false, hovered: true, label: 'Beta', closable: true, closeVisibility: 'always' })
        expect(labels(svg)[0]!.textContent).toBe('Beta')
        expect(background.getAttribute('fill')).toBe('rgba(255, 255, 255, 0.72)')

        tagPill.resize(0, 0, 160)
        expect(background.getAttribute('width')).toBe('160')
    })

    it('fires click and close callbacks', () => {
        const { svg, onClick, onClose } = mount(false, false, false, true)
        const pill = groups(svg)[0]!
        const close = closes(svg)[0]!

        pill.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(onClick).toHaveBeenCalledExactlyOnceWith('tag-pill', expect.any(Event))

        pill.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
        close.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(onClose).toHaveBeenCalledExactlyOnceWith('tag-pill', expect.any(Event))
    })

    it('keeps close control hidden until hover when configured with hover visibility', () => {
        const { svg, tagPill } = mount(false, false, false, true)
        const close = closes(svg)[0]!

        close.setAttribute('data-close-visibility', 'hover')
        tagPill.render({ closeVisibility: 'hover' })
        expect(close.getAttribute('display')).toBe('none')

        groups(svg)[0]!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
        expect(close.getAttribute('display')).toBeNull()
    })

    it('does not fire callbacks when disabled', () => {
        const { svg, onClick, onClose } = mount(false, false, true, true)

        groups(svg)[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        svg.querySelector('.tag-pill-close')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(onClick).not.toHaveBeenCalled()
        expect(onClose).not.toHaveBeenCalled()
    })

    it('uses tab-style compact defaults when width is not supplied', () => {
        const { svg } = mountWithConfig({
            label: 'Fable 5',
            selected: true,
            closable: true,
        }, false)
        const background = backgrounds(svg)[0]!

        expect(background.getAttribute('height')).toBe('24')
        expect(Number(background.getAttribute('width'))).toBeGreaterThanOrEqual(96)
        expect(background.getAttribute('rx')).toBe('12')
        expect(background.getAttribute('fill')).toBe('rgba(255, 255, 255, 0.72)')
        expect(background.getAttribute('stroke')).toBe('rgba(105, 115, 133, 0.12)')
        expect(labels(svg)[0]!.getAttribute('font-size')).toBe('12')
        expect(labels(svg)[0]!.getAttribute('font-weight')).toBe('400')
        expect(closes(svg)[0]!.getAttribute('transform')).toBe('translate(11, 12)')
    })

    it('auto-sizes wider than the tab minimum for long labels without truncating text', () => {
        const longLabel = 'Veo 2.0 Generate 001'
        const { svg } = mountWithConfig({
            label: longLabel,
            selected: true,
            closable: true,
        }, false)
        const backgroundWidth = Number(backgrounds(svg)[0]!.getAttribute('width'))

        expect(backgroundWidth).toBeGreaterThan(96)
        expect(svg.getAttribute('width')).toBe(String(backgroundWidth))
        expect(labels(svg)[0]!.textContent).toBe(longLabel)
        expect(labels(svg)[0]!.textContent).not.toContain('...')
    })

    it('does not remeasure auto width on hover-only renders', () => {
        const { svg } = mountWithConfig({
            label: 'Fable 5',
            selected: true,
            closable: true,
            closeVisibility: 'hover',
        }, false)
        const initialWidth = backgrounds(svg)[0]!.getAttribute('width')
        const label = labels(svg)[0]!
        Object.defineProperty(label, 'getComputedTextLength', {
            value: vi.fn(() => 240),
            configurable: true,
        })

        groups(svg)[0]!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
        expect(backgrounds(svg)[0]!.getAttribute('width')).toBe(initialWidth)
        expect(svg.getAttribute('width')).toBe(initialWidth)

        groups(svg)[0]!.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
        expect(backgrounds(svg)[0]!.getAttribute('width')).toBe(initialWidth)
        expect(svg.getAttribute('width')).toBe(initialWidth)
    })

    it('keeps the default close icon on the left and centers the label like tab pills', () => {
        const { svg } = mountWithConfig({
            label: 'AI Chat',
            selected: true,
            closable: true,
            width: 120,
        })

        expect(closes(svg)[0]!.getAttribute('transform')).toBe('translate(11, 12)')
        expect(labels(svg)[0]!.getAttribute('x')).toBe('60')
        expect(labels(svg)[0]!.getAttribute('text-anchor')).toBe('middle')
    })

    it('supports precise pixel sizing controls', () => {
        const { svg } = mountWithConfig({
            label: 'Sized',
            selected: true,
            closable: true,
            width: 84,
            height: 18,
            minWidth: 40,
            fontSize: 10,
            fontWeight: 600,
            horizontalPadding: 3,
            closeSize: 10,
            closeIconSize: 6,
            closeGap: 4,
        })

        expect(backgrounds(svg)[0]!.getAttribute('height')).toBe('18')
        expect(backgrounds(svg)[0]!.getAttribute('rx')).toBe('9')
        expect(labels(svg)[0]!.getAttribute('font-size')).toBe('10')
        expect(labels(svg)[0]!.getAttribute('font-weight')).toBe('600')
        expect(closes(svg)[0]!.getAttribute('transform')).toBe('translate(8, 9)')
        expect(svg.querySelector('.tag-pill-close-background')!.getAttribute('r')).toBe('5')
    })
})
