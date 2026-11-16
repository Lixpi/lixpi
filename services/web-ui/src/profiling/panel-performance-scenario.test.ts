import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { PanelPerformanceScenario } from './panel-performance-scenario.ts'

describe('panel profiling scenario', () => {
    let scenario: PanelPerformanceScenario
    let navigation: HTMLDivElement
    let right: HTMLDivElement
    let clicks: string[]
    let marks: ReturnType<typeof vi.spyOn>

    const addPanel = (name: string, open: boolean): HTMLDivElement => {
        const panel = document.createElement('div')
        panel.className = name === 'navigation' ? 'navigation-side-panel-toggle' : 'workspace-ai-chat-panel-toggle'
        panel.classList.toggle('side-panel-toggle-open', open)
        const button = document.createElement('button')
        button.className = 'side-panel-toggle-button'
        button.addEventListener('click', () => {
            clicks.push(name)
            panel.classList.toggle('side-panel-toggle-open')
        })
        panel.append(button)
        document.body.append(panel)

        return panel
    }

    const shortcut = (repeat = false): void => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
            code: 'KeyP',
            ctrlKey: true,
            altKey: true,
            shiftKey: true,
            repeat,
            cancelable: true,
        }))
    }

    beforeEach(() => {
        vi.useFakeTimers()
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
        marks = vi.spyOn(performance, 'mark')
        clicks = []
        navigation = addPanel('navigation', true)
        right = addPanel('right', false)
        scenario = new PanelPerformanceScenario()
    })

    afterEach(() => {
        scenario.destroy()
        navigation.remove()
        right.remove()
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    it('waits for the observer to leave, runs six real clicks and verifies both original states', () => {
        shortcut()
        shortcut(true)
        vi.advanceTimersByTime(3999)
        expect(clicks).toEqual([])
        vi.advanceTimersByTime(1)
        expect(clicks).toEqual(['navigation'])
        vi.advanceTimersByTime(12000)
        expect(clicks).toEqual(['navigation', 'navigation', 'navigation', 'navigation', 'right', 'right'])
        expect(navigation.classList.contains('side-panel-toggle-open')).toBe(true)
        expect(right.classList.contains('side-panel-toggle-open')).toBe(false)
        expect(marks).toHaveBeenCalledWith('profile:panels:1:navigation:verified:closed')
        expect(marks).toHaveBeenCalledWith('profile:panels:6:right:verified:closed')
        expect(marks).toHaveBeenCalledWith('profile:panels:complete')
        expect(vi.getTimerCount()).toBe(0)
    })

    it('starts and cancels from the button and removes it on disposal', () => {
        const button = document.querySelector<HTMLButtonElement>('.panel-performance-trigger')!
        expect(button.textContent?.trim()).toBe('Profile panels')
        button.click()
        expect(button.textContent).toBe('Cancel panel profile')
        expect(marks).toHaveBeenCalledWith('profile:panels:start')

        vi.advanceTimersByTime(3999)
        expect(clicks).toEqual([])
        vi.advanceTimersByTime(1)
        expect(clicks).toEqual(['navigation'])

        button.click()
        expect(button.textContent).toBe('Profile panels')
        expect(clicks).toEqual(['navigation', 'navigation'])
        expect(marks).toHaveBeenCalledWith('profile:panels:cancel:button')
        expect(vi.getTimerCount()).toBe(0)

        scenario.destroy()
        expect(button.isConnected).toBe(false)
        button.click()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('restores an interrupted panel through its click handler and removes the shortcut on disposal', () => {
        shortcut()
        vi.advanceTimersByTime(4000)
        scenario.destroy()
        expect(clicks).toEqual(['navigation', 'navigation'])
        expect(navigation.classList.contains('side-panel-toggle-open')).toBe(true)
        expect(marks).toHaveBeenCalledWith('profile:panels:cancel:dispose')
        shortcut()
        vi.advanceTimersByTime(20000)
        expect(clicks).toHaveLength(2)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('cancels on a second shortcut or when hidden and restores the starting state', () => {
        shortcut()
        vi.advanceTimersByTime(4000)
        shortcut()
        expect(clicks).toEqual(['navigation', 'navigation'])
        expect(vi.getTimerCount()).toBe(0)
        shortcut()
        vi.advanceTimersByTime(4000)
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
        document.dispatchEvent(new Event('visibilitychange'))
        expect(clicks).toHaveLength(4)
        expect(navigation.classList.contains('side-panel-toggle-open')).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('rejects missing targets and stops when a click does not change the component state', () => {
        right.remove()
        shortcut()
        expect(marks).toHaveBeenCalledWith('profile:panels:unavailable')
        expect(vi.getTimerCount()).toBe(0)
        document.body.append(right)
        const button = navigation.querySelector('button')!
        button.replaceWith(button.cloneNode(true))
        shortcut()
        vi.advanceTimersByTime(6000)
        expect(marks).toHaveBeenCalledWith('profile:panels:cancel:state-mismatch')
        expect(marks).not.toHaveBeenCalledWith('profile:panels:complete')
        expect(clicks).toEqual([])
        expect(vi.getTimerCount()).toBe(0)
    })
})
