// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    copyCssCustomProperties,
    getElementScale,
} from './elementPresentation.ts'

describe('Element presentation utilities', () => {
    it('reads rotated matrix and explicit scale transforms with a safe unscaled fallback', () => {
        const element = document.createElement('div')
        element.style.transform = 'matrix(0, 2, -2, 0, 10, 20)'
        expect(getElementScale(element)).toBe(2)
        element.style.transform = 'scale(1.5)'
        expect(getElementScale(element)).toBe(1.5)
        element.style.transform = 'none'
        expect(getElementScale(element)).toBe(1)
    })

    it('copies only the requested custom properties to an explicit target', () => {
        const source = document.createElement('div')
        const target = document.createElement('div')
        source.style.setProperty('--color', 'red')
        source.style.setProperty('--unrelated', 'blue')
        copyCssCustomProperties(source, target, ['--color'])
        expect(target.style.getPropertyValue('--color')).toBe('red')
        expect(target.style.getPropertyValue('--unrelated')).toBe('')
    })
})
