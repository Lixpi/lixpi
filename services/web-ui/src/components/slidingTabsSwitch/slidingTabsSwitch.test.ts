import { describe, it, expect, beforeEach, vi } from 'vitest'
import { select, selection } from 'd3-selection'
import { createSlidingTabsSwitch, type SlidingTabsSwitchConfig } from '$src/components/slidingTabsSwitch/slidingTabsSwitch.ts'

// Keep transition behavior synchronous in happy-dom.
const makeChain = (): any => {
    const chain: any = {}
    for (const method of ['duration', 'ease', 'attr', 'style', 'tween', 'select']) {
        chain[method] = () => chain
    }
    return chain
}
;(selection.prototype as any).transition = () => makeChain()

const SVG_NS = 'http://www.w3.org/2000/svg'

type Tab = 'list' | 'grid' | 'timeline'

const tabs = [
    { label: 'List', value: 'list' as Tab },
    { label: 'Grid', value: 'grid' as Tab },
    { label: 'Timeline', value: 'timeline' as Tab },
]

function mount(
    selectedValue: Tab = 'list',
    onChange = vi.fn(),
    onClose = vi.fn(),
    config: Partial<SlidingTabsSwitchConfig<Tab>> = {}
) {
    const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
    document.body.appendChild(svg)
    const tabsSwitch = createSlidingTabsSwitch<Tab>(select(svg), {
        id: 'chat-tabs',
        x: 0,
        y: 0,
        width: 300,
        minTabWidth: 100,
        tabs: tabs.map((tab) => ({ ...tab, closable: true })),
        selectedValue,
        onChange,
        onClose,
        ...config,
    })
    return { svg, tabsSwitch, onChange, onClose }
}

const tabGroups = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.tag-pill-group'))
const closeIcons = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll('.tag-pill-close'))

describe('createSlidingTabsSwitch', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
    })

    it('renders tab pills through tag pills and configures accessibility roles', () => {
        const { svg } = mount()
        const group = svg.querySelector('.sliding-switch-group')!
        const optionGroups = Array.from(svg.querySelectorAll('.sliding-switch-option-group'))

        expect(group.getAttribute('role')).toBe('tablist')
        expect(tabGroups(svg)).toHaveLength(3)
        expect(optionGroups[1]!.getAttribute('role')).toBe('tab')
        expect(svg.querySelector('.tag-pill-label')?.textContent).toBe('List')
    })

    it('changes the selected tab from click and fires onChange', () => {
        const { svg, tabsSwitch, onChange } = mount()

        tabGroups(svg)[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(tabsSwitch.getValue()).toBe('timeline')
        expect(onChange).toHaveBeenCalledExactlyOnceWith('timeline', 'chat-tabs')
    })

    it('forwards close actions from the pill to onClose without changing the selection', () => {
        const { svg, tabsSwitch, onClose } = mount('list')
        tabGroups(svg)[1]!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
        closeIcons(svg)[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(onClose).toHaveBeenCalledExactlyOnceWith(
            'grid',
            'chat-tabs',
            expect.objectContaining({ value: 'grid', label: 'Grid' })
        )
        expect(tabsSwitch.getValue()).toBe('list')
    })

    it('respects minimum tab width and allows programmatic value updates', () => {
        const { tabsSwitch, onChange } = mount()

        expect(tabsSwitch.getContentWidth()).toBe(304)
        expect(tabsSwitch.getOuterHeight()).toBe(26)

        tabsSwitch.setValue('grid')
        expect(tabsSwitch.getValue()).toBe('grid')
        expect(onChange).not.toHaveBeenCalled()

        tabsSwitch.setValue('timeline')
        expect(tabsSwitch.getValue()).toBe('timeline')
    })

    it('forwards styling class and render/resize methods to underlying switch', () => {
        const { svg, tabsSwitch } = mount('list', vi.fn(), vi.fn(), { className: 'chat-tabs-strip' })

        expect(svg.querySelector('.sliding-switch-group')?.getAttribute('class')).toContain('chat-tabs-strip')

        tabsSwitch.resize(0, 0, 350, 30)
        expect(tabsSwitch.getContentWidth()).toBe(350)
        expect(tabsSwitch.getOuterHeight()).toBe(30)

        expect(() => tabsSwitch.render()).not.toThrow()
    })

    it('forwards shadow configuration to underlying switch', () => {
        const { tabsSwitch } = mount('list', vi.fn(), vi.fn(), {
            activeTabBoxShadow: '0 0 8px rgba(0, 0, 0, 0.25)',
            activeTabInsetShadow: {
                topColor: 'rgba(255, 255, 255, 0.8)',
                bottomColor: 'rgba(0, 0, 0, 0)',
            },
        })

        expect(tabsSwitch.getOuterHeight()).toBe(36)
    })

    it('destroys the underlying sliding switch', () => {
        const { svg, tabsSwitch } = mount()

        tabsSwitch.destroy()
        expect(svg.querySelector('.sliding-switch-group')).toBeNull()
    })
})
