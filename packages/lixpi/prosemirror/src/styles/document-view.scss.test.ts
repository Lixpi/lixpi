// @vitest-environment happy-dom
import { resolve } from 'node:path'
import {
    describe,
    expect,
    it,
} from 'vitest'
import { compileThemedStylesheet } from '@lixpi/test-utils/stylesheets'

describe('ProseMirror separator', () => {
    it('keeps zero width when the host sizes ordinary images', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'document-view.scss'))
        const style = document.createElement('style')
        const container = document.createElement('div')
        style.textContent = `${css}\nimg { width: 100%; max-width: 200px; }`
        container.innerHTML = '<img class="ProseMirror-separator"><img class="ordinary-image">'
        document.head.append(style)
        document.body.append(container)

        try {
            expect(getComputedStyle(container.querySelector('.ProseMirror-separator')!).width).toMatch(/^0(?:px)?$/)
            expect(getComputedStyle(container.querySelector('.ordinary-image')!).width).toBe('100%')
        } finally {
            style.remove()
            container.remove()
        }
    })
})
