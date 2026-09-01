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
import { WorkspaceNodeShells } from './workspace-node-shells.ts'
import {
    OperationStatusNode,
    type OperationStatusNodeActions,
} from './operation-status-node.ts'

const owners: WorkspaceNodeShells[] = []
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
})

function mount(overrides: Partial<OperationStatusCanvasNode> = {}) {
    const node: OperationStatusCanvasNode = {
        nodeId: 'operation',
        type: 'operationStatus',
        operation: 'media-generation',
        status: 'failed',
        title: 'Generating media',
        generationRequestId: 'request',
        requestRevision: 4,
        position: { x: 10, y: 20 },
        dimensions: { width: 360, height: 104 },
        createdAt: 1,
        updatedAt: 2,
        ...overrides,
    }
    const shells = new WorkspaceNodeShells({
        document,
        getBounds: node => ({ ...node.position, ...node.dimensions }),
        getLayer: () => 1,
        getZoom: () => 1,
        getResizeSettings: () => ({ useZoomCompensatedScaling: false, size: 10, offset: 0, minSize: 5, zoomScaling: { minZoom: 0.4 } }),
        consumeSuppressedClick: () => false,
        select: vi.fn(),
        toggleSelection: vi.fn(),
        startDrag: vi.fn(),
        startResize: vi.fn(),
        onCreate: vi.fn(),
        togglePlayback: vi.fn(),
    })
    owners.push(shells)
    const actions = {
        verify: vi.fn<OperationStatusNodeActions['verify']>(async () => {}),
        cancel: vi.fn<OperationStatusNodeActions['cancel']>(async () => {}),
        edit: vi.fn<OperationStatusNodeActions['edit']>(async () => {}),
        dismissUpload: vi.fn<OperationStatusNodeActions['dismissUpload']>(),
    }
    const view = new OperationStatusNode(node, shells, actions)
    document.body.append(view.element)
    const button = (label: string) => Array.from(view.element.querySelectorAll('button')).find(button => button.textContent === label)!
    return { node, shells, actions, view, button }
}

describe('OperationStatusNode', () => {
    it('renders loading and failure cards without resize handles', () => {
        const loading = mount({ operation: 'upload', status: 'in-progress' })
        expect(loading.view.element.textContent).toContain('Converting upload')
        expect(loading.view.element.querySelector('.ai-response-loading-spinner')).not.toBeNull()
        expect(loading.view.element.querySelector('[data-corner]')).toBeNull()
        const failed = mount({ operation: 'upload' })
        const dismiss = failed.view.element.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!
        expect(dismiss.querySelector('svg')).not.toBeNull()
        dismiss.click()
        expect(failed.actions.dismissUpload).toHaveBeenCalledWith(failed.node)
    })

    it('renders provider details as text and delegates edit and dismissal', () => {
        const fixture = mount({ problem: { detail: 'Failed', providerReason: '<img src=x onerror=alert(1)>', providerCode: 'invalid', supportCode: 'support', moderationStage: 'input', moderationCategories: ['person'] } as OperationStatusCanvasNode['problem'] })
        expect(fixture.view.element.querySelector('img')).toBeNull()
        expect(fixture.view.element.querySelector('.workspace-media-operation-provider-reason')?.textContent).toBe('<img src=x onerror=alert(1)>')
        fixture.button('Edit request').click()
        fixture.button('Dismiss').click()
        expect(fixture.actions.edit).toHaveBeenCalledWith(fixture.node, expect.any(AbortSignal))
        expect(fixture.actions.cancel).toHaveBeenCalledWith(fixture.node, expect.any(AbortSignal))
    })

    it('shows verification only when the request includes a run and verification Asset', () => {
        const fixture = mount({ status: 'action-required', generationRun: 0, verificationAssetId: 'asset' })
        fixture.button('Verify with provider').click()
        expect(fixture.actions.verify).toHaveBeenCalledWith(fixture.node, expect.any(AbortSignal))
        fixture.button('Cancel').click()
        expect(fixture.actions.cancel).toHaveBeenCalledOnce()
        const reference = mount({ status: 'action-required', unresolvedBindingId: 'binding', candidateAssetIds: ['asset'] })
        expect(reference.view.element.querySelector('button')).toBeNull()
    })

    it('serializes a button action and displays its failure without selecting the node', async () => {
        const fixture = mount()
        const pending = Promise.withResolvers<void>()
        fixture.actions.edit.mockImplementation(() => pending.promise)
        const bubble = vi.fn()
        fixture.view.element.addEventListener('click', bubble)
        const button = fixture.button('Edit request')
        button.click()
        button.click()
        expect(fixture.actions.edit).toHaveBeenCalledOnce()
        expect(button.disabled).toBe(true)
        expect(bubble).not.toHaveBeenCalled()
        pending.reject(new Error('Request unavailable'))
        await Promise.allSettled([pending.promise])
        expect(button.disabled).toBe(false)
        expect(fixture.view.element.querySelector('.workspace-upload-placeholder-message')?.textContent).toBe('Request unavailable')
    })

    it('aborts pending UI work and detaches listeners when its shell is removed', async () => {
        const fixture = mount()
        const pending = Promise.withResolvers<void>()
        fixture.actions.edit.mockImplementation(() => pending.promise)
        const button = fixture.button('Edit request')
        const dismiss = fixture.button('Dismiss')
        button.click()
        const signal = fixture.actions.edit.mock.calls[0]![1] as AbortSignal
        const message = fixture.view.element.querySelector('.workspace-upload-placeholder-message')!
        const previous = message.textContent
        fixture.shells.remove(fixture.node.nodeId)
        fixture.view.destroy()
        expect(signal.aborted).toBe(true)
        pending.reject(new Error('Late failure'))
        await Promise.allSettled([pending.promise])
        expect(message.textContent).toBe(previous)
        dismiss.click()
        expect(fixture.actions.cancel).not.toHaveBeenCalled()
        expect(fixture.view.element.isConnected).toBe(false)
    })
})
