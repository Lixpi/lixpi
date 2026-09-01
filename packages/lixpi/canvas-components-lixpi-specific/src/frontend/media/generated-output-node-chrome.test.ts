// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    GeneratedOutputNodeChrome,
    type GeneratedOutputChromeState,
    type GeneratedOutputNodeChromeOptions,
} from './generated-output-node-chrome.ts'

const owners: GeneratedOutputNodeChrome[] = []
function fixture(state: Partial<GeneratedOutputChromeState> = {}, kind: 'media' | 'artifact' = 'media') {
    const badge = document.createElement('div')
    badge.className = 'model-badge-fixture'
    const titleCleanup = vi.fn()
    const options: GeneratedOutputNodeChromeOptions = {
        document,
        nodeId: 'node',
        kind,
        state: { pendingBeforeFrame: false, generated: true, hasAsset: true, accepted: false, superseded: false, reviewReady: true, rejectable: true, analyzing: false, progressActive: false, selected: false, ...state },
        modelBadge: badge,
        settings: { gap: 8, zoomScaling: { minZoom: 0.4 } },
        mountTitle: vi.fn(() => titleCleanup),
        onOpenDetails: vi.fn(),
        onAccept: vi.fn(),
        onReject: vi.fn(),
        onRegenerate: vi.fn(),
    }
    const chrome = new GeneratedOutputNodeChrome(options)
    document.body.appendChild(chrome.element)
    owners.push(chrome)
    const button = (selector: string) => chrome.element.querySelector<HTMLButtonElement>(selector)!
    return { chrome, options, titleCleanup, button }
}
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
})

describe('GeneratedOutputNodeChrome', () => {
    it.each(['media', 'artifact'] as const)('composes %s review actions and details with one shared footer', kind => {
        const f = fixture({}, kind)
        expect(f.chrome.element.querySelectorAll('.canvas-node-footer')).toHaveLength(1)
        expect(f.chrome.element.querySelector('.model-badge-fixture')).not.toBeNull()
        f.button('.media-review-accept').click()
        f.button('.media-review-regenerate').click()
        f.button('.canvas-node-footer-info-button').click()
        expect(f.options.onAccept).toHaveBeenCalledOnce()
        expect(f.options.onRegenerate).toHaveBeenCalledOnce()
        expect(f.options.onOpenDetails).toHaveBeenCalledOnce()
        if (kind === 'media') {
            f.button('.media-review-reject').click()
            expect(f.options.onReject).toHaveBeenCalledOnce()
        } else expect(f.chrome.element.querySelector('.media-review-reject')).toBeNull()
        expect(f.options.mountTitle).toHaveBeenCalledWith(f.chrome.element.querySelector('.workspace-generated-media-title'))
    })

    it('leaves pending media with its title, info and progress but hides badge and review actions', () => {
        const f = fixture({ pendingBeforeFrame: true, progressActive: true })
        expect(f.chrome.element.querySelector('.model-badge-fixture')).toBeNull()
        expect(f.chrome.element.querySelector('.media-review-action')).toBeNull()
        expect(f.button('.canvas-node-footer-info-button')).not.toBeNull()
        f.button('.canvas-node-footer-progress-button').click()
        expect(f.options.onOpenDetails).toHaveBeenCalledOnce()
        expect(f.options.mountTitle).toHaveBeenCalledOnce()
    })

    it.each([{ generated: false }, { accepted: true }, { superseded: true }])('omits review actions for %j', state => {
        const f = fixture({ ...state, rejectable: false })
        expect(f.chrome.element.querySelector('.media-review-action')).toBeNull()
        expect(f.button('.canvas-node-footer-info-button')).not.toBeNull()
    })

    it('permits terminal media review before Asset hydration and waits for artifact metadata', () => {
        const media = fixture({ hasAsset: false })
        expect(media.button('.media-review-accept').disabled).toBe(false)
        expect(media.button('.media-review-regenerate').disabled).toBe(false)
        const artifact = fixture({ hasAsset: false }, 'artifact')
        expect(artifact.chrome.element.querySelector('.media-review-action')).toBeNull()
    })

    it('keeps rejection enabled during generation while acceptance and replay wait for sealing', () => {
        const f = fixture({ reviewReady: false, progressActive: true })
        expect(f.button('.media-review-accept').disabled).toBe(true)
        expect(f.button('.media-review-regenerate').disabled).toBe(true)
        const reject = f.button('.media-review-reject')
        expect(reject.disabled).toBe(false)
        expect(reject.getAttribute('aria-label')).toBe('Cancel generation and delete output')
        reject.click()
        f.button('.media-review-accept').dispatchEvent(new MouseEvent('click'))
        expect(f.options.onReject).toHaveBeenCalledOnce()
        expect(f.options.onAccept).not.toHaveBeenCalled()
    })

    it('aligns the title to the node top while reserving the playback row below its footer', () => {
        const f = fixture()
        f.chrome.setGeometry({ x: 100, y: 200, width: 400, height: 240 }, { x: 10, y: 20, zoom: 1 }, 48)
        expect(f.chrome.element.style.left).toBe('110px')
        expect(parseFloat(f.chrome.element.style.top)).toBeGreaterThanOrEqual(508)
        const title = f.chrome.element.querySelector('.workspace-generated-media-title') as HTMLElement
        expect(parseFloat(f.chrome.element.style.top) + parseFloat(title.style.top)).toBe(218)
        f.chrome.setGeometry({ x: 100, y: 200, width: 100, height: 100 }, { x: 0, y: 0, zoom: 0.25 })
        expect(f.chrome.element.style.left).toBe('25px')
        expect(f.chrome.element.style.transform).not.toContain('NaN')
        expect(parseFloat(f.chrome.element.style.top)).toBeGreaterThanOrEqual(75)
    })

    it('updates progress and selection without remounting the title, then disposes action listeners', () => {
        const f = fixture()
        const accept = f.button('.media-review-accept')
        const details = f.button('.canvas-node-footer-info-button')
        f.chrome.update({ progressActive: true, selected: true })
        expect(details.getAttribute('aria-expanded')).toBe('true')
        expect(f.button('.canvas-node-footer-progress-button').hidden).toBe(false)
        expect(f.options.mountTitle).toHaveBeenCalledOnce()
        f.chrome.destroy()
        accept.dispatchEvent(new MouseEvent('click'))
        details.dispatchEvent(new MouseEvent('click'))
        expect(f.options.onAccept).not.toHaveBeenCalled()
        expect(f.options.onOpenDetails).not.toHaveBeenCalled()
        expect(f.titleCleanup).toHaveBeenCalledOnce()
    })

    it('releases the footer and its actions when title mounting fails', () => {
        const f = fixture()
        let failed: HTMLElement | undefined
        expect(() =>
            new GeneratedOutputNodeChrome({
                ...f.options,
                mountTitle: host => {
                    failed = host.parentElement!
                    throw new Error('title unavailable')
                },
            })
        ).toThrow('title unavailable')
        failed?.querySelector('.media-review-accept')?.dispatchEvent(new MouseEvent('click'))
        expect(f.options.onAccept).not.toHaveBeenCalled()
        expect(failed?.isConnected).toBe(false)
    })
})
