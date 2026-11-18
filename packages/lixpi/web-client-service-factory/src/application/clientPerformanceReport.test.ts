import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    CLIENT_PERFORMANCE_EVENT,
    reportClientPerformance,
} from './clientPerformanceReport.ts'

type ObserverCallback = (list: Pick<PerformanceObserverEntryList, 'getEntries'>) => void

class ReportingClock {
    now = 0
    private nextId = 0
    readonly timers = new Map<number, {
        at: number
        callback: () => void
    }>()

    schedule(
        callback: () => void,
        delay: number,
    ): number {
        const id = ++this.nextId
        this.timers.set(id, {
            at: this.now + delay,
            callback,
        })

        return id
    }

    advanceTo(time: number): void {
        for (;;) {
            const next = [...this.timers]
                .filter(([, timer]) => timer.at <= time)
                .sort((left, right) => left[1].at - right[1].at)[0]

            if (!next)
                break

            this.now = Math.max(this.now, next[1].at)
            this.timers.delete(next[0])
            next[1].callback()
        }

        this.now = time
    }
}

// =============================================================================
// CLIENT PERFORMANCE REPORTING
// =============================================================================

describe('client performance reporting', () => {
    let visibility: DocumentVisibilityState
    let frame: FrameRequestCallback | undefined
    let clock: ReportingClock
    let dispose: (() => void) | undefined

    const startReporting = () => {
        const send = vi.fn()
        reportClientPerformance({
            send,
            dispose: callback => void (dispose = callback),
        })

        return send
    }

    const setVisibility = (value: DocumentVisibilityState): void => {
        visibility = value
        document.dispatchEvent(new Event('visibilitychange'))
    }

    const runFrame = (
        timestamp: number,
        callbackAt = timestamp,
    ): void => {
        clock.advanceTo(callbackAt)
        frame?.(timestamp)
    }

    beforeEach(() => {
        clock = new ReportingClock()
        frame = undefined
        visibility = 'visible'
        vi.stubGlobal('PerformanceObserver', undefined)
        vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
        vi.spyOn(
            document,
            'visibilityState',
            'get',
        ).mockImplementation(() => visibility)
        vi.spyOn(
            window,
            'requestAnimationFrame',
        ).mockImplementation(callback => {
            frame = callback

            return 1
        })
        vi.spyOn(
            window,
            'cancelAnimationFrame',
        ).mockImplementation(() => void (frame = undefined))
        vi.spyOn(
            window,
            'setTimeout',
        ).mockImplementation((handler, delay) => clock.schedule(
            () => {
                if (typeof handler === 'function')
                    handler()
            },
            delay ?? 0,
        ))
        vi.spyOn(
            window,
            'clearTimeout',
        ).mockImplementation(id => {
            if (id !== undefined)
                clock.timers.delete(id)
        })
    })

    afterEach(() => {
        dispose?.()
        dispose = undefined
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('reports frame gaps without a performance observer and resets them when the page is hidden', () => {
        vi.stubGlobal(
            'PerformanceObserver',
            undefined,
        )
        const send = startReporting()
        runFrame(0)
        runFrame(17)
        runFrame(87)
        clock.advanceTo(2000)

        expect(send).toHaveBeenLastCalledWith(
            CLIENT_PERFORMANCE_EVENT,
            expect.objectContaining({
                responsiveness: expect.objectContaining({
                    frameGapCount: 2,
                    averageFrameGap: 44,
                    maxFrameGap: 70,
                    frameGapsAtLeast50ms: 1,
                }),
            }),
        )

        setVisibility('hidden')
        expect(frame).toBeUndefined()
        expect(clock.timers.size).toBe(0)

        setVisibility('visible')
        runFrame(3000)
        runFrame(3017)
        clock.advanceTo(4000)

        expect(send).toHaveBeenLastCalledWith(
            CLIENT_PERFORMANCE_EVENT,
            expect.objectContaining({
                responsiveness: expect.objectContaining({
                    frameGapCount: 1,
                    maxFrameGap: 17,
                }),
            }),
        )

        dispose?.()
        dispose = undefined
        expect(frame).toBeUndefined()
        expect(clock.timers.size).toBe(0)
    })

    it('distinguishes a 200 ms RAF gap from blocked timer callbacks', () => {
        const send = startReporting()
        runFrame(0)
        runFrame(200)
        clock.advanceTo(2000)

        expect(send.mock.calls.at(-1)?.[1].responsiveness).toMatchObject({
            maxFrameGap: 200,
            maxFrameCallbackGap: 200,
            frameIntervals: [{
                frameStart: 0,
                frameEnd: 200,
                callbackStart: 0,
                callbackEnd: 200,
                heartbeatCount: 4,
            }],
            heartbeat: {
                maxLateness: 0,
                delaysAtLeast50ms: 0,
                intervals: [],
            },
        })

        dispose?.()
        dispose = undefined
        clock = new ReportingClock()
        const blocked = startReporting()
        runFrame(0)
        // Advance the clock without dispatching either queued timer or RAF.
        clock.now = 200
        frame?.(200)
        clock.advanceTo(200)
        clock.advanceTo(2000)

        expect(blocked.mock.calls.at(-1)?.[1].responsiveness).toMatchObject({
            maxFrameGap: 200,
            maxFrameCallbackGap: 200,
            frameIntervals: [{
                frameStart: 0,
                frameEnd: 200,
                callbackStart: 0,
                callbackEnd: 200,
                heartbeatCount: 0,
            }],
            heartbeat: {
                maxLateness: 150,
                delaysAtLeast50ms: 1,
                intervals: [{
                    scheduledAt: 50,
                    callbackAt: 200,
                    lateness: 150,
                }],
            },
        })
    })

    it('retains raw RAF and callback times and bounds detailed intervals', () => {
        const send = startReporting()
        runFrame(0)

        for (let index = 1; index <= 45; index++) {
            clock.now = index * 60
            frame?.(index * 60 - 0.25)
        }

        clock.advanceTo(2700)
        const responsiveness = send.mock.calls.at(-1)?.[1].responsiveness
        expect(responsiveness.frameIntervals).toHaveLength(40)
        expect(responsiveness.droppedFrameIntervals).toBe(5)
        expect(responsiveness.frameIntervals[0]).toEqual({
            frameStart: 0,
            frameEnd: 59.75,
            callbackStart: 0,
            callbackEnd: 60,
            heartbeatCount: 0,
        })
        expect(responsiveness.heartbeat.intervals).toEqual([{
            scheduledAt: 50,
            callbackAt: 2700,
            lateness: 2650,
        }])
    })

    it('clears heartbeat and frame history on visibility changes and disposal', () => {
        vi.spyOn(
            document,
            'readyState',
            'get',
        ).mockReturnValue('complete')
        const send = startReporting()
        runFrame(0)
        clock.now = 200
        frame?.(200)
        clock.advanceTo(200)
        setVisibility('hidden')
        expect(frame).toBeUndefined()
        // A hidden page still flushes its queued startup resource summary once.
        expect(clock.timers.size).toBe(1)
        expect([...clock.timers.values()][0].at).toBe(2200)
        clock.advanceTo(2200)
        expect(send).toHaveBeenCalledTimes(1)
        expect(send.mock.calls[0][1]).toMatchObject({
            source: { visibility: 'hidden' },
            responsiveness: null,
            entries: expect.arrayContaining([
                expect.objectContaining({ type: 'resource-summary' }),
            ]),
        })
        expect(clock.timers.size).toBe(0)
        expect(frame).toBeUndefined()
        clock.now = 3000
        setVisibility('visible')
        runFrame(3000)
        runFrame(3017)
        clock.advanceTo(5000)

        expect(send.mock.calls.at(-1)?.[1].responsiveness).toMatchObject({
            maxFrameGap: 17,
            maxFrameCallbackGap: 17,
            frameIntervals: [],
            droppedFrameIntervals: 0,
            heartbeat: {
                maxLateness: 0,
                delaysAtLeast50ms: 0,
                intervals: [],
                droppedIntervals: 0,
            },
        })
        dispose?.()
        dispose = undefined
        expect(clock.timers.size).toBe(0)
        expect(frame).toBeUndefined()
        const sent = send.mock.calls.length
        clock.advanceTo(10000)
        expect(send).toHaveBeenCalledTimes(sent)
    })

    it('toggles session-only glass profiling and restores normal mode on HMR disposal', () => {
        const mark = vi.spyOn(performance, 'mark')
        const modes: boolean[] = []
        const onToggle = () => modes.push(document.documentElement.hasAttribute('data-lixpi-profile-glass-bypass'))
        window.addEventListener('lixpi:profile-glass-toggle', onToggle)
        const shortcut = (repeat = false) => window.dispatchEvent(new KeyboardEvent('keydown', {
            code: 'KeyG',
            ctrlKey: true,
            altKey: true,
            shiftKey: true,
            repeat,
            cancelable: true,
        }))

        try {
            const send = startReporting()
            clock.now = 125.5
            shortcut()
            shortcut(true)
            expect(modes).toEqual([true])
            expect(mark).toHaveBeenCalledWith('canvas:glass-bypass')
            clock.advanceTo(2000)
            expect(send.mock.calls.at(-1)?.[1]).toMatchObject({
                source: { glassMode: 'bypassed' },
                entries: expect.arrayContaining([{
                    type: 'profile-mode',
                    name: 'canvas:glass-bypass',
                    start: 125.5,
                    duration: 0,
                    glassMode: 'bypassed',
                }]),
            })

            clock.now = 2125
            shortcut()
            expect(modes).toEqual([true, false])
            expect(mark).toHaveBeenCalledWith('canvas:glass-restore')
            shortcut()
            dispose?.()
            dispose = undefined
            expect(modes).toEqual([true, false, true, false])
            expect(document.documentElement.hasAttribute('data-lixpi-profile-glass-bypass')).toBe(false)
            shortcut()
            expect(modes).toHaveLength(4)
            const restarted = startReporting()
            clock.advanceTo(4125)
            expect(restarted.mock.calls.at(-1)?.[1].source.glassMode).toBe('normal')
        } finally {
            window.removeEventListener('lixpi:profile-glass-toggle', onToggle)
        }
    })

    it('logs the three native event timing phases and limits the target to its CSS identity', () => {
        let deliver: ObserverCallback | undefined
        const disconnect = vi.fn()

        class EventObserver {
            static readonly supportedEntryTypes = ['event']
            readonly disconnect = disconnect

            constructor(callback: ObserverCallback) {
                deliver = callback
            }

            observe(): void {}
        }

        vi.stubGlobal(
            'PerformanceObserver',
            EventObserver,
        )
        const send = startReporting()

        const target = document.createElement('button')
        target.id = 'private-id'
        target.textContent = 'private text'
        target.className = 'button 123private primary fourth'
        target.setAttribute(
            'role',
            'tab',
        )

        const entry: PerformanceEventTiming = {
            entryType: 'event',
            name: 'click',
            startTime: 100,
            duration: 72,
            processingStart: 115.125,
            processingEnd: 135.25,
            cancelable: true,
            interactionId: 1,
            target,
            toJSON: () => ({}),
        }
        deliver?.({ getEntries: () => [entry] })
        clock.advanceTo(2000)

        expect(send).toHaveBeenLastCalledWith(
            CLIENT_PERFORMANCE_EVENT,
            expect.objectContaining({
                source: expect.objectContaining({
                    width: window.innerWidth,
                    height: window.innerHeight,
                    devicePixelRatio: window.devicePixelRatio,
                }),
                entries: expect.arrayContaining([{
                    type: 'event',
                    name: 'click',
                    start: 100,
                    duration: 72,
                    eventTiming: {
                        inputDelay: 15,
                        processingDuration: 20,
                        processingStart: 115.125,
                        processingEnd: 135.25,
                        timeAfterProcessing: 37,
                        target: {
                            tag: 'button',
                            role: 'tab',
                            classes: [
                                'button',
                                'primary',
                            ],
                        },
                    },
                }]),
            }),
        )

        dispose?.()
        dispose = undefined
        expect(disconnect).toHaveBeenCalledOnce()
    })
})
