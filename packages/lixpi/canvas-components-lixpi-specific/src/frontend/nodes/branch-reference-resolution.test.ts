// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type OperationStatusCanvasNode,
} from '@lixpi/constants'
import {
    createBranchReferenceResolution,
    type BranchReferenceResolution,
    type BranchReferenceResolutionOptions,
} from './branch-reference-resolution.ts'

const views: BranchReferenceResolution[] = []
afterEach(() => {
    for (const view of views.splice(0)) view.destroy()
    document.body.replaceChildren()
})

function fixture() {
    const pending = Promise.withResolvers<unknown>()
    const previews: Array<{ dom: HTMLElement; destroy: ReturnType<typeof vi.fn> }> = []
    const resolveReference = vi.fn(() => pending.promise)
    const options: BranchReferenceResolutionOptions = {
        document,
        operation: { generationRequestId: 'request', requestRevision: 3, unresolvedBindingId: 'binding', candidateAssetIds: ['a', 'b', 'a'] } as OperationStatusCanvasNode,
        candidates: ['a', 'b', 'unrelated'].map(assetId => ({ referenceType: 'media', assetId, displayName: assetId, mediaKind: 'image' })),
        resolveReference,
        renderReference: reference => {
            const dom = document.createElement('span')
            dom.textContent = reference.displayName
            const view = { dom, destroy: vi.fn() }
            previews.push(view)
            return view
        },
    }
    const mount = () => {
        const view = createBranchReferenceResolution(options)
        if (view) {
            views.push(view)
            document.body.append(view.element)
        }
        return view
    }
    return { options, mount, previews, pending, resolveReference }
}

describe('BranchReferenceResolution', () => {
    it('renders only distinct authorized candidates and sends their binding and revision', () => {
        const test = fixture()
        const view = test.mount()!
        expect(test.previews.map(preview => preview.dom.textContent)).toEqual(['a', 'b'])
        expect(view.element.querySelector('[aria-label="Use @a"]')).toBe(test.previews[0]!.dom)
        test.previews[0]!.dom.click()
        test.previews[1]!.dom.click()
        expect(test.resolveReference).toHaveBeenCalledExactlyOnceWith({ generationRequestId: 'request', requestRevision: 3, bindingId: 'binding', assetId: 'a' })
        expect(test.previews.every(preview => preview.dom.getAttribute('aria-disabled') === 'true')).toBe(true)
    })

    it('restores choices after rejection and supports keyboard selection', async () => {
        const test = fixture()
        const view = test.mount()!
        test.previews[1]!.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        test.pending.reject(new Error('Revision changed'))
        await Promise.allSettled([test.pending.promise])
        expect(test.resolveReference).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'b' }))
        expect(view.element.querySelector('[role="status"]')?.textContent).toBe('Revision changed')
        expect(test.previews.every(preview => preview.dom.getAttribute('aria-disabled') === 'false')).toBe(true)
    })

    it('removes handlers and ignores rejection after disposal', async () => {
        const test = fixture()
        const view = test.mount()!
        const error = view.element.querySelector('[role="status"]')!
        test.previews[0]!.dom.click()
        view.destroy()
        test.previews[1]!.dom.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
        test.pending.reject(new Error('Late failure'))
        await Promise.allSettled([test.pending.promise])
        expect(error.textContent).toBe('')
        expect(test.resolveReference).toHaveBeenCalledOnce()
        expect(test.previews.every(preview => preview.destroy.mock.calls.length === 1)).toBe(true)
    })

    it('does not mount incomplete bindings or choices missing from the supplied catalog', () => {
        const test = fixture()
        test.options.operation.unresolvedBindingId = undefined
        expect(test.mount()).toBeNull()
        test.options.operation.unresolvedBindingId = 'binding'
        test.options.candidates = []
        expect(test.mount()).toBeNull()
        expect(test.previews).toHaveLength(0)
    })
})
