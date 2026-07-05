import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const outlineRendererInstances = vi.hoisted(() => [] as Array<{
    sync: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
}>)

vi.mock('pixi.js', () => ({
    Application: class FakeApplication {
        public canvas = document.createElement('canvas')
        public stage = { addChild: vi.fn() }
        public ticker = { stop: vi.fn() }
        public init = vi.fn(async () => undefined)
        public render = vi.fn()
        public destroy = vi.fn()
    },
    Container: class FakeContainer {
        constructor(public readonly options: unknown) {}
    },
}))

vi.mock('@lixpi/canvas-engine/frontend/rendering', () => ({
    getRoundedOutlinePerimeter: vi.fn(() => 100),
    PixiTravelingOutlineRenderer: class FakePixiTravelingOutlineRenderer {
        public sync = vi.fn()
        public destroy = vi.fn()

        constructor() {
            outlineRendererInstances.push(this)
        }
    },
}))

import { createWorkspaceLoadingOutline } from './workspaceLoadingOutline.ts'
import { settings } from '$src/settings.ts'

class FakeResizeObserver {
    public observe = vi.fn()
    public disconnect = vi.fn()
}

describe('WorkspaceLoadingOutline', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        outlineRendererInstances.length = 0
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('shows the PIXI loading outline while loading and clears it when an error is shown', async () => {
        const paneEl = document.createElement('div')
        document.body.appendChild(paneEl)
        const outline = createWorkspaceLoadingOutline({ paneEl })

        outline.setVisible(true)
        await vi.waitFor(() => expect(outlineRendererInstances).toHaveLength(1))

        const hostEl = paneEl.querySelector<HTMLDivElement>('.workspace-loading-outline')
        expect(hostEl?.classList.contains('is-visible')).toBe(true)
        expect(hostEl?.classList.contains('is-loading')).toBe(true)
        expect(outlineRendererInstances[0].sync.mock.calls.at(-1)?.[0]).toHaveLength(1)
        const datum = outlineRendererInstances[0].sync.mock.calls.at(-1)?.[0][0]
        const generatedMediaCircleSize = settings.mediaBranchLineage.generatedMediaSize
            * Math.min(1, settings.mediaNode.inProgressOutlineAnimation.preFrameCircleScale)
        expect(datum.width).toBeCloseTo(generatedMediaCircleSize * settings.workspaceLoadingOutline.diameterScale)
        expect(datum.height).toBeCloseTo(generatedMediaCircleSize * settings.workspaceLoadingOutline.diameterScale)

        outline.setErrorMessage('The connection timed out while loading this workspace.')

        expect(hostEl?.classList.contains('is-error')).toBe(true)
        expect(hostEl?.classList.contains('is-loading')).toBe(false)
        expect(hostEl?.ariaHidden).toBe('false')
        expect(hostEl?.querySelector('.workspace-loading-error-message')?.textContent).toBe('The connection timed out while loading this workspace.')
        expect(outlineRendererInstances[0].sync.mock.calls.at(-1)?.[0]).toEqual([])

        outline.destroy()
    })

    it('fires the retry callback from the error panel', async () => {
        const paneEl = document.createElement('div')
        const onRetry = vi.fn()
        document.body.appendChild(paneEl)
        const outline = createWorkspaceLoadingOutline({ paneEl, onRetry })

        outline.setErrorMessage('The workspace could not be loaded.')
        paneEl.querySelector<HTMLButtonElement>('.workspace-loading-error-retry')?.click()

        expect(onRetry).toHaveBeenCalledTimes(1)

        outline.destroy()
    })
})
