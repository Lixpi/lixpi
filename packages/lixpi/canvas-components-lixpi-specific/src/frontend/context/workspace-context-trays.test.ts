// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { CanvasNode } from '@lixpi/constants'
import {
    WorkspaceContextTrays,
    type WorkspaceContextTrayPorts,
} from './workspace-context-trays.ts'

const owners: WorkspaceContextTrays[] = []
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
})

function fixture() {
    let nextFrame = 0
    const frames = new Map<number, () => void>()
    const nodes = new Map<string, CanvasNode>([['a', { nodeId: 'a', type: 'image', assetId: 'asset', position: { x: 0, y: 0 }, dimensions: { width: 100, height: 100 } }]])
    let ids = ['a', 'missing']
    const signals: AbortSignal[] = []
    const ports: WorkspaceContextTrayPorts = {
        document,
        getNode: id => nodes.get(id),
        getContextNodeIds: () => ids,
        getEnvironment: () => ({
            document,
            getDocuments: () => [],
            getThreads: () => [],
            getAsset: () => undefined,
            tooltipHideDelayMs: 0,
            getArtifactIcon: () => '',
            extractDocumentText: () => '',
            initialRenditionUrl: () => '/initial',
            resolveRenditionUrl: async (_id, _rendition, signal) => {
                signals.push(signal)
                return '/image'
            },
            onError: vi.fn(),
        }),
        onRemove: vi.fn(),
        requestFrame: callback => {
            frames.set(++nextFrame, callback)
            return nextFrame
        },
        cancelFrame: id => {
            frames.delete(id)
        },
    }
    const owner = new WorkspaceContextTrays(ports)
    owners.push(owner)
    const mount = () => {
        const element = owner.create('canvas')
        document.body.appendChild(element)
        owner.refresh()
        return element
    }
    return {
        owner,
        ports,
        nodes,
        frames,
        signals,
        mount,
        setIds: (next: string[]) => {
            ids = next
        },
    }
}

describe('Workspace context trays', () => {
    it('renders explicit chips in supplied order, omits missing nodes and emits removal without changing state', () => {
        const f = fixture()
        const element = f.mount()
        expect(element.querySelectorAll('[role="listitem"]')).toHaveLength(1)
        expect(element.querySelector<HTMLElement>('[role="listitem"]')?.dataset).toMatchObject({ nodeId: 'a', contextKind: 'explicit', contextRole: 'forced-chip' })
        const remove = element.querySelector<HTMLButtonElement>('.workspace-ai-chat-panel-context-chip-remove')!
        expect(remove.getAttribute('aria-label')).toBe('Remove Image from context')
        remove.click()
        expect(f.ports.onRemove).toHaveBeenCalledWith('a')
        expect(element.querySelectorAll('[role="listitem"]')).toHaveLength(1)
        f.setIds([])
        f.owner.refresh()
        expect(element.hidden).toBe(true)
    })

    it('replaces only tray content and disposes previews and obsolete listeners', () => {
        const f = fixture()
        const element = f.mount()
        const input = document.createElement('input')
        document.body.appendChild(input)
        input.value = 'Draft remains'
        const oldRemove = element.querySelector<HTMLButtonElement>('button')!
        const oldSignals = [...f.signals]
        f.owner.refresh()
        oldRemove.click()
        expect(f.ports.onRemove).not.toHaveBeenCalled()
        expect(oldSignals.every(signal => signal.aborted)).toBe(true)
        expect(input.isConnected).toBe(true)
        expect(input.value).toBe('Draft remains')
    })

    it('releases disconnected trays and cancels scheduled refresh on destruction', () => {
        const f = fixture()
        const element = f.mount()
        element.remove()
        f.owner.refresh()
        expect(f.signals.every(signal => signal.aborted)).toBe(true)
        expect(f.frames.size).toBe(0)
        const unmounted = f.owner.create('chat')
        const callback = [...f.frames.values()][0]!
        f.owner.destroy()
        document.body.appendChild(unmounted)
        callback()
        expect(unmounted.childElementCount).toBe(0)
        expect(f.frames.size).toBe(0)
    })

    it('disposes one canvas without affecting another canvas or its tray callbacks', () => {
        const first = fixture()
        const second = fixture()
        first.mount()
        const remaining = second.mount()
        first.owner.destroy()
        remaining.querySelector<HTMLButtonElement>('button')!.click()
        expect(second.ports.onRemove).toHaveBeenCalledWith('a')
        expect(second.signals.some(signal => !signal.aborted)).toBe(true)
    })
})
