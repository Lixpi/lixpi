// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    createErrorPlaceholder,
    createLoadingPlaceholder,
} from './pureLoadingPlaceholder.ts'

describe('Loading placeholders', () => {
    it('mounts loading state in a supplied document and exposes accessible status', () => {
        const target = document.implementation.createHTMLDocument()
        const placeholder = createLoadingPlaceholder({ document: target, size: 'large', theme: 'dark', label: 'Loading document' })
        target.body.append(placeholder.dom)
        expect(placeholder.dom.ownerDocument).toBe(target)
        expect(placeholder.dom.getAttribute('role')).toBe('status')
        expect(placeholder.dom.getAttribute('aria-label')).toBe('Loading document')
        expect(placeholder.dom.classList.contains('size-large')).toBe(true)
        placeholder.hide()
        expect(placeholder.dom.style.display).toBe('none')
        placeholder.show()
        expect(placeholder.dom.style.display).toBe('flex')
        placeholder.destroy()
        expect(target.body.children).toHaveLength(0)
    })

    it('updates error content safely and removes the retry callback on disposal', () => {
        const onRetry = vi.fn()
        const placeholder = createErrorPlaceholder({ onRetry, message: 'Unavailable', withOverlay: false })
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
