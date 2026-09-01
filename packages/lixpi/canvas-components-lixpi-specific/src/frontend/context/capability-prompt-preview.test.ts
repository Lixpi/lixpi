// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CapabilityModuleMeta,
} from '@lixpi/constants'
import {
    CapabilityModulePromiseCache,
    createCapabilityPromptReferencePreview,
    renderCapabilityDescriptionCard,
} from './capability-prompt-preview.ts'

const metadata = {
    moduleId: 'test-module',
    name: 'Test module',
    descriptionSheet: { purpose: 'Test purpose', expectedInputs: [], bestResults: ['Use context'], limitations: ['Needs input'], executionCharacteristics: { summary: 'Creates output', cost: 'low', latency: 'low' } },
} as CapabilityModuleMeta
const owners: ReturnType<typeof createCapabilityPromptReferencePreview>[] = []
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
})

function mount(load: () => Promise<CapabilityModuleMeta>, cache?: CapabilityModulePromiseCache) {
    const preview = createCapabilityPromptReferencePreview({ moduleId: 'test-module', displayName: 'Test module' }, {
        environment: { document, tooltipHideDelayMs: 0 },
        getCapabilityModule: load,
        capabilityModuleCache: cache,
    }, { inlinePopover: true })
    owners.push(preview)
    document.body.appendChild(preview.dom)
    const open = () => preview.dom.querySelector<HTMLElement>('.context-preview-inline-trigger')!.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
    return { preview, open }
}

describe('Capability prompt preview', () => {
    it('shares only an explicitly supplied metadata cache and keeps a surviving preview active', async () => {
        const cache = new CapabilityModulePromiseCache()
        const pending = Promise.withResolvers<CapabilityModuleMeta>()
        const load = vi.fn(() => pending.promise)
        const first = mount(load, cache)
        const second = mount(load, cache)
        first.open()
        second.open()
        expect(load).toHaveBeenCalledOnce()
        first.preview.destroy()
        pending.resolve(metadata)
        await vi.waitFor(() => expect(second.preview.dom.querySelector('.capability-description-card')).not.toBeNull())
        expect(first.preview.dom.querySelector('.capability-description-card')).toBeNull()
    })

    it('retries failed metadata requests and releases the old retry listener', async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(metadata)
        const f = mount(load)
        f.open()
        await vi.waitFor(() => expect(f.preview.dom.querySelector('.capability-description-retry')).not.toBeNull())
        const retry = f.preview.dom.querySelector<HTMLButtonElement>('.capability-description-retry')!
        retry.click()
        await vi.waitFor(() => expect(f.preview.dom.querySelector('.capability-description-card')).not.toBeNull())
        f.preview.destroy()
        retry.click()
        expect(load).toHaveBeenCalledTimes(2)
    })

    it('does not let a rejected pre-clear request evict a replacement cache entry', async () => {
        const cache = new CapabilityModulePromiseCache()
        const old = Promise.withResolvers<CapabilityModuleMeta>()
        const first = cache.get('test-module', () => old.promise)
        const rejected = expect(first).rejects.toThrow('old failure')
        cache.clear()
        const replacement = cache.get('test-module', async () => metadata)
        old.reject(new Error('old failure'))
        await rejected
        expect(cache.get('test-module', vi.fn())).toBe(replacement)
        expect(await replacement).toBe(metadata)
    })

    it('gives repeated cards independent accessible section identities', () => {
        const first = renderCapabilityDescriptionCard(metadata, document)
        const second = renderCapabilityDescriptionCard(metadata, document)
        const firstLabel = first.querySelector('section')!.getAttribute('aria-labelledby')
        const secondLabel = second.querySelector('section')!.getAttribute('aria-labelledby')
        expect(firstLabel).not.toBe(secondLabel)
        expect(first.querySelector('h3')!.id).toBe(firstLabel)
        expect(second.querySelector('h3')!.id).toBe(secondLabel)
    })
})
