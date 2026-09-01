// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
} from 'vitest'
import { ElementStyleLease } from './elementStyleLease.ts'

describe('ElementStyleLease', () => {
    it('preserves overlapping owners and restores the original inline priority', () => {
        const element = document.createElement('div')
        element.style.setProperty('cursor', 'auto', 'important')
        const first = new ElementStyleLease(element, { cursor: 'ew-resize', 'user-select': 'none' })
        const second = new ElementStyleLease(element, { cursor: 'grabbing' })
        first.destroy()
        expect(element.style.cursor).toBe('grabbing')
        expect(element.style.userSelect).toBe('')
        second.destroy()
        expect(element.style.cursor).toBe('auto')
        expect(element.style.getPropertyPriority('cursor')).toBe('important')
        first.destroy()
        expect(element.style.cursor).toBe('auto')
    })

    it('restores the preceding owner without changing another element', () => {
        const element = document.createElement('div')
        const other = document.createElement('div')
        const first = new ElementStyleLease(element, { cursor: 'ew-resize' })
        const second = new ElementStyleLease(element, { cursor: 'grabbing' })
        const independent = new ElementStyleLease(other, { cursor: 'crosshair' })
        second.destroy()
        expect(element.style.cursor).toBe('ew-resize')
        first.destroy()
        expect(element.style.cursor).toBe('')
        expect(other.style.cursor).toBe('crosshair')
        independent.destroy()
    })
})
