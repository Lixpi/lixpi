// @vitest-environment happy-dom
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { CanvasAiChatPanelState } from '@lixpi/constants'
import type {
    SidePanelConfig,
    SidePanelInstance,
} from '@lixpi/ui-kit/components/side-panel'
import type {
    SlidingSwitchConfig,
    SlidingSwitchInstance,
} from '@lixpi/ui-kit/components/sliding-switch'
import {
    WorkspaceRightPanel,
    type WorkspaceRightPanelOptions,
} from './workspace-right-panel.ts'

const mocks = vi.hoisted(() => ({ sides: [] as { config: SidePanelConfig; instance: SidePanelInstance }[], switches: [] as { config: SlidingSwitchConfig; instance: SlidingSwitchInstance }[] }))
vi.mock('@lixpi/ui-kit/components/side-panel', () => ({
    createSidePanel: (config: SidePanelConfig) => {
        let width = config.loadState?.()?.width ?? config.defaultWidth
        const instance = {
            element: document.createElement('div'),
            toggleElement: document.createElement('button'),
            backdropElement: document.createElement('div'),
            overlayElement: document.createElement('div'),
            getWidth: () => width,
            getRawWidth: () => width,
            setWidth: vi.fn((next: number) => {
                width = next
                config.onResize?.(next)
            }),
            setOpen: vi.fn(),
            prepareOpen: vi.fn(),
            mountOpen: vi.fn(),
            playOpen: vi.fn(async () => {}),
            playClose: vi.fn(async () => {}),
            detachPanel: vi.fn(),
            applyConstraints: vi.fn(),
            destroy: vi.fn(),
        } as unknown as SidePanelInstance
        mocks.sides.push({ config, instance })
        return instance
    },
}))
vi.mock('@lixpi/ui-kit/components/sliding-switch', () => ({
    createSlidingSwitch: (_parent: unknown, config: SlidingSwitchConfig) => {
        const instance = { resize: vi.fn(), destroy: vi.fn() } as unknown as SlidingSwitchInstance
        mocks.switches.push({ config, instance })
        return instance
    },
}))

const owners: WorkspaceRightPanel[] = []
function fixture(isOpen = true) {
    const state = { isOpen, topLevelMode: 'media', contextChips: [] } as CanvasAiChatPanelState
    const pane = document.createElement('div')
    document.body.appendChild(pane)
    const frames: FrameRequestCallback[] = []
    const timers: (() => void)[] = []
    const releasePan = vi.fn()
    const mounted: { host: HTMLElement; signal: AbortSignal; dispose: ReturnType<typeof vi.fn> }[] = []
    const options: WorkspaceRightPanelOptions = {
        pane,
        widthHost: pane,
        settings: {
            defaultDimensions: { width: 494 },
            dimensions: { minWidth: 320, maxPaneMargin: 64 },
            layout: { contentInset: 10 },
            resizeHandle: { offset: 0, grabWidth: 20 },
            toggle: { openAriaLabel: 'Close', closedAriaLabel: 'Open' },
            animation: { durationMs: 200 },
            overlay: { enabled: false },
            drag: { enabled: false },
        },
        switchSettings: { height: 36, transitionDurationMs: 300, transitionMinDurationMs: 100, transitionDistanceSpeedupFactor: 1 },
        cssProperties: { '--ai-chat-thread-node-border': '1px solid blue' },
        getState: () => state,
        onWidthChange: vi.fn(width => {
            state.width = width
        }),
        onModeChange: vi.fn(mode => {
            state.topLevelMode = mode
        }),
        onOpenChange: vi.fn(open => {
            state.isOpen = open
        }),
        mountContent: vi.fn((host, _mode, signal) => {
            const dispose = vi.fn()
            mounted.push({ host, signal, dispose })
            return dispose
        }),
        acquirePanLock: vi.fn(() => releasePan),
        requestFrame: callback => frames.push(callback),
        cancelFrame: vi.fn(),
        setTimer: callback => timers.push(callback),
        clearTimer: vi.fn(),
        onError: vi.fn(),
    }
    const owner = new WorkspaceRightPanel(options)
    owners.push(owner)
    return { owner, options, state, pane, frames, timers, mounted, releasePan }
}
beforeEach(() => {
    mocks.sides.length = 0
    mocks.switches.length = 0
})
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('WorkspaceRightPanel', () => {
    it('keeps width and generic controls in UI-kit while mounting the selected workspace surface', () => {
        const f = fixture()
        f.state.width = 620
        f.owner.render()
        const side = mocks.sides[0]
        expect(side.config.loadState?.()).toEqual({ width: 620 })
        expect(f.options.mountContent).toHaveBeenCalledWith(expect.any(HTMLElement), 'media', expect.any(AbortSignal))
        expect(f.mounted[0].host.classList.contains('workspace-right-panel-media-host')).toBe(true)
        expect(f.owner.element?.style.getPropertyValue('--ai-chat-thread-node-border')).toBe('1px solid blue')
        expect(f.pane.style.getPropertyValue('--workspace-right-side-panel-width')).toBe('620px')
        expect(mocks.switches[0].config).not.toHaveProperty('indicatorBoxShadow')
        expect(mocks.switches[0].config).not.toHaveProperty('indicatorInsetShadow')
        side.config.persistState?.({ width: 700 })
        expect(f.options.onWidthChange).toHaveBeenCalledWith(700)
        f.owner.syncState()
        expect(side.instance.setWidth).toHaveBeenCalledWith(700, { persist: false })
        expect(side.instance.mountOpen).toHaveBeenCalledOnce()
        expect(side.instance.playOpen).not.toHaveBeenCalled()
    })

    it('keeps the live mode switch during its slide and replaces only content', () => {
        const f = fixture()
        f.owner.render()
        const switchElement = f.owner.element?.querySelector('.workspace-right-panel-mode-switch')
        const first = f.mounted[0]
        const modeSwitch = mocks.switches[0]
        vi.mocked(modeSwitch.instance.resize).mockClear()
        modeSwitch.config.onChange?.('capabilities', modeSwitch.config.id)
        expect(f.state.topLevelMode).toBe('capabilities')
        expect(first.signal.aborted).toBe(true)
        expect(first.dispose).toHaveBeenCalledOnce()
        expect(f.owner.element?.querySelector('.workspace-right-panel-mode-switch')).toBe(switchElement)
        expect(mocks.switches).toHaveLength(1)
        expect(modeSwitch.instance.destroy).not.toHaveBeenCalled()
        expect(modeSwitch.instance.resize).not.toHaveBeenCalled()
        expect(f.mounted[1].host.classList.contains('workspace-right-panel-capability-host')).toBe(true)
    })

    it('animates opening after the initial closed state, and retains content until closing settles', async () => {
        const f = fixture(false)
        f.owner.render()
        f.state.isOpen = true
        f.owner.render()
        const side = mocks.sides[0]
        expect(side.instance.prepareOpen).toHaveBeenCalledOnce()
        expect(side.instance.playOpen).toHaveBeenCalledOnce()
        await Promise.resolve()
        let finish!: () => void
        vi.mocked(side.instance.playClose).mockImplementation(() =>
            new Promise<void>(resolve => {
                finish = resolve
            })
        )
        f.state.isOpen = false
        const closing = f.owner.close()
        f.owner.render()
        expect(f.owner.isClosing).toBe(true)
        expect(f.mounted[0].signal.aborted).toBe(false)
        finish()
        await closing
        expect(f.owner.element).toBeNull()
        expect(f.mounted[0].signal.aborted).toBe(true)
        expect(f.owner.isClosing).toBe(false)
    })

    it('ignores an obsolete close completion after the panel reopens', async () => {
        const f = fixture()
        f.owner.render()
        let finish!: () => void
        vi.mocked(mocks.sides[0].instance.playClose).mockImplementation(() =>
            new Promise<void>(resolve => {
                finish = resolve
            })
        )
        f.state.isOpen = false
        const closing = f.owner.close()
        f.state.isOpen = true
        f.owner.render({ animateOpen: false })
        const replacement = f.owner.element
        finish()
        await closing
        expect(f.owner.element).toBe(replacement)
        expect(f.mounted.at(-1)?.signal.aborted).toBe(false)
    })

    it('releases resize locks, timers, frames and stale content callbacks on disposal', () => {
        const f = fixture()
        f.owner.render()
        const side = mocks.sides[0]
        const modeSwitch = mocks.switches[0]
        modeSwitch.config.onChange?.('artifacts', modeSwitch.config.id)
        side.config.onResizeStart?.()
        side.config.onResizeStart?.()
        expect(f.options.acquirePanLock).toHaveBeenCalledOnce()
        f.owner.destroy()
        expect(f.releasePan).toHaveBeenCalledOnce()
        expect(f.options.clearTimer).toHaveBeenCalledWith(1)
        expect(f.options.cancelFrame).toHaveBeenCalledWith(2)
        expect(side.instance.destroy).toHaveBeenCalledOnce()
        expect(modeSwitch.instance.destroy).toHaveBeenCalledOnce()
        const resizeCount = vi.mocked(modeSwitch.instance.resize).mock.calls.length
        for (const frame of f.frames) frame(0)
        modeSwitch.config.onChange?.('aiThreads', modeSwitch.config.id)
        side.config.persistState?.({ width: 800 })
        side.config.onOpenChange?.(true)
        side.config.toggle?.onToggle()
        side.config.onResize?.(800)
        side.config.onResizeStart?.()
        expect(modeSwitch.instance.resize).toHaveBeenCalledTimes(resizeCount)
        expect(f.options.onModeChange).toHaveBeenCalledOnce()
        expect(f.options.onWidthChange).not.toHaveBeenCalled()
        expect(f.options.onOpenChange).not.toHaveBeenCalled()
        expect(f.options.acquirePanLock).toHaveBeenCalledOnce()
        expect(f.pane.style.getPropertyValue('--workspace-right-side-panel-width')).toBe('')
    })

    it('releases a failed partial mount and supports retry without stale listeners', () => {
        const f = fixture()
        const mount = f.options.mountContent
        f.options.mountContent = () => {
            throw new Error('content failed')
        }
        expect(() => f.owner.render()).toThrow('content failed')
        expect(f.owner.element).toBeNull()
        expect(mocks.switches[0].instance.destroy).toHaveBeenCalledOnce()
        f.options.mountContent = mount
        f.owner.render()
        expect(f.owner.element?.isConnected).toBe(true)
    })

    it('continues disposal when a content disposer fails', () => {
        const f = fixture()
        f.owner.render()
        f.mounted[0].dispose.mockImplementationOnce(() => {
            throw new Error('release failed')
        })
        expect(() => f.owner.destroy()).toThrow()
        expect(mocks.sides[0].instance.destroy).toHaveBeenCalledOnce()
        expect(mocks.switches[0].instance.destroy).toHaveBeenCalledOnce()
        expect(f.owner.element).toBeNull()
        expect(f.mounted[0].host.isConnected).toBe(false)
        expect(f.pane.style.getPropertyValue('--workspace-right-side-panel-width')).toBe('')
    })

    it('keeps independent controls and accessible switch identities for two canvases', () => {
        const first = fixture()
        const second = fixture()
        first.owner.render()
        second.owner.render()
        expect(mocks.switches[0].config.id).not.toBe(mocks.switches[1].config.id)
        first.owner.destroy()
        expect(second.owner.element?.isConnected).toBe(true)
        expect(mocks.sides[1].instance.destroy).not.toHaveBeenCalled()
        expect(second.mounted[0].signal.aborted).toBe(false)
    })
})
