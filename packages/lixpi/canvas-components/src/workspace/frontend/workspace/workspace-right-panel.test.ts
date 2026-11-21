// @vitest-environment happy-dom
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasAiChatPanelState,
} from '@lixpi/constants'
import {
    type ApplicationPanelConfig,
    type ApplicationPanelInstance,
} from '@lixpi/ui-kit/components/application-panel'
import {
    type SlidingSwitchConfig,
    type SlidingSwitchInstance,
} from '@lixpi/ui-kit/components/sliding-switch'
import {
    WorkspaceRightPanel,
    type WorkspaceRightPanelOptions,
} from './workspace-right-panel.ts'

const mocks = vi.hoisted(() => ({
    panels: [] as {
        config: ApplicationPanelConfig
        instance: ApplicationPanelInstance
    }[],
    switches: [] as {
        config: SlidingSwitchConfig
        instance: SlidingSwitchInstance
    }[],
}))
vi.mock('@lixpi/ui-kit/components/application-panel', () => ({
    createApplicationPanel: (config: ApplicationPanelConfig) => {
        let width = config.loadState?.()?.width ?? config.defaultWidth ?? 0
        let open = config.open
        const pane = document.createElement('div')
        const element = document.createElement('aside')
        const header = document.createElement('div')
        const body = document.createElement('div')
        const footer = document.createElement('div')
        element.append(header, body, footer)
        pane.append(element)
        config.container.append(pane)
        const instance = {
            element,
            header,
            body,
            footer,
            pane,
            toggleElement: null,
            isOpen: () => open,
            setOpen: vi.fn(async (next: boolean) => void (open = next)),
            getWidth: () => width,
            setWidth: vi.fn((next: number) => {
                width = next
                config.onResize?.(next)

                return next
            }),
            applyConstraints: vi.fn(),
            destroy: vi.fn(() => pane.remove()),
        } as unknown as ApplicationPanelInstance
        mocks.panels.push({
            config,
            instance,
        })

        return instance
    },
}))
vi.mock('@lixpi/ui-kit/components/sliding-switch', () => ({
    createSlidingSwitch: (_parent: unknown, config: SlidingSwitchConfig) => {
        const instance = {
            resize: vi.fn(),
            destroy: vi.fn(),
        } as unknown as SlidingSwitchInstance
        mocks.switches.push({
            config,
            instance,
        })

        return instance
    },
}))

const owners: WorkspaceRightPanel[] = []
const fixture = (isOpen = true) => {
    const state = {
        isOpen,
        topLevelMode: 'media',
        contextChips: [],
    } as CanvasAiChatPanelState
    const pane = document.createElement('div')
    document.body.appendChild(pane)
    const frames: FrameRequestCallback[] = []
    const timers: (() => void)[] = []
    const releasePan = vi.fn()
    const mounted: {
        host: HTMLElement
        signal: AbortSignal
        dispose: ReturnType<typeof vi.fn>
    }[] = []
    const options: WorkspaceRightPanelOptions = {
        pane,
        widthHost: pane,
        settings: {
            defaultDimensions: { width: 494 },
            dimensions: {
                minWidth: 320,
                maxPaneMargin: 64,
            },
            layout: { contentInset: 10 },
        },
        switchSettings: {
            height: 36,
            transitionDurationMs: 300,
            transitionMinDurationMs: 100,
            transitionDistanceSpeedupFactor: 1,
        },
        cssProperties: { '--ai-chat-thread-node-border': '1px solid blue' },
        getState: () => state,
        onWidthChange: vi.fn(width => void (state.width = width)),
        onModeChange: vi.fn(mode => void (state.topLevelMode = mode)),
        onOpenChange: vi.fn(open => void (state.isOpen = open)),
        mountContent: vi.fn((host, _mode, signal) => {
            const dispose = vi.fn()
            mounted.push({
                host,
                signal,
                dispose,
            })

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

    return {
        owner,
        options,
        state,
        pane,
        frames,
        timers,
        mounted,
        releasePan,
    }
}
beforeEach(() => {
    mocks.panels.length = 0
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
        const side = mocks.panels[0]
        expect(side.config.side).toBe('right')
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
        expect(side.instance.setOpen).toHaveBeenCalledOnce()
        expect(side.instance.setOpen).toHaveBeenCalledWith(true, { animate: false })
    })

    it('mounts the thread straight into the panel body so its editor is the flex child that scrolls', () => {
        const f = fixture()
        f.state.topLevelMode = 'aiThreads'
        f.owner.render()
        const body = mocks.panels[0].instance.body

        expect(f.mounted[0].host).toBe(body)
        f.state.topLevelMode = 'media'
        f.owner.render({ preserveModeSwitch: true })
        expect(f.mounted[1].host.parentElement).toBe(body)
        expect([...body.children].filter(child => child !== f.mounted[1].host && !child.classList.contains('workspace-right-panel-mode-switch'))).toEqual([])
    })

    it('uses a positive configured width when the switch has no measurable client width', () => {
        const f = fixture()
        f.state.width = 620
        f.owner.render()

        const modeSwitch = mocks.switches[0]
        const element = f.owner.element?.querySelector<HTMLDivElement>('.workspace-right-panel-mode-switch')
        const resizeCalls = vi.mocked(modeSwitch.instance.resize).mock.calls

        expect(element?.clientWidth).toBe(0)
        expect(modeSwitch.config.width).toBeGreaterThan(0)
        expect(resizeCalls.length).toBeGreaterThan(0)
        expect(resizeCalls.every(([, , width]) => width > 0)).toBe(true)
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
        const side = mocks.panels[0]
        expect(side.instance.setOpen).toHaveBeenCalledOnce()
        expect(side.instance.setOpen).toHaveBeenCalledWith(true)
        await Promise.resolve()
        let finish!: () => void
        vi.mocked(side.instance.setOpen).mockImplementation(() =>
            new Promise<void>(resolve => void (finish = resolve))
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
        vi.mocked(mocks.panels[0].instance.setOpen).mockImplementationOnce(() =>
            new Promise<void>(resolve => void (finish = resolve))
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
        const side = mocks.panels[0]
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
        expect(mocks.panels[0].instance.destroy).toHaveBeenCalledOnce()
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
        expect(mocks.panels[1].instance.destroy).not.toHaveBeenCalled()
        expect(second.mounted[0].signal.aborted).toBe(false)
    })
})
