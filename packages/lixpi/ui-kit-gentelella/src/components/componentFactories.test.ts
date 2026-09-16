import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { createGentelellaBanner } from './banner/banner.ts'
import { createGentelellaButton } from './button/button.ts'
import { createGentelellaCard } from './card/card.ts'
import { createGentelellaChip } from './chip/chip.ts'
import { createGentelellaDrawer } from './drawer/drawer.ts'
import { createGentelellaEmptyState } from './emptyState/emptyState.ts'
import {
    applyGentelellaFormControl,
    createGentelellaFormActions,
    createGentelellaFormField,
} from './form/form.ts'
import { createGentelellaChoice } from './formControls/formControls.ts'
import { createGentelellaBadge } from './foundation/foundation.ts'
import { createGentelellaInputGroup } from './inputGroup/inputGroup.ts'
import { createGentelellaPage } from './page/page.ts'
import { createGentelellaPageHeader } from './pageHeader/pageHeader.ts'
import { createGentelellaSpinner } from './spinner/spinner.ts'
import { createGentelellaStatus } from './status/status.ts'
import { createGentelellaTable } from './table/table.ts'
import { createGentelellaTabs } from './tabs/tabs.ts'

afterEach(() => void document.body.replaceChildren())

describe('Gentelella component factories', () => {
    it('mounts the spinner only while busy, despite the theme display rule', () => {
        const style = document.createElement('style')
        style.textContent = '.btn-spinner { display: inline-block; }'
        document.body.append(style)
        const button = createGentelellaButton({ label: 'Refresh balances' })
        document.body.append(button.el)

        expect(button.el.querySelector('.btn-spinner')).toBeNull()
        expect(button.el.hasAttribute('aria-busy')).toBe(false)

        button.setBusy(true)
        button.setBusy(true)
        expect(button.el.querySelectorAll('.btn-spinner')).toHaveLength(1)
        expect(button.el.getAttribute('aria-busy')).toBe('true')

        button.setBusy(false)
        expect(button.el.querySelector('.btn-spinner')).toBeNull()
        expect(button.el.hasAttribute('aria-busy')).toBe(false)
        expect(button.el.textContent).toBe('Refresh balances')

        button.setBusy(true)
        expect(button.el.querySelectorAll('.btn-spinner')).toHaveLength(1)
        button.setBusy(false)
        expect(button.el.querySelector('.btn-spinner')).toBeNull()
    })

    it('builds and updates interactive controls', () => {
        const onClick = vi.fn()
        const button = createGentelellaButton({
            iconHtml: '<svg></svg>',
            label: 'Run',
            onClick,
            variant: 'primary',
        })
        document.body.append(button.el)
        button.el.click()
        button.setBusy(true)
        button.setDisabled(true)
        button.setLabel('Running')

        expect(onClick).toHaveBeenCalledOnce()
        expect(button.el.className).toBe('btn btn-primary')
        expect(button.el.getAttribute('aria-busy')).toBe('true')
        expect(button.el.disabled).toBe(true)
        expect(button.el.textContent).toBe('Running')

        button.setBusy(false)
        expect(button.el.querySelector('svg')).not.toBeNull()
        button.destroy()
        expect(document.body.children).toHaveLength(0)
    })

    it('composes page, header, card, input, form, and feedback elements', () => {
        const input = applyGentelellaFormControl(document.createElement('input'), 'catalog-input')
        const inputGroup = createGentelellaInputGroup({
            control: input,
            iconHtml: '<svg></svg>',
        })
        const field = createGentelellaFormField({
            control: document.createElement('textarea'),
            error: 'Required',
            label: 'Notes',
        })
        const actions = createGentelellaFormActions({ content: 'Actions' })
        const banner = createGentelellaBanner({
            body: 'Check the values.',
            title: 'Incomplete',
            variant: 'warning',
        })
        const emptyState = createGentelellaEmptyState({
            description: 'Change the filters.',
            title: 'No matches',
        })
        const header = createGentelellaPageHeader({
            actions: actions.el,
            pretitle: 'Catalog',
            title: 'Models',
        })
        const card = createGentelellaCard({
            content: [
                inputGroup.el,
                field.el,
                banner.el,
                emptyState.el,
            ],
            subtitle: 'Reusable content',
            title: 'Filters',
        })
        const page = createGentelellaPage({ content: [header.el, card.el] })
        document.body.append(page.el)

        expect(page.el.classList.contains('page-wrapper')).toBe(true)
        expect(page.el.querySelector('.page-title')?.textContent).toBe('Models')
        expect(input.className).toBe('form-control catalog-input')
        expect(field.el.querySelector('.form-error')?.textContent).toBe('Required')
        expect(page.el.querySelector('.banner-warning')).not.toBeNull()
        expect(page.el.querySelector('.empty-state-title')?.textContent).toBe('No matches')

        field.setError(null)
        expect((field.el.querySelector('.form-error') as HTMLElement).hidden).toBe(true)
        page.destroy()
    })

    it('builds drawer, table, status, spinner, and chip primitives', () => {
        const onBackdropClick = vi.fn()
        const drawer = createGentelellaDrawer({
            body: 'Drawer body',
            header: 'Drawer header',
            onBackdropClick,
        })
        const table = createGentelellaTable()
        const status = createGentelellaStatus({
            label: 'Ready',
            tone: 'green',
        })
        const spinner = createGentelellaSpinner({
            label: 'Loading',
            size: 'small',
        })
        const chip = createGentelellaChip({
            data: {
                role: 'filter',
                value: 'image',
            },
            label: 'Image',
        })
        const badge = createGentelellaBadge({
            attributes: { 'data-state': 'ready' },
            content: 'Ready',
            tone: 'blue',
        })
        const choice = createGentelellaChoice({
            inputAttributes: {
                'data-id': 'image-size',
                'data-role': 'use',
            },
            label: 'Use',
            name: 'image-size:use',
            type: 'checkbox',
        })
        document.body.append(
            drawer.backdropEl,
            drawer.el,
            table.el,
            status.el,
            spinner.el,
            chip.el,
            badge.el,
            choice.el,
        )
        drawer.backdropEl.click()
        drawer.setOpen(true)

        expect(onBackdropClick).toHaveBeenCalledOnce()
        expect(drawer.bodyEl.textContent).toBe('Drawer body')
        expect(drawer.el.classList.contains('open')).toBe(true)
        expect(drawer.backdropEl.classList.contains('open')).toBe(true)
        expect(table.el.classList.contains('table-responsive')).toBe(true)
        expect(table.tableEl.classList.contains('table')).toBe(true)
        expect(status.el.className).toBe('status status-green')
        expect(spinner.el.className).toBe('spinner spinner-sm')
        expect(chip.el.className).toBe('chip')
        expect(chip.el.dataset).toMatchObject({
            role: 'filter',
            value: 'image',
        })
        expect(badge.el.dataset.state).toBe('ready')
        expect(choice.inputEl.dataset).toMatchObject({
            id: 'image-size',
            role: 'use',
        })

        drawer.destroy()
        table.destroy()
        status.destroy()
        spinner.destroy()
        chip.destroy()
        badge.destroy()
        choice.destroy()
    })

    it('owns tab selection state and reports changes', () => {
        const onSelect = vi.fn()
        const tabs = createGentelellaTabs({
            activeValue: 'merged',
            ariaLabel: 'Model files',
            items: [
                {
                    label: 'Merged',
                    value: 'merged',
                },
                {
                    label: 'Authored',
                    value: 'authored',
                },
            ],
            onSelect,
        })
        document.body.append(tabs.el)
        const buttons = tabs.el.querySelectorAll('button')
        buttons[1].click()

        expect(onSelect).toHaveBeenCalledWith(
            'authored',
            expect.any(MouseEvent),
        )
        expect(buttons[0].getAttribute('aria-selected')).toBe('false')
        expect(buttons[1].getAttribute('aria-selected')).toBe('true')
        expect(buttons[1].className).toBe('tab active')
        tabs.destroy()
    })
})
