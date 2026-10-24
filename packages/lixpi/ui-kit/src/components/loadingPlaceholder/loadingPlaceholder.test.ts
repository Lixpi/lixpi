// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    createErrorPlaceholder,
} from './pureLoadingPlaceholder.ts'

describe('Loading placeholders', () => {
    it('mounts error state in a supplied document and exposes an accessible alert', () => {
        const target = document.implementation.createHTMLDocument()
        const placeholder = createErrorPlaceholder({
            document: target,
            theme: 'dark',
            message: 'Document unavailable',
        })
        target.body.append(placeholder.dom)
        expect(placeholder.dom.ownerDocument).toBe(target)
        expect(placeholder.dom.getAttribute('role')).toBe('alert')
        expect(placeholder.dom.textContent).toContain('Document unavailable')
        placeholder.hide()
        expect(placeholder.dom.style.display).toBe('none')
        placeholder.show()
        expect(placeholder.dom.style.display).toBe('flex')
        placeholder.destroy()
        expect(target.body.children).toHaveLength(0)
    })

    it('updates error content safely and removes the retry callback on disposal', () => {
        const onRetry = vi.fn()
        const placeholder = createErrorPlaceholder({
            onRetry,
            message: 'Unavailable',
            withOverlay: false,
        })
        const button = placeholder.dom.querySelector('button')!
        button.click()
        expect(onRetry).toHaveBeenCalledOnce()
        placeholder.setMessage('<script>unsafe</script>')
        expect(placeholder.dom.querySelector('script')).toBeNull()
        expect(placeholder.dom.textContent).toContain('<script>unsafe</script>')
        placeholder.destroy()
        button.click()
        expect(onRetry).toHaveBeenCalledOnce()
    })
})
