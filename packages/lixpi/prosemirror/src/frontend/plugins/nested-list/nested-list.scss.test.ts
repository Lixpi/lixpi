// @vitest-environment happy-dom
import { resolve } from 'node:path'
import {
    describe,
    expect,
    it,
} from 'vitest'
import { compileThemedStylesheet } from '@lixpi/test-utils/stylesheets'

describe('nested list editor area layout', () => {
    it('fills the available host height through the editor surface and ProseMirror document', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'nested-list.scss'))
        const root = css.match(/\.nested-list\s*\{([^}]+)\}/)?.[1] ?? ''
        const editor = css.match(/\.nested-list-editor\s*\{([^}]+)\}/)?.[1] ?? ''
        const document = css.match(/\.nested-list-document\s*\{([^}]+)\}/)?.[1] ?? ''

        expect(root).toMatch(/display:\s*flex/)
        expect(root).toMatch(/font-size: 14px/)
        expect(root).toMatch(/flex-direction:\s*column/)
        expect(root).toMatch(/(?:^|;)\s*height:\s*100%/)
        expect(root).toMatch(/min-height:\s*100%/)
        expect(editor).toMatch(/display:\s*flex/)
        expect(editor).toMatch(/flex-direction:\s*column/)
        expect(editor).toMatch(/flex:\s*1 0 auto/)
        expect(document).toMatch(/flex:\s*1 0 auto/)
        const surface = css.match(/\.nested-list \.ProseMirror\.nested-list-document\s*\{([^}]+)\}/)?.[1] ?? ''
        const paragraph = css.match(/\.nested-list \.ProseMirror\.nested-list-document p\s*\{([^}]+)\}/)?.[1] ?? ''

        const item = css.match(/\.nested-list-item\s*\{([^}]+)\}/)?.[1] ?? ''
        const underlay = css.match(/\.nested-list-item-row-underlay\s*\{([^}]+)\}/)?.[1] ?? ''
        const chrome = css.match(/\.nested-list-item-chrome\s*\{([^}]+)\}/)?.[1] ?? ''

        expect(surface).toMatch(/background:\s*transparent/)
        expect(paragraph).toMatch(/font-size: 14px/)
        expect(surface).toMatch(/font-size: inherit/)
        expect(item).toMatch(/display:\s*grid/)
        expect(item).toMatch(/width: 100%/)
        expect(underlay).toMatch(/grid-row:\s*1/)
        expect(underlay).toMatch(/grid-column:\s*1\s*\/\s*-1/)
        expect(chrome).toMatch(/grid-row:\s*1/)
        expect(chrome).toMatch(/padding-inline-end:[^;]*1\.1rem[^;]*26px/)
        const panel = css.match(/\.nested-list-block-panel\s*\{([^}]+)\}/)?.[1] ?? ''
        const textPanel = css.match(/\.nested-list-block-panel-text\s*\{([^}]+)\}/)?.[1] ?? ''
        expect(panel).toMatch(/display:\s*flex/)
        expect(panel).toMatch(/flex-direction:\s*column/)
        expect(panel).not.toMatch(/grid-template-columns/)
        expect(panel).not.toMatch(/min-width:\s*12rem/)
        expect(textPanel).toMatch(/align-items:\s*stretch/)
    })

    it('uses the compact heading scale without asymmetric vertical padding', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'nested-list.scss'))
        const headings = css.match(/\.nested-list \.ProseMirror\.nested-list-document h1,\s*\.nested-list \.ProseMirror\.nested-list-document h2,\s*\.nested-list \.ProseMirror\.nested-list-document h3\s*\{([^}]+)\}/)?.[1] ?? ''
        const h1 = css.match(/(?:^|})\s*\.nested-list \.ProseMirror\.nested-list-document h1\s*\{([^}]+)\}/)?.[1] ?? ''
        const h2 = css.match(/(?:^|})\s*\.nested-list \.ProseMirror\.nested-list-document h2\s*\{([^}]+)\}/)?.[1] ?? ''
        const h3 = css.match(/(?:^|})\s*\.nested-list \.ProseMirror\.nested-list-document h3\s*\{([^}]+)\}/)?.[1] ?? ''

        expect(headings).toMatch(/margin:\s*0/)
        expect(headings).toMatch(/margin-block-start: 0\.8em/)
        expect(headings).toMatch(/padding-block:\s*0/)
        expect(h1).toMatch(/font-size:\s*1\.3em/)
        expect(h2).toMatch(/font-size:\s*1\.1em/)
        expect(h3).toMatch(/font-size:\s*1\.03em/)
    })
})

describe('nested list row feedback', () => {
    it('keeps selected and hovered colors on the owning row', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'nested-list.scss'))
        const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]+)\}/g), match => ({
            selectors: match[1].split(',').map(selector => selector.trim()),
            body: match[2],
        }))
        const findRule = (selector: string): string =>
            rules.find(rule => rule.selectors.includes(selector))?.body ?? ''
        const root = document.createElement('div')
        root.innerHTML = `
            <li class="nested-list-item nested-list-active" data-nested-list-hover=true>
                <span class="nested-list-item-row-underlay"></span>
                <div class="nested-list-item-content">
                    <p>Parent</p>
                    <ul><li class="nested-list-item"><span class="nested-list-item-row-underlay"></span><div class="nested-list-item-content"><p>Child</p></div><span class="nested-list-item-chrome"></span></li></ul>
                </div>
                <span class="nested-list-item-chrome"></span>
            </li>
        `
        const parent = root.querySelector<HTMLElement>('.nested-list-item')!
        const parentUnderlay = parent.querySelector<HTMLElement>(':scope > .nested-list-item-row-underlay')!
        const parentLabel = parent.querySelector<HTMLElement>(':scope > .nested-list-item-content > p')!
        const parentChrome = parent.querySelector<HTMLElement>(':scope > .nested-list-item-chrome')!
        const child = parent.querySelector<HTMLElement>('.nested-list-item')!
        const childLabel = child.querySelector<HTMLElement>(':scope > .nested-list-item-content > p')!
        const childChrome = child.querySelector<HTMLElement>(':scope > .nested-list-item-chrome')!
        const hoverUnderlay = '.nested-list-item:not(.nested-list-active)[data-nested-list-hover=true] > .nested-list-item-row-underlay'
        const selectedUnderlay = '.nested-list-item.nested-list-active > .nested-list-item-row-underlay'
        const selectedLabel = '.nested-list-item.nested-list-active > .nested-list-item-content > p:first-child'
        const selectedChrome = '.nested-list-item.nested-list-active > .nested-list-item-chrome'
        const hoverChrome = '.nested-list-item:not(.nested-list-active)[data-nested-list-hover=true] > .nested-list-item-chrome'

        expect(findRule(hoverUnderlay)).toMatch(/rgba\(95,\s*143,\s*207,\s*0\.14\)/)
        expect(findRule(selectedUnderlay)).toMatch(/rgba\(95,\s*143,\s*207,\s*0\.24\)/)
        expect(findRule(selectedUnderlay)).toMatch(/margin-inline: 14px 8px/)
        expect(findRule(selectedUnderlay)).toMatch(/border-radius: 8px/)
        expect(findRule(hoverUnderlay)).toMatch(/margin-inline: 14px 8px/)
        expect(findRule(hoverUnderlay)).toMatch(/border-radius: 8px/)
        expect(findRule(hoverChrome)).toMatch(/rgba\(66,\s*73,\s*79,\s*0\.62\)/)
        expect(findRule(selectedChrome)).toMatch(/color:\s*#000/)
        expect(parentUnderlay.matches(selectedUnderlay)).toBe(true)
        expect(parentUnderlay.matches(hoverUnderlay)).toBe(false)
        expect(parentLabel.matches(selectedLabel)).toBe(true)
        expect(parentChrome.matches(selectedChrome)).toBe(true)
        expect(childLabel.matches(selectedLabel)).toBe(false)
        expect(childChrome.matches(selectedChrome)).toBe(false)
        parent.classList.remove('nested-list-active')
        expect(parentUnderlay.matches(hoverUnderlay)).toBe(true)
        expect(parentChrome.matches(hoverChrome)).toBe(true)
    })

    it('shows drag feedback without changing block geometry', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'nested-list.scss'))
        const target = css.match(/\[data-nested-list-drop\]\s*\{([^}]+)\}/)?.[1] ?? ''
        const line = css.match(/\[data-nested-list-drop\]::after\s*\{([^}]+)\}/)?.[1] ?? ''
        const before = css.match(/\[data-nested-list-drop=before\]::after\s*\{([^}]+)\}/)?.[1] ?? ''
        const after = css.match(/\[data-nested-list-drop=inside\]::after\s*\{([^}]+)\}/)?.[1] ?? ''
        const inside = css.match(/(?:^|})\s*\.nested-list-document \.nested-list-item\[data-nested-list-drop=inside\]::after\s*\{([^}]+)\}/)?.[1] ?? ''
        const dragging = css.match(/\[data-nested-list-dragging=true\] \.nested-list-document \*\s*\{([^}]+)\}/)?.[1] ?? ''
        const trigger = css.match(/\[data-nested-list-dragging=true\] \.nested-list-block-trigger\s*\{([^}]+)\}/)?.[1] ?? ''
        const preview = css.match(/(?:^|})\s*\.nested-list-drag-preview\s*\{([^}]+)\}/)?.[1] ?? ''
        const previewHitArea = css.match(/\.nested-list-drag-preview \*\s*\{([^}]+)\}/)?.[1] ?? ''
        const source = css.match(/\[data-nested-list-drag-source=true\]\s*\{([^}]+)\}/)?.[1] ?? ''

        expect(target).toMatch(/position: relative/)
        expect(line).toMatch(/height: 2px/)
        expect(line).toMatch(/position: absolute/)
        expect(after).toMatch(/inset-block-end: 0/)
        expect(before).toMatch(/inset-block-start: 0/)
        expect(inside).toMatch(/inset-inline-start:[^;]*16px/)
        expect(css.includes('data-nested-list-source')).toBe(false)
        expect(dragging).toMatch(/cursor:\s*grabbing\s*!important/)
        expect(preview).toMatch(/position:\s*fixed/)
        expect(preview).toMatch(/left:\s*0/)
        expect(preview).toMatch(/top:\s*0/)
        expect(preview).toMatch(/background:\s*#f8fafd/)
        expect(preview).toMatch(/box-shadow:\s*[^;]+/)
        expect(preview).toMatch(/border-radius:\s*8px/)
        expect(previewHitArea).toMatch(/pointer-events:\s*none/)
        expect(preview).toMatch(/min-height:\s*0/)
        expect(preview).toMatch(/flex:\s*none/)
        expect(source).toMatch(/visibility:\s*hidden/)
        expect(trigger).toMatch(/pointer-events:\s*none/)
    })
})

describe('nested list block spacing', () => {
    it('spaces ordinary paragraphs and headings without changing list labels', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'nested-list.scss'))
        const spacing = css.match(/([^{}]+)\{[^{}]*margin-block-end:\s*0\.2em;[^{}]*\}/)?.[1] ?? ''
        const selectors = spacing.split(',').map(selector => selector.trim())
        const root = document.createElement('div')
        root.className = 'nested-list'
        root.innerHTML = `
            <div class="ProseMirror nested-list-document">
                <p id="paragraph">Paragraph</p>
                <h1>One</h1><h2>Two</h2><h3>Three</h3>
                <ul><li class="nested-list-item"><div class="nested-list-item-content"><p id="label">Label</p><p id="body">Body</p></div></li></ul>
            </div>
        `
        const matchesSpacing = (selector: string): boolean =>
            selectors.some(rule => root.querySelector(selector)!.matches(rule))

        expect(matchesSpacing('#paragraph')).toBe(true)
        expect(matchesSpacing('#body')).toBe(true)
        expect(matchesSpacing('#label')).toBe(false)
        expect(matchesSpacing('h1')).toBe(true)
        expect(matchesSpacing('h2')).toBe(true)
        expect(matchesSpacing('h3')).toBe(true)
    })
})

describe('first nested list heading', () => {
    it('removes top spacing only when the heading is the first document block', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'nested-list.scss'))
        const rule = css.match(/([^{}]*>\s*:is\(h1,\s*h2,\s*h3\):first-child)\s*\{([^}]+)\}/)
        const selector = rule?.[1].trim() ?? ''
        const root = document.createElement('div')
        root.className = 'nested-list'
        root.innerHTML = '<div class="ProseMirror nested-list-document"><h1>First</h1><h2>Later</h2></div>'
        const first = root.querySelector('h1')!
        const later = root.querySelector('h2')!

        expect(rule?.[2]).toMatch(/margin-block-start:\s*0/)
        expect(first.matches(selector)).toBe(true)
        expect(later.matches(selector)).toBe(false)
        first.before(document.createElement('p'))
        expect(first.matches(selector)).toBe(false)
    })
})

describe('nested list indentation', () => {
    it('uses the compact root inset and nesting step', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'nested-list.scss'))
        const heading = css.match(/\.nested-list \.ProseMirror\.nested-list-document h1,[^{]+\{([^}]+)\}/)?.[1] ?? ''
        const paragraph = css.match(/\.nested-list \.ProseMirror\.nested-list-document > p\s*\{([^}]+)\}/)?.[1] ?? ''
        const label = css.match(/\.nested-list \.nested-list-document \.nested-list-item-content > p:first-child\s*\{([^}]+)\}/)?.[1] ?? ''
        const nested = css.match(/\.nested-list-item-content > ul\s*\{([^}]+)\}/)?.[1] ?? ''

        expect(heading).toMatch(/padding-inline-start:\s*18px/)
        expect(paragraph).toMatch(/padding-inline-start:\s*18px/)
        expect(paragraph).toMatch(/padding-inline-end:[^;]*1\.1rem[^;]*26px/)
        expect(label).toMatch(/padding-inline-start:[^;]*18px/)
        expect(nested).toMatch(/--nested-list-depth-indent:[^;]*16px/)
    })
})

describe('nested list row controls', () => {
    it('styles the inline chevron and right menu without shifting the drag overlay', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'nested-list.scss'))
        const sharedHandle = css.match(/\.nested-list-block-drag-handle\s*\{([^}]+)\}/)?.[1] ?? ''
        const collapse = css.match(/\.nested-list-collapse\s*\{([^}]+)\}/)?.[1] ?? ''
        const collapseHover = css.match(/\.nested-list-collapse:focus-visible\s*\{([^}]+)\}/)?.[1] ?? ''
        const collapsedSection = css.match(/\.nested-list-section\.nested-list-collapsed > \.nested-list-item-content > :not\(:first-child\)\s*\{([^}]+)\}/)?.[1] ?? ''
        const collapseIcon = css.match(/\.nested-list-collapse svg\s*\{([^}]+)\}/)?.[1] ?? ''
        const icons = css.match(/\.nested-list-block-drag-handle svg\s*\{([^}]+)\}/)?.[1] ?? ''
        const hidden = css.match(/\.nested-list-block-drag-handle\[hidden\]\s*\{([^}]+)\}/)?.[1] ?? ''
        const rotated = css.match(/\.nested-list-collapsed > \.nested-list-item-content > p:first-child > \.nested-list-collapse svg\s*\{([^}]+)\}/)?.[1] ?? ''
        const trigger = css.match(/(?:^|})\s*\.nested-list-block-trigger\s*\{([^}]+)\}/)?.[1] ?? ''
        const triggerIcon = css.match(/\.nested-list-block-trigger svg\s*\{([^}]+)\}/)?.[1] ?? ''


        expect(sharedHandle).toMatch(/width:\s*8px/)
        expect(sharedHandle).toMatch(/position: absolute/)
        expect(sharedHandle).toMatch(/inset-inline-start: 3px/)
        expect(sharedHandle).toMatch(/color:\s*#000/)
        expect(sharedHandle).toMatch(/fill:\s*currentColor/)
        expect(collapse).toMatch(/width:\s*20px/)
        expect(collapse).toMatch(/display: inline-flex/)
        expect(collapseIcon).toMatch(/width: 20px/)
        expect(collapseIcon).toMatch(/pointer-events: none/)
        expect(collapseIcon).toMatch(/transform:\s*translateY\(0\.75px\)/)
        expect(collapse).toMatch(/margin-inline-start: 6px/)
        expect(collapse).toMatch(/border-radius: 50%/)
        expect(collapseHover).toMatch(/background:\s*rgba\(95,\s*143,\s*207,\s*0\.24\)/)
        expect(collapsedSection).toMatch(/display:\s*none/)
        const section = document.createElement('section')
        section.className = 'nested-list-section nested-list-collapsed'
        section.innerHTML = '<div class="nested-list-item-content"><p>Label</p><h1>Heading</h1><p>Body</p><ul></ul></div>'
        const hiddenSelector = '.nested-list-section.nested-list-collapsed > .nested-list-item-content > :not(:first-child)'
        expect(section.querySelector('p')!.matches(hiddenSelector)).toBe(false)
        expect(section.querySelector('h1')!.matches(hiddenSelector)).toBe(true)
        expect(section.querySelectorAll('p')[1].matches(hiddenSelector)).toBe(true)
        expect(section.querySelector('ul')!.matches(hiddenSelector)).toBe(true)
        expect(icons).toMatch(/width:\s*10px/)
        expect(icons).toMatch(/height:\s*10px/)
        expect(hidden).toMatch(/display:\s*none/)
        expect(rotated).toMatch(/rotate\(-90deg\) translateY\(0\.75px\)/)
        expect(trigger).toMatch(/inset-inline-end:\s*8px/)
        expect(trigger).toMatch(/height: 28px/)
        expect(trigger).toMatch(/box-sizing: border-box/)
        expect(trigger).toMatch(/padding: 4px 8px/)
        expect(trigger).toMatch(/width:[^;]*1\.1rem[^;]*18px/)
        expect(triggerIcon).toMatch(/width:\s*1\.1rem/)
        expect(triggerIcon).toMatch(/margin-inline-start: 2px/)
    })

    it('hides only the targeted plain row marker', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'nested-list.scss'))
        const markerRule = css.match(/([^{}]*\.nested-list-item\[data-item-type=text\]\[data-nested-list-hover=true\] > \.nested-list-item-content > p:first-child::before)\s*\{([^}]+)\}/)
        const root = document.createElement('div')
        root.className = 'nested-list'
        root.innerHTML = `
            <li class="nested-list-item" data-nested-list-hover="true" data-item-type="text">
                <div class="nested-list-item-content"><p>Parent</p><ul><li class="nested-list-item" data-item-type="text"><div class="nested-list-item-content"><p>Child</p></div></li></ul></div>
            </li>
        `
        const labels = root.querySelectorAll('p')
        const selector = markerRule?.[1].trim().replace('::before', '') ?? ''

        expect(markerRule?.[2]).toMatch(/visibility:\s*hidden/)
        expect(labels[0].matches(selector)).toBe(true)
        expect(labels[1].matches(selector)).toBe(false)
    })
})

describe('inline collapse indicator', () => {
    it('rotates only the collapsed item chevron', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'nested-list.scss'))
        const rule = css.match(/([^{}]*\.nested-list-collapsed > \.nested-list-item-content > p:first-child > \.nested-list-collapse svg)\s*\{([^}]+)\}/)
        const selector = rule?.[1].trim() ?? ''
        const root = document.createElement('div')
        root.innerHTML = `
            <li class="nested-list-item nested-list-collapsed">
                <div class="nested-list-item-content">
                    <p>Parent<button class="nested-list-collapse"><svg></svg></button></p>
                    <ul><li class="nested-list-item"><div class="nested-list-item-content"><p>Child<button class="nested-list-collapse"><svg></svg></button></p></div></li></ul>
                </div>
            </li>
        `
        const icons = root.querySelectorAll('svg')

        expect(rule?.[2]).toMatch(/rotate\(-90deg\)/)
        expect(icons[0].matches(selector)).toBe(true)
        expect(icons[1].matches(selector)).toBe(false)
    })
})

describe('nested list text cursor', () => {
    it('uses the default cursor in view mode and text cursor in edit mode', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'nested-list.scss'))
        const view = css.match(/\.nested-list\[data-mode=view\] \.nested-list-document\s*\{([^}]+)\}/)?.[1] ?? ''
        const edit = css.match(/\.nested-list\[data-mode=edit\] \.nested-list-document\s*\{([^}]+)\}/)?.[1] ?? ''

        expect(view).toMatch(/cursor:\s*default/)
        expect(edit).toMatch(/cursor:\s*text/)
    })
})

describe('drop line target coverage', () => {
    it('uses the same target rule for list items, paragraphs and headings', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, 'nested-list.scss'))
        const selector = css.match(/([^{}]*\[data-nested-list-drop\])\s*\{/)?.[1].trim() ?? ''
        const root = document.createElement('div')
        root.className = 'nested-list-document'
        root.innerHTML = '<ul><li class="nested-list-item" data-nested-list-drop="before"></li></ul><p data-nested-list-drop="after"></p><h1 data-nested-list-drop="before"></h1>'

        for (const target of root.querySelectorAll('[data-nested-list-drop]'))
            expect(target.matches(selector)).toBe(true)
    })
})
