import { describe, expect, it } from 'vitest'

import { createCollapseExpandIcon } from './collapseExpandIcon.ts'

function getPartTransform(icon: HTMLElement, partId: string): string {
    return icon.querySelector<SVGGElement>(`[data-icon-part="${partId}"]`)?.getAttribute('transform') ?? ''
}

describe('collapse/expand icon', () => {
    it('shows outward chevrons for the expand action and inward chevrons for collapse', () => {
        const icon = createCollapseExpandIcon({ state: 'collapsed' })

        expect(getPartTransform(icon.element, 'chevron-up')).toContain('translate(0 -5.5)')
        expect(getPartTransform(icon.element, 'chevron-down')).toContain('translate(0 5.5)')

        icon.setState('expanded', { animate: false })

        expect(getPartTransform(icon.element, 'chevron-up')).toContain('translate(0 7.25)')
        expect(getPartTransform(icon.element, 'chevron-down')).toContain('translate(0 -7.25)')
        icon.destroy()
    })
})
