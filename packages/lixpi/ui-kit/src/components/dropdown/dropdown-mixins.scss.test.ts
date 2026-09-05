import {
    describe,
    expect,
    it,
} from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// These assertions pin down what the source does, not how the formatter lays it out.
// Line breaks and trailing commas are the formatter's choice and change nothing about
// the behavior, so both sides are compared on tokens alone.
const withoutLayout = (value: string): string => value
    .replace(/\s+/g, '')
    .replace(/,(?=[)\]}])/g, '')
    .replace(/,$/, '')

function expectSourceToContain(source: string, snippet: string): void {
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
        expectSourceToContain(source, 'hoverTransition(background-color, $defaultHoverTransitionDuration)')
        expectSourceToContain(source, 'hoverTransition(border-color, $defaultHoverTransitionDuration)')
    })
})
