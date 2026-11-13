import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    inheritedScopeClass,
    isInheritedScopeClass,
    readInheritedCustomProperties,
} from './inherited-scope-style.ts'

// A computed style with the given declarations, counting value reads.
const computedStyle = (declarations: Record<string, string>) => {
    const names = Object.keys(declarations)
    const getPropertyValue = vi.fn((name: string) => declarations[name] ?? '')

    return {
        style: {
            length: names.length,
            item: (index: number) => names[index],
            getPropertyValue,
        } as unknown as CSSStyleDeclaration,
        getPropertyValue,
    }
}

afterEach(() => void vi.useRealTimers())

describe('inherited scope style', () => {
    it('reads a source once per task and only its custom properties', () => {
        vi.useFakeTimers()
        const source = document.createElement('div')
        const computed = computedStyle({
            '--surface': 'white',
            '--text': 'black',
            color: 'red',
        })

        const first = readInheritedCustomProperties(source, computed.style)
        const second = readInheritedCustomProperties(source, computed.style)

        expect(second).toBe(first)
        expect([...first.properties]).toEqual([['--surface', 'white'], ['--text', 'black']])
        expect(computed.getPropertyValue).toHaveBeenCalledTimes(2)

        vi.runAllTimers()
        readInheritedCustomProperties(source, computed.style)
        expect(computed.getPropertyValue).toHaveBeenCalledTimes(4)
    })

    it('applies a property set through one shared class rule', () => {
        const read = {
            properties: new Map([
                ['--surface', 'white'],
                ['--text', 'black'],
            ]),
            signature: '--surface:white;--text:black',
        }

        const className = inheritedScopeClass(document, read)
        const target = document.createElement('div')
        target.classList.add(className)
        document.body.append(target)

        expect(isInheritedScopeClass(className)).toBe(true)
        expect(inheritedScopeClass(document, { ...read })).toBe(className)
        const rule = [...document.querySelector<HTMLStyleElement>('style[data-lixpi-inherited-scope]')!.sheet!.cssRules]
            .find(candidate => (candidate as CSSStyleRule).selectorText === `.${className}`) as CSSStyleRule
        expect(rule.style.getPropertyValue('--surface')).toBe('white')
        expect(rule.style.getPropertyValue('--text')).toBe('black')

        const changed = inheritedScopeClass(document, {
            properties: new Map([['--surface', 'navy']]),
            signature: '--surface:navy',
        })
        expect(changed).not.toBe(className)
        target.remove()
    })
})
