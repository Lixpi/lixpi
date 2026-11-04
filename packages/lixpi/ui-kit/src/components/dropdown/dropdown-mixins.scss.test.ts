import {
    describe,
    expect,
    it,
} from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { withoutLayout } from '@lixpi/test-utils'

const expectSourceToContain = (source: string, snippet: string): void => {
    expect(
        withoutLayout(source).includes(withoutLayout(snippet)),
        `dropdown mixins should contain:\n${snippet}`,
    ).toBe(true)
}

describe('dropdown hover transitions', () => {
    it('uses the shared settings-backed hover transition for every interactive state', () => {
        const source = readFileSync(resolve(import.meta.dirname, '_dropdown-mixins.scss'), 'utf-8')

        expectSourceToContain(source, 'hoverDuration: $defaultHoverTransitionDuration')
        expectSourceToContain(source, 'hoverTransition(background, map.get($s, hoverDuration))')
        expectSourceToContain(source, 'hoverTransition(color, map.get($s, hoverDuration))')
        expectSourceToContain(source, 'hoverTransition(opacity, map.get($s, hoverDuration))')
        expectSourceToContain(source, 'hoverTransition(fill, map.get($s, hoverDuration))')
        expectSourceToContain(source, 'pupOutTransition(transform, map.get($s, hoverDuration))')
        expectSourceToContain(source, 'hoverTransition(background-color, $defaultHoverTransitionDuration)')
        expectSourceToContain(source, 'hoverTransition(border-color, $defaultHoverTransitionDuration)')
    })
})

describe('dropdown icon selectors', () => {
    it('targets trigger and option icons with plain selectors browsers can match', () => {
        const stylesheets = ['_dropdown-mixins.scss', 'dropdown.scss']
            .map(file => readFileSync(resolve(import.meta.dirname, file), 'utf-8'))

        for (const source of stylesheets)
            expect(source).not.toContain(':global(')

        expectSourceToContain(stylesheets[0], 'span.state-indicator svg {')
        expectSourceToContain(stylesheets[0], 'fill: map.get($s, glyphBase);')
    })
})
