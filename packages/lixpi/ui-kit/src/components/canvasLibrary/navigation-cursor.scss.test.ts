// @vitest-environment happy-dom
import { resolve } from 'node:path'
import {
    describe,
    expect,
    it,
} from 'vitest'
import { compileThemedStylesheet } from '@lixpi/test-utils/stylesheets'

describe('catalogue navigation cursor', () => {
    it('removes wrapper vertical padding without changing node typography', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, '../../../styles/canvas-library.scss'))
        const navigation = css.match(/(?:^|})\s*\.canvas-library-navigation\s*\{([^}]+)\}/)?.[1] ?? ''

        expect(navigation).toMatch(/padding-block:\s*0/)
        expect(navigation).not.toMatch(/font-size|line-height/)
    })

    it('uses a pointer for catalogue row labels without affecting ordinary blocks', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, '../../../styles/canvas-library.scss'))
        const rule = css.match(/([^{}]*\.canvas-library-navigation \.nested-list\[data-mode=view\] \.nested-list-item > \.nested-list-item-content > p:first-child)\s*\{([^}]+)\}/)
        const selector = rule?.[1].trim() ?? ''
        const root = document.createElement('div')
        root.className = 'canvas-library-navigation'
        root.innerHTML = `
            <div class="nested-list" data-mode="view"><div class="nested-list-document">
                <h1>Heading</h1><p>Paragraph</p>
                <ul><li class="nested-list-item"><div class="nested-list-item-content"><p>Catalogue</p><p>Body</p></div></li></ul>
            </div></div>
        `
        const paragraphs = root.querySelectorAll('p')

        expect(rule?.[2]).toMatch(/cursor:\s*pointer/)
        expect(paragraphs[0].matches(selector)).toBe(false)
        expect(paragraphs[1].matches(selector)).toBe(true)
        expect(paragraphs[2].matches(selector)).toBe(false)
        const editRoot = root.cloneNode(true) as HTMLElement
        editRoot.querySelector('.nested-list')!.setAttribute('data-mode', 'edit')
        expect(editRoot.querySelectorAll('p')[1].matches(selector)).toBe(false)
    })
})
