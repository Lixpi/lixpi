// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    html,
    createEl,
    applyStyle,
    createDocumentHtml,
} from './index.ts'

describe('DOM templates', () => {
    it('retains child identity and handlers while applying template and live styles', () => {
        const onClick = vi.fn()
        const child = createEl('span', null, 'Child')
        const style = { color: 'red' }
        const element = html`<button className="example" style=${style} data=${{ id: 12 }} onclick=${onClick}>${child}</button>` as HTMLButtonElement

        expect(element.firstChild).toBe(child)
        expect(element.className).toBe('example')
        expect(element.dataset.id).toBe('12')
        element.click()
        expect(onClick).toHaveBeenCalledOnce()
        applyStyle(element, { color: 'blue', width: '10px' })
        expect(element.style.color).toBe('blue')
        expect(element.style.width).toBe('10px')
        expect(element.isConnected).toBe(false)
    })

    it('binds document-scoped templates to their supplied document', () => {
        const scopedDocument = document.implementation.createHTMLDocument('Embedded')
        const template = createDocumentHtml(scopedDocument)
        const element = template`<input disabled=${true} required=${false} data=${{ index: 0 }} />` as HTMLInputElement

        expect(element.ownerDocument).toBe(scopedDocument)
        expect(element.hasAttribute('disabled')).toBe(true)
        expect(element.hasAttribute('required')).toBe(false)
        expect(element.dataset.index).toBe('0')
    })

    it('preserves document-scoped nested children and textContent semantics', () => {
        const template = createDocumentHtml(document)
        const child = template`<span textContent="Ready"></span>` as HTMLSpanElement
        const element = template`<div>${[[child], [0, null, false, ' done']]}</div>` as HTMLDivElement

        expect(element.firstChild).toBe(child)
        expect(element.textContent).toBe('Ready0 done')
        expect(child.hasAttribute('textContent')).toBe(false)
    })
})
