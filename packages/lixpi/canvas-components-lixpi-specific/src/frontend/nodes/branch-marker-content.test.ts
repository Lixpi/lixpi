// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    BranchMarkerContent,
    type BranchMarkerContentOptions,
} from './branch-marker-content.ts'

const views: BranchMarkerContent[] = []
afterEach(() => {
    for (const view of views.splice(0)) view.destroy()
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

function mount(overrides: Partial<BranchMarkerContentOptions> = {}) {
    const preview = { dom: document.createElement('span'), destroy: vi.fn() }
    preview.dom.textContent = '@Frame'
    const options: BranchMarkerContentOptions = {
        document,
        label: 'Start branch',
        headerHeight: 42,
        promptParts: [{ type: 'text', text: 'Use ' }, { type: 'media', reference: { referenceType: 'media', assetId: 'frame', mediaKind: 'image', displayName: 'Frame' } }],
        renderReference: () => preview,
        reasoningModel: { title: 'Reasoning <model>', icon: null },
        mediaModels: [{ title: 'Image model', icon: null, label: 'Image', glassImage: '', textureImage: '' }],
        modelSummary: 'Image: Image model',
        responseText: 'A response',
        responsePhase: 'preamble',
        responseIsReceiving: true,
        showResponseLine: true,
        pending: true,
        active: true,
        tooltipHideDelayMs: 0,
        ...overrides,
    }
    const view = new BranchMarkerContent(options)
    views.push(view)
    document.body.appendChild(view.element)
    return { view, preview }
}

describe('BranchMarkerContent', () => {
    it('keeps the prompt separate from streaming reasoning and owns its preview and tooltips', () => {
        const { view, preview } = mount()
        expect(view.element.querySelector('.workspace-branch-marker-message-text')?.textContent).toBe('Use @Frame')
        expect(view.element.querySelector('.workspace-branch-marker-response-text')?.textContent).toBe('A response')
        expect(view.element.querySelector('.workspace-branch-marker-response-spinner')).not.toBeNull()
        expect(view.element.querySelector('.workspace-branch-marker-message-progress')).toBeNull()
        expect(view.element.getAttribute('aria-label')).toContain('Reasoning: Reasoning <model>')
        const trigger = view.element.querySelector<HTMLElement>('.workspace-branch-marker-reasoning-tooltip-trigger')!
        trigger.dispatchEvent(new FocusEvent('focusin'))
        expect(document.body.querySelector('.help-tooltip-content')).not.toBeNull()
        view.destroy()
        view.destroy()
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
        expect(preview.destroy).toHaveBeenCalledOnce()
        expect(view.element.isConnected).toBe(false)
    })

    it('lets the progress timeline replace the standalone response and releases nested views', () => {
        const progress = { element: document.createElement('section'), destroy: vi.fn() }
        const referenceResolution = { element: document.createElement('section'), destroy: vi.fn() }
        const { view } = mount({ progress, referenceResolution })
        expect(view.element.classList.contains('has-progress')).toBe(true)
        expect(view.element.querySelector('.workspace-branch-marker-response')).toBeNull()
        expect(view.element.querySelector('.workspace-branch-marker-message-progress')).not.toBeNull()
        expect(view.element.contains(progress.element)).toBe(true)
        expect(view.element.contains(referenceResolution.element)).toBe(true)
        expect(view.element.style.getPropertyValue('--workspace-branch-marker-header-center')).toBe('21px')
        view.destroy()
        expect(progress.destroy).toHaveBeenCalledOnce()
        expect(referenceResolution.destroy).toHaveBeenCalledOnce()
    })

    it('aligns replacement spinners and isolates views of the same branch', () => {
        vi.spyOn(document.defaultView!.performance, 'now').mockReturnValue(1250)
        const a = mount()
        const b = mount()
        const spinner = b.view.element.querySelector<HTMLElement>('.workspace-branch-marker-spinner')!
        expect(spinner.style.animationDelay).toBe('-450ms')
        const aTrigger = a.view.element.querySelector('[aria-describedby]')!
        const bTrigger = b.view.element.querySelector('[aria-describedby]')!
        expect(aTrigger.getAttribute('aria-describedby')).not.toBe(bTrigger.getAttribute('aria-describedby'))
        a.view.destroy()
        expect(b.view.element.isConnected).toBe(true)
        expect(b.preview.destroy).not.toHaveBeenCalled()
    })

    it('releases supplied child views when rendering a reference fails', () => {
        const progress = { element: document.createElement('section'), destroy: vi.fn() }
        const referenceResolution = { element: document.createElement('section'), destroy: vi.fn() }
        expect(() =>
            mount({
                progress,
                referenceResolution,
                renderReference: () => {
                    throw new Error('Preview failed')
                },
            })
        ).toThrow('Preview failed')
        expect(progress.destroy).toHaveBeenCalledOnce()
        expect(referenceResolution.destroy).toHaveBeenCalledOnce()
    })
})
