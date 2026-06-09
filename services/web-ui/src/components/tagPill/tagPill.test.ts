import { describe, it, expect, beforeEach, vi } from 'vitest'
import { select } from 'd3-selection'
import { createTagPill } from '$src/components/tagPill/tagPill.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

function mount(selected = false, hovered = false, disabled = false, closable = false) {
    const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
    document.body.appendChild(svg)
    const onClick = vi.fn()
    const onClose = vi.fn()

    const tagPill = createTagPill(select(svg), {
        id: 'tag-pill',
        x: 0,
        y: 0,
        width: 120,
        label: 'Alpha',
        selected,
        hovered,
        disabled,
        closable,
        onClick,
        onClose,
    })

    return { svg, tagPill, onClick, onClose }
}

const labels = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.tag-pill-label'))
const groups = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.tag-pill-group'))
const closes = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.tag-pill-close'))

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
        expect(background.getAttribute('fill')).toBe('rgba(255, 255, 255, 0.78)')

        tagPill.render({ selected: false, hovered: true, label: 'Beta', closable: true, closeVisibility: 'always' })
        expect(labels(svg)[0]!.textContent).toBe('Beta')
        expect(background.getAttribute('fill')).toBe('rgba(255, 255, 255, 0.78)')

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
})
