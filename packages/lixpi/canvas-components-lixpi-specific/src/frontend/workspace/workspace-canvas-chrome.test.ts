// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    WorkspaceCanvasChrome,
    type WorkspaceCanvasChromePorts,
    type WorkspaceCanvasChromeSettings,
} from './workspace-canvas-chrome.ts'

const owners: WorkspaceCanvasChrome[] = []
function setup(palette = { steelBlue: '#5d656d', nightBlue: '#42494f', offWhite: '#f5f3f3' }) {
    vi.useFakeTimers()
    const settings: WorkspaceCanvasChromeSettings = {
        panel: {
            defaultDimensions: { width: 500 },
            dimensions: { maxPaneMargin: 30 },
            layout: { contentInset: 12 },
            typography: { contentFontSize: 14, tagPillFontSize: 12, tagPillFontWeight: 500 },
            styles: { backdropFill: '#fff', backdropFillOpaque: '#fff', toggleColor: '#111', toggleHoverColor: '#222' },
        },
        modelMenuHoverBackground: '#abc',
        palette,
    }
    const ports: WorkspaceCanvasChromePorts = {
        document,
        createDocument: vi.fn(async () => {}),
        uploadFile: vi.fn(async () => {}),
        importUrl: vi.fn(async () => {}),
        toggleMediaLibrary: vi.fn(),
        reportError: vi.fn(),
    }
    const owner = new WorkspaceCanvasChrome(settings, ports)
    owners.push(owner)
    document.body.append(owner.element)
    const button = (label: string) => owner.element.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
    const openUrl = () => {
        button('Add Image').click()
        owner.element.querySelectorAll<HTMLButtonElement>('.workspace-image-submenu-option')[1].click()
        return owner.element.querySelector<HTMLInputElement>('input[type="url"]')!
    }
    return { owner, ports, button, openUrl }
}

afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
    vi.useRealTimers()
})

describe('workspace canvas chrome', () => {
    it('exposes independent renderer and control mounts without creating generic controls', () => {
        const { owner, button, ports } = setup()
        expect(owner.pane.contains(owner.viewportMount)).toBe(true)
        expect(owner.element.contains(owner.mediaModeSwitchMount)).toBe(true)
        expect(owner.element.contains(owner.modelMenuControlMount)).toBe(true)
        expect(owner.glassTargets).toHaveLength(3)
        for (const target of owner.glassTargets) expect(owner.element.contains(target.element)).toBe(true)
        button('New Document').click()
        button('Media Library').click()
        expect(ports.createDocument).toHaveBeenCalledOnce()
        expect(ports.toggleMediaLibrary).toHaveBeenCalledOnce()
        expect(button('Media Library').dataset.helpTooltip).toBe('aria-label')
        expect(button('Media Library').closest('.workspace-canvas-left-control-rail')).not.toBeNull()
        expect(button('Media Library').closest('.workspace-canvas-right-control-rail')).toBeNull()
    })

    it('keeps zoom, panel state and color configuration local to each canvas', () => {
        const first = setup()
        const second = setup({ steelBlue: '#112233', nightBlue: '#445566', offWhite: '#ffffff' })
        first.owner.setZoom(0.755)
        first.owner.setRightPanelOpen(true)
        expect(first.owner.element.querySelector('.workspace-zoom-indicator')?.textContent).toBe('76%')
        expect(second.owner.element.querySelector('.workspace-zoom-indicator')?.textContent).toBe('100%')
        expect(first.owner.element.classList.contains('workspace-canvas-right-side-panel-open')).toBe(true)
        expect(second.owner.element.classList.contains('workspace-canvas-right-side-panel-open')).toBe(false)
        expect(first.owner.element.style.getPropertyValue('--workspace-chrome-steel-blue')).toBe('#5d656d')
        expect(second.owner.element.style.getPropertyValue('--workspace-chrome-steel-blue')).toBe('#112233')
        expect(document.documentElement.style.getPropertyValue('--workspace-chrome-steel-blue')).toBe('')
    })

    it('retains URL entry when navigating back and submits it by Enter or the Add button', () => {
        const { owner, ports, openUrl } = setup()
        let input = openUrl()
        input.value = 'https://example.test/image'
        input.dispatchEvent(new Event('input'))
        owner.element.querySelector<HTMLButtonElement>('.workspace-image-submenu-url-back')!.click()
        owner.element.querySelectorAll<HTMLButtonElement>('.workspace-image-submenu-option')[1].click()
        input = owner.element.querySelector<HTMLInputElement>('input[type="url"]')!
        expect(input.value).toBe('https://example.test/image')
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
        owner.element.querySelector<HTMLButtonElement>('.workspace-image-submenu-url-insert')!.click()
        expect(ports.importUrl).toHaveBeenCalledTimes(2)
        expect(ports.importUrl).toHaveBeenCalledWith('https://example.test/image')
        owner.closeUploadMenu()
        expect(owner.element.querySelector('.workspace-image-submenu')).toBeNull()
    })

    it('forwards the chosen file and resets the hidden input for another selection', () => {
        const { owner, ports, button } = setup()
        button('Add Image').click()
        const input = owner.element.querySelector<HTMLInputElement>('input[type="file"]')!
        const file = new File(['bytes'], 'clip.mov')
        Object.defineProperty(input, 'files', { value: [file] })
        input.dispatchEvent(new Event('change'))
        expect(ports.uploadFile).toHaveBeenCalledWith(file)
        expect(input.value).toBe('')
        expect(owner.element.querySelector('.workspace-image-submenu')).toBeNull()
    })

    it('closes outside its wrapper and cancels pending document listeners on disposal', async () => {
        const { owner, button } = setup()
        button('Add Image').click()
        await vi.advanceTimersByTimeAsync(0)
        owner.pane.click()
        expect(owner.element.querySelector('.workspace-image-submenu')).toBeNull()
        button('Add Image').click()
        owner.destroy()
        expect(vi.getTimerCount()).toBe(0)
        expect(document.body.contains(owner.element)).toBe(false)
        button('Add Image').click()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('does not admit detached button actions or report a late failure after destruction', async () => {
        const { owner, ports, button } = setup()
        let fail!: (error: Error) => void
        ports.createDocument = vi.fn(() =>
            new Promise((_resolve, reject) => {
                fail = reject
            })
        )
        button('New Document').click()
        owner.destroy()
        button('Media Library').click()
        fail(new Error('late'))
        await vi.advanceTimersByTimeAsync(0)
        expect(ports.toggleMediaLibrary).not.toHaveBeenCalled()
        expect(ports.reportError).not.toHaveBeenCalled()
    })
})
