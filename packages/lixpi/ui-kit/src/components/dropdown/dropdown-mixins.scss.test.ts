import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function expectSourceToContain(source: string, snippet: string): void {
    expect(
        source.includes(snippet),
        `dropdown mixins should contain:\n${snippet}`
    ).toBe(true)
}

describe('dropdown hover transitions', () => {
    it('uses the shared settings-backed hover transition for every interactive state', () => {
        const source = readFileSync(resolve(__dirname, '_dropdown-mixins.scss'), 'utf-8')

        expectSourceToContain(source, 'hoverDuration: $defaultHoverTransitionDuration')
        expectSourceToContain(source, 'hoverTransition(background, map.get($s, hoverDuration))')
        expectSourceToContain(source, 'hoverTransition(color, map.get($s, hoverDuration))')
        expectSourceToContain(source, 'hoverTransition(opacity, map.get($s, hoverDuration))')
        expectSourceToContain(source, 'hoverTransition(fill, map.get($s, hoverDuration))')
        expectSourceToContain(source, 'hoverTransition(background-color, $defaultHoverTransitionDuration)')
        expectSourceToContain(source, 'hoverTransition(border-color, $defaultHoverTransitionDuration)')
    })
})
