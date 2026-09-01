// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    BranchMarkerPromptParts,
    type BranchPromptReferenceRenderer,
} from './branch-marker-prompt.ts'
import type { BranchMarkerPromptPart } from '../../shared/branch-tree-layout/marker-prompt-parts.ts'

const reference: BranchMarkerPromptPart = { type: 'media', reference: { referenceType: 'media', assetId: 'asset', mediaKind: 'image', displayName: 'Image' } }

describe('BranchMarkerPromptParts', () => {
    it('preserves inline order and releases every mounted preview once', () => {
        const views: Array<{ dom: HTMLElement; destroy: ReturnType<typeof vi.fn> }> = []
        const render: BranchPromptReferenceRenderer = reference => {
            const dom = document.createElement('span')
            dom.textContent = reference.displayName
            const view = { dom, destroy: vi.fn() }
            views.push(view)
            return view
        }
        const prompt = new BranchMarkerPromptParts([{ type: 'text', text: 'Use ' }, reference, { type: 'text', text: ' again ' }, reference], render)
        expect(prompt.items).toEqual(['Use ', views[0]!.dom, ' again ', views[1]!.dom])
        document.body.append(views[0]!.dom, views[1]!.dom)
        prompt.destroy()
        prompt.destroy()
        for (const view of views) {
            expect(view.destroy).toHaveBeenCalledOnce()
            expect(view.dom.isConnected).toBe(false)
        }
    })

    it('cleans earlier previews when a later preview fails to mount', () => {
        const first = { dom: document.createElement('span'), destroy: vi.fn() }
        const render = vi.fn<BranchPromptReferenceRenderer>()
            .mockReturnValueOnce(first)
            .mockImplementationOnce(() => {
                throw new Error('Preview failed')
            })
        expect(() => new BranchMarkerPromptParts([reference, reference], render)).toThrow('Preview failed')
        expect(first.destroy).toHaveBeenCalledOnce()
    })

    it('keeps previews separate across instances displaying the same reference', () => {
        const first = { dom: document.createElement('span'), destroy: vi.fn() }
        const second = { dom: document.createElement('span'), destroy: vi.fn() }
        const a = new BranchMarkerPromptParts([reference], () => first)
        const b = new BranchMarkerPromptParts([reference], () => second)
        a.destroy()
        expect(first.destroy).toHaveBeenCalledOnce()
        expect(second.destroy).not.toHaveBeenCalled()
        b.destroy()
    })
})
