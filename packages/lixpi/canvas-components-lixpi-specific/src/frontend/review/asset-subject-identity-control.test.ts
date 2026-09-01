// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type Asset,
    type SubjectIdentityClassification,
} from '@lixpi/constants'

import {
    mountAssetSubjectIdentityControl,
    type AssetSubjectIdentityControlInstance,
} from './asset-subject-identity-control.ts'

const controls: AssetSubjectIdentityControlInstance[] = []

afterEach(() => {
    for (const control of controls.splice(0)) control.destroy()
    document.body.replaceChildren()
})

function asset(assetId = 'asset-a', revision = 7, classification: SubjectIdentityClassification = 'unknown'): Asset {
    return { assetId, revision, subjectIdentity: { classification } } as Asset
}

function mount() {
    const host = document.createElement('div')
    document.body.append(host)
    const pending = Promise.withResolvers<Asset | { error: string }>()
    const attestSubjectIdentity = vi.fn(() => pending.promise)
    const onUpdated = vi.fn()
    const onError = vi.fn()
    const control = mountAssetSubjectIdentityControl({ host, asset: asset(), attestSubjectIdentity, onUpdated, onError })
    controls.push(control)
    const choose = (label: string) => {
        const item = Array.from(host.querySelectorAll<HTMLElement>('.dropdown-option-item'))
            .find(element => element.textContent?.trim() === label)
        expect(item).toBeDefined()
        item!.click()
    }
    return { host, control, pending, attestSubjectIdentity, onUpdated, onError, choose }
}

describe('Asset subject identity control', () => {
    it('sends the Asset revision through its mutation port and adopts the returned Asset', async () => {
        const view = mount()
        view.choose('Me')
        expect(view.attestSubjectIdentity).toHaveBeenCalledWith('asset-a', 7, 'self')
        const updated = asset('asset-a', 8, 'self')
        view.pending.resolve(updated)
        await view.pending.promise
        expect(view.onUpdated).toHaveBeenCalledWith(updated)
        expect(view.host.querySelector('button')?.ariaLabel).toBe('Subject identity: I am the depicted person')
    })

    it('prevents concurrent mutations and restores the selection when the server rejects a change', async () => {
        const view = mount()
        view.choose('Me')
        view.choose('Fictional')
        expect(view.attestSubjectIdentity).toHaveBeenCalledOnce()
        view.pending.resolve({ error: 'Asset revision changed' })
        await view.pending.promise
        expect(view.onError).toHaveBeenCalledWith('Asset revision changed')
        expect(view.host.querySelector('button')?.ariaLabel).toBe('Subject identity: Unknown subject identity')
        expect(view.onUpdated).not.toHaveBeenCalled()
    })

    it.each(['resolve', 'reject'] as const)('ignores a late %s after the control switches to another Asset', async outcome => {
        const view = mount()
        view.choose('Me')
        view.control.setAsset(asset('asset-b', 2, 'fictional'))
        if (outcome === 'resolve') view.pending.resolve(asset('asset-a', 8, 'self'))
        else view.pending.reject(new Error('Disconnected'))
        await Promise.allSettled([view.pending.promise])
        expect(view.onUpdated).not.toHaveBeenCalled()
        expect(view.onError).not.toHaveBeenCalled()
        expect(view.host.querySelector('button')?.ariaLabel).toBe('Subject identity: Fictional subject')
    })

    it.each(['success', 'error'] as const)('retains a newer Asset revision when a prior mutation returns %s', async outcome => {
        const view = mount()
        view.choose('Me')
        view.control.setAsset(asset('asset-a', 9, 'fictional'))
        view.pending.resolve(outcome === 'success' ? asset('asset-a', 8, 'self') : { error: 'stale' })
        await view.pending.promise
        expect(view.host.querySelector('button')?.ariaLabel).toBe('Subject identity: Fictional subject')
        expect(view.onUpdated).not.toHaveBeenCalled()
        view.control.setAsset(asset('asset-a', 7, 'unknown'))
        expect(view.host.querySelector('button')?.ariaLabel).toBe('Subject identity: Fictional subject')
    })

    it('isolates instances displaying the same Asset and ignores callbacks after disposal', async () => {
        const first = mount()
        const second = mount()
        expect(first.host.firstElementChild?.getAttribute('data-dropdown-id'))
            .not.toBe(second.host.firstElementChild?.getAttribute('data-dropdown-id'))
        first.choose('Me')
        first.control.destroy()
        first.control.destroy()
        first.control.setAsset(asset('asset-b'))
        first.pending.resolve(asset('asset-a', 8, 'self'))
        await first.pending.promise
        expect(first.host.childElementCount).toBe(0)
        expect(first.onUpdated).not.toHaveBeenCalled()
        expect(second.host.querySelector('button')?.ariaLabel).toBe('Subject identity: Unknown subject identity')
        expect(second.attestSubjectIdentity).not.toHaveBeenCalled()
    })
})
