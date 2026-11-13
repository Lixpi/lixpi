// @vitest-environment happy-dom
import { resolve } from 'node:path'
import {
    describe,
    expect,
    it,
} from 'vitest'
import { compileThemedStylesheet } from '@lixpi/test-utils/stylesheets'

describe('workspace navigation heading spacing', () => {
    it('removes top spacing only from the first visible heading in a single organization', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'workspace-navigation.scss'))
        const rule = css.match(/([^{}]*\.workspace-navigation-single-organization[^{}]*\+\s*:is\(h1,\s*h2,\s*h3\))\s*\{([^}]+)\}/)
        const selector = rule?.[1].trim() ?? ''
        const root = document.createElement('div')
        root.className = 'workspace-navigation-single-organization'
        root.innerHTML = `
            <div class="nested-list">
                <div class="ProseMirror nested-list-document">
                    <section class="workspace-navigation-organization">
                        <div class="nested-list-item-content">
                            <p>Organization</p><h1>First</h1><h2>Later</h2>
                        </div>
                    </section>
                </div>
            </div>
        `
        const first = root.querySelector('h1')!
        const later = root.querySelector('h2')!

        expect(rule?.[2]).toMatch(/margin-block-start:\s*0/)
        expect(first.matches(selector)).toBe(true)
        expect(later.matches(selector)).toBe(false)
        first.before(document.createElement('p'))
        expect(first.matches(selector)).toBe(false)
        first.previousElementSibling?.remove()
        root.classList.remove('workspace-navigation-single-organization')
        expect(first.matches(selector)).toBe(false)
    })
})

describe('workspace navigation protected controls', () => {
    it('hides the single-organization label and its inline chevron', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'workspace-navigation.scss'))
        const label = css.match(/\.workspace-navigation-single-organization \.nested-list \.nested-list-document \.workspace-navigation-organization > \.nested-list-item-content > p:first-child\s*\{([^}]+)\}/)?.[1] ?? ''

        expect(label).toMatch(/display:\s*none/)
    })
})

describe('workspace navigation cursor', () => {
    it('uses a pointer only for workspace labels in view mode', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'workspace-navigation.scss'))
        const rule = css.match(/([^{}]*\.nested-list\[data-mode=view\] \.nested-list-item\[data-item-type=workspace\] > \.nested-list-item-content > p:first-child)\s*\{([^}]+)\}/)
        const selector = rule?.[1].trim() ?? ''
        const root = document.createElement('div')
        root.className = 'nested-list'
        root.dataset.mode = 'view'
        root.innerHTML = `
            <li class="nested-list-item" data-item-type="workspace"><div class="nested-list-item-content"><p>Workspace</p><p>Body</p></div></li>
            <li class="nested-list-item" data-item-type="text"><div class="nested-list-item-content"><p>Plain</p></div></li>
        `
        const labels = root.querySelectorAll('p')

        expect(rule?.[2]).toMatch(/cursor:\s*pointer/)
        expect(labels[0].matches(selector)).toBe(true)
        expect(labels[1].matches(selector)).toBe(false)
        expect(labels[2].matches(selector)).toBe(false)
        root.dataset.mode = 'edit'
        expect(labels[0].matches(selector)).toBe(false)
    })
})
