// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    createApplicationPanel,
    type ApplicationPanelConfig,
    type ApplicationPanelInstance,
} from './applicationPanel.ts'
import {
    configureUiKit,
    uiKitSettings,
    type UiKitSettingsOverrides,
} from '../../runtime-settings.ts'

const panels: ApplicationPanelInstance[] = []

const mount = (overrides: Partial<ApplicationPanelConfig> = {}) => {
    const container = document.createElement('div')
    const content = document.createElement('div')
    container.append(content)
    document.body.append(container)
    const panel = createApplicationPanel({
        container,
        content,
        side: 'left',
        label: 'Navigation',
        open: true,
        ...overrides,
    })
    panels.push(panel)

    return {
        container,
        content,
        panel,
    }
}

afterEach(() => {
    for (const panel of panels.splice(0))
        panel.destroy()

    document.body.replaceChildren()
})

describe('ApplicationPanel', () => {
    it('mounts one surface with header, body and footer and its layers in a pane', () => {
        const {
            container,
            panel,
        } = mount()

        expect(panel.pane.parentElement).toBe(container)
        expect(panel.pane.classList.contains('application-panel-pane')).toBe(true)
        expect(panel.element.classList.contains('application-panel')).toBe(true)
        expect(panel.element.dataset.side).toBe('left')
        expect(panel.element.getAttribute('aria-label')).toBe('Navigation')
        expect([...panel.element.children].slice(0, 3)).toEqual([panel.header, panel.body, panel.footer])
        expect(panel.pane.querySelector('.side-panel-backdrop')).not.toBeNull()
        expect(panel.element.querySelector('.application-panel-resize-handle')).not.toBeNull()
        expect(panel.toggleElement?.classList.contains('application-panel-toggle')).toBe(true)
        expect(panel.toggleElement?.parentElement).toBe(panel.pane)
    })

    it('draws every panel from the shared settings on either side', () => {
        const left = mount().panel
        const right = mount({ side: 'right' }).panel
        const settings = uiKitSettings.applicationPanel

        for (const panel of [left, right]) {
            expect(panel.getWidth()).toBe(settings.dimensions.defaultWidth)
            expect(panel.pane.style.getPropertyValue('--application-panel-width')).toBe(`${settings.dimensions.defaultWidth}px`)
            expect(panel.pane.style.getPropertyValue('--side-panel-backdrop-fill')).toBe(settings.backdrop.fill)
            expect(panel.pane.style.getPropertyValue('--side-panel-backdrop-fill-opaque')).toBe(settings.backdrop.fillOpaque)
        }

        expect(right.element.dataset.side).toBe('right')
        expect(right.toggleElement?.classList.contains('side-panel-toggle-right')).toBe(true)
        expect(left.toggleElement?.classList.contains('side-panel-toggle-left')).toBe(true)
    })

    it('lets navigation rows run edge to edge and insets other content', () => {
        expect(mount().panel.element.dataset.body).toBe('list')
        expect(mount({ body: 'content' }).panel.element.dataset.body).toBe('content')
    })

    it('labels its toggle from the panel name and reflects the open state', async () => {
        const { panel } = mount()
        const button = panel.toggleElement?.querySelector('button')

        expect(button?.ariaLabel).toBe('Close navigation')
        await panel.setOpen(false, { animate: false })
        expect(panel.isOpen()).toBe(false)
        expect(button?.ariaLabel).toBe('Open navigation')
    })

    it('claims its width beside pushed content and releases it after closing', async () => {
        const {
            content,
            panel,
        } = mount({ placement: 'push' })
        const width = `${panel.getWidth()}px`

        expect(content.style.getPropertyValue('--application-panel-left-dock-width')).toBe(width)
        expect(content.style.getPropertyValue('--application-panel-left-inset')).toBe('0px')
        await panel.setOpen(false, { animate: false })
        expect(content.style.getPropertyValue('--application-panel-left-dock-width')).toBe('0px')
        await panel.setOpen(true, { animate: false })
        expect(content.style.getPropertyValue('--application-panel-left-dock-width')).toBe(width)
    })

    it('covers overlaid content without claiming its space', async () => {
        const {
            content,
            panel,
        } = mount({
            side: 'right',
            placement: 'overlay',
        })
        const width = `${panel.getWidth()}px`

        expect(content.style.getPropertyValue('--application-panel-right-dock-width')).toBe('0px')
        expect(content.style.getPropertyValue('--application-panel-right-inset')).toBe(width)
        await panel.setOpen(false, { animate: false })
        expect(content.style.getPropertyValue('--application-panel-right-inset')).toBe('0px')
    })

    it('hands toggle requests to the host when it decides the open state', () => {
        const onOpenChange = vi.fn()
        const { panel } = mount({ onOpenChange })

        panel.toggleElement?.querySelector('button')?.click()
        expect(onOpenChange).toHaveBeenCalledWith(false)
        expect(panel.isOpen()).toBe(true)
    })

    it('opens and closes itself without a host handler', async () => {
        const { panel } = mount({ open: false })

        panel.toggleElement?.querySelector('button')?.click()
        expect(panel.isOpen()).toBe(true)
    })

    it('keeps host widths for wide content and reports resizes', () => {
        const onResize = vi.fn()
        const { panel } = mount({
            defaultWidth: 494,
            minWidth: 320,
            onResize,
        })

        expect(panel.getWidth()).toBe(494)
        expect(panel.setWidth(100)).toBe(320)
        expect(panel.pane.style.getPropertyValue('--application-panel-width')).toBe('320px')
    })

    it('removes its layers and docking values on destroy', () => {
        const {
            container,
            content,
            panel,
        } = mount()

        panel.destroy()
        expect(container.querySelector('.application-panel-pane')).toBeNull()
        expect(content.style.getPropertyValue('--application-panel-left-dock-width')).toBe('')
        expect(content.style.getPropertyValue('--application-panel-left-inset')).toBe('')
    })

    it('does not let a host override the shared panel look', () => {
        const before = uiKitSettings.applicationPanel
        const overrides = { applicationPanel: { placement: 'overlay' } } as unknown as UiKitSettingsOverrides

        configureUiKit(overrides)
        expect(uiKitSettings.applicationPanel).toBe(before)
    })
})
