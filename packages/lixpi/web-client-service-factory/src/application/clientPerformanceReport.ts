import { CLIENT_PERFORMANCE_EVENT } from './clientPerformanceContract.ts'

export { CLIENT_PERFORMANCE_EVENT } from './clientPerformanceContract.ts'

const REPORT_INTERVAL_MS = 2000
const HEARTBEAT_INTERVAL_MS = 50
const SLOW_FRAME_GAP_MS = 50
const MAX_RESPONSIVENESS_INTERVALS = 40
const MAX_ENTRIES_PER_BATCH = 200
const GLASS_BYPASS_ATTRIBUTE = 'data-lixpi-profile-glass-bypass'
const GLASS_TOGGLE_EVENT = 'lixpi:profile-glass-toggle'

type HotChannel = {
    send: (
        event: string,
        data: unknown,
    ) => void
    dispose: (callback: () => void) => void
}

type ReportedEntry = {
    type: string
    name: string
    start: number
    duration: number
    scripts?: string[]
    glassMode?: 'normal' | 'bypassed'
    eventTiming?: {
        inputDelay: number
        processingDuration: number
        processingStart: number
        processingEnd: number
        timeAfterProcessing: number
        target: {
            tag: string
            role: string | null
            classes: string[]
        } | null
    }
}

type AnimationFrameScript = {
    duration: number
    invoker?: string
    sourceURL?: string
    sourceFunctionName?: string
    sourceCharPosition?: number
    forcedStyleAndLayoutDuration?: number
}

const describeScripts = (entry: PerformanceEntry): string[] | undefined => {
    const scripts = (entry as PerformanceEntry & { scripts?: AnimationFrameScript[] }).scripts

    if (!scripts?.length)
        return undefined

    return [...scripts].sort((left, right) => right.duration - left.duration).slice(0, 5).map(
        script => [
            `${Math.round(script.duration)}ms`,
            script.invoker ?? '',
            `${script.sourceFunctionName || '(anonymous)'}@${(script.sourceURL ?? '').replace(/^https?:\/\/[^/]+/u, '')}:${script.sourceCharPosition ?? ''}`,
            script.forcedStyleAndLayoutDuration ? `layout ${Math.round(script.forcedStyleAndLayoutDuration)}ms` : '',
        ].filter(Boolean).join(' '),
    )
}

const describeEvent = (entry: PerformanceEventTiming): ReportedEntry['eventTiming'] => {
    const {
        duration,
        processingEnd,
        processingStart,
        startTime,
        target,
    } = entry

    const element = target instanceof Element ? target : null
    const role = element?.getAttribute('role') ?? ''

    return {
        inputDelay: Math.round(processingStart - startTime),
        processingDuration: Math.round(processingEnd - processingStart),
        processingStart,
        processingEnd,
        timeAfterProcessing: Math.round(
            Math.max(0, startTime + duration - processingEnd),
        ),
        target: element
            ? {
                tag: element.localName.slice(0, 64),
                role: /^[a-z][a-z-]{0,31}$/u.test(role) ? role : null,
                classes: (element.getAttribute('class') ?? '')
                      .split(/\s+/u, 3).filter(name => /^[a-z_][a-z0-9_-]{0,63}$/iu.test(name)),
            }
            : null,
    }
}

type FrameInterval = {
    frameStart: number
    frameEnd: number
    callbackStart: number
    callbackEnd: number
    heartbeatCount: number
}

type HeartbeatInterval = {
    scheduledAt: number
    callbackAt: number
    lateness: number
}

class ClientPerformanceReport {
    private readonly pageId = Math.random().toString(36).slice(2, 10)
    private readonly supportedEntryTypes = typeof PerformanceObserver === 'undefined' ? [] : (PerformanceObserver.supportedEntryTypes ?? [])

    private readonly observers: PerformanceObserver[] = []
    private readonly pending: ReportedEntry[] = []
    private droppedEntries = 0
    private flushTimer?: number
    private heartbeatTimer?: number
    private frameRequest?: number
    private lastFrameTime?: number
    private lastFrameCallbackTime?: number
    private lastFrameHeartbeat = 0
    private heartbeatSequence = 0
    private readonly frameIntervals: FrameInterval[] = []
    private readonly heartbeatIntervals: HeartbeatInterval[] = []
    private droppedFrameIntervals = 0
    private droppedHeartbeatIntervals = 0
    private heartbeats = {
        count: 0,
        maxLateness: 0,
        slowCount: 0,
    }
    private suspended = false
    private frameGaps = {
        count: 0,
        total: 0,
        max: 0,
        maxCallbackGap: 0,
        slowCount: 0,
    }

    constructor(private readonly hot: HotChannel) {
        this.restoreGlass()
        window.addEventListener(
            'keydown',
            this.toggleGlass,
            true,
        )

        for (const type of [
            'longtask',
            'long-animation-frame',
            'mark',
            'measure',
            'event',
            'navigation',
        ])
            this.observe(type)

        document.addEventListener('visibilitychange', this.handleVisibilityChange)
        window.addEventListener('pagehide', this.handlePageHide)
        window.addEventListener('pageshow', this.handlePageShow)

        if (document.readyState === 'complete')
            this.recordResourceSummary()
        else
            window.addEventListener(
                'load',
                this.recordResourceSummary,
                { once: true },
            )

        this.handleVisibilityChange()
    }

    destroy(): void {
        this.stopSampling()
        window.removeEventListener(
            'keydown',
            this.toggleGlass,
            true,
        )
        this.restoreGlass()

        for (const observer of this.observers)
            observer.disconnect()

        document.removeEventListener('visibilitychange', this.handleVisibilityChange)
        window.removeEventListener('pagehide', this.handlePageHide)
        window.removeEventListener('pageshow', this.handlePageShow)
        window.removeEventListener('load', this.recordResourceSummary)
    }

    private restoreGlass(): void {
        if (!document.documentElement.hasAttribute(GLASS_BYPASS_ATTRIBUTE))
            return

        document.documentElement.removeAttribute(GLASS_BYPASS_ATTRIBUTE)
        window.dispatchEvent(
            new Event(GLASS_TOGGLE_EVENT),
        )
    }

    private toggleGlass = (event: KeyboardEvent): void => {
        if (
            event.code !== 'KeyG'
            || !event.ctrlKey
            || !event.altKey
            || !event.shiftKey
            || event.metaKey
            || event.repeat
            || event.isComposing
        )
            return

        event.preventDefault()
        event.stopPropagation()
        const bypassed = document.documentElement.toggleAttribute(GLASS_BYPASS_ATTRIBUTE)
        const name = bypassed ? 'canvas:glass-bypass' : 'canvas:glass-restore'
        const start = performance.now()
        performance.mark(name)
        window.dispatchEvent(
            new Event(GLASS_TOGGLE_EVENT),
        )

        if (this.pending.length < MAX_ENTRIES_PER_BATCH)
            this.pending.push({
                type: 'profile-mode',
                name,
                start,
                duration: 0,
                glassMode: bypassed ? 'bypassed' : 'normal',
            })
        else
            this.droppedEntries++

        this.scheduleFlush()
    }

    private observe(type: string): void {
        if (!this.supportedEntryTypes.includes(type))
            return

        try {
            const observer = new PerformanceObserver(this.collect)
            observer.observe({
                type,
                buffered: true,
                ...(type === 'event' ? { durationThreshold: 40 } : {}),
            })
            this.observers.push(observer)
        } catch {}
    }

    private collect = (list: PerformanceObserverEntryList): void => {
        for (const entry of list.getEntries()) {
            if (this.pending.length >= MAX_ENTRIES_PER_BATCH) {
                this.droppedEntries++

                continue
            }

            const scripts = describeScripts(entry)
            const eventTiming = entry.entryType === 'event' ? describeEvent(entry as PerformanceEventTiming) : undefined
            this.pending.push({
                type: entry.entryType,
                name: entry.entryType === 'navigation' ? new URL(entry.name).pathname : entry.name,
                start: Math.round(entry.startTime),
                duration: Math.round(entry.duration),
                ...(scripts ? { scripts } : {}),
                ...(eventTiming ? { eventTiming } : {}),
            })
        }

        this.scheduleFlush()
    }

    private recordResourceSummary = (): void => {
        const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
        const scripts = resources.filter(
            entry => entry.initiatorType === 'script' || entry.name.includes('.ts') || entry.name.includes('/.vite/deps/'),
        )
        this.pending.push({
            type: 'resource-summary',
            name: `${scripts.length} modules, last finished`,
            start: 0,
            duration: Math.round(
                Math.max(0, ...scripts.map(entry => entry.responseEnd)),
            ),
        })
        this.scheduleFlush()
    }

    private handlePageHide = (event: PageTransitionEvent): void => {
        if (event.persisted) {
            this.suspended = true
            this.stopSampling()
        } else
            this.destroy()
    }

    private handlePageShow = (event: PageTransitionEvent): void => {
        if (!event.persisted)
            return

        this.suspended = false
        this.handleVisibilityChange()
    }

    private handleVisibilityChange = (): void => {
        this.stopSampling()

        if (
            !this.suspended
            && document.visibilityState === 'visible'
        ) {
            this.frameRequest = window.requestAnimationFrame(this.sampleFrame)
            this.scheduleHeartbeat()
        }

        this.scheduleFlush()
    }

    private stopSampling(): void {
        window.clearTimeout(this.flushTimer)
        window.clearTimeout(this.heartbeatTimer)

        if (this.frameRequest !== undefined)
            window.cancelAnimationFrame(this.frameRequest)

        this.flushTimer = undefined
        this.heartbeatTimer = undefined
        this.frameRequest = undefined
        this.lastFrameTime = undefined
        this.lastFrameCallbackTime = undefined
        this.lastFrameHeartbeat = 0
        this.heartbeatSequence = 0
        this.resetResponsiveness()
    }

    private resetResponsiveness(): void {
        this.frameGaps = {
            count: 0,
            total: 0,
            max: 0,
            maxCallbackGap: 0,
            slowCount: 0,
        }
        this.heartbeats = {
            count: 0,
            maxLateness: 0,
            slowCount: 0,
        }
        this.frameIntervals.length = 0
        this.heartbeatIntervals.length = 0
        this.droppedFrameIntervals = 0
        this.droppedHeartbeatIntervals = 0
    }

    private scheduleHeartbeat(): void {
        const scheduledAt = performance.now() + HEARTBEAT_INTERVAL_MS
        this.heartbeatTimer = window.setTimeout(() => this.sampleHeartbeat(scheduledAt), HEARTBEAT_INTERVAL_MS)
    }

    private sampleHeartbeat(scheduledAt: number): void {
        this.heartbeatTimer = undefined
        const callbackAt = performance.now()
        const lateness = Math.max(0, callbackAt - scheduledAt)
        this.heartbeatSequence++
        this.heartbeats.count++
        this.heartbeats.maxLateness = Math.max(this.heartbeats.maxLateness, lateness)

        if (lateness >= SLOW_FRAME_GAP_MS) {
            this.heartbeats.slowCount++

            if (this.heartbeatIntervals.length < MAX_RESPONSIVENESS_INTERVALS)
                this.heartbeatIntervals.push({
                    scheduledAt,
                    callbackAt,
                    lateness,
                })
            else
                this.droppedHeartbeatIntervals++
        }

        // Start the next interval from this callback, so one stall does not
        // appear as accumulated lateness in every later heartbeat.
        this.scheduleHeartbeat()
    }

    private sampleFrame = (time: number): void => {
        const callbackAt = performance.now()

        if (
            this.lastFrameTime !== undefined
            && this.lastFrameCallbackTime !== undefined
        ) {
            const gap = time - this.lastFrameTime
            const callbackGap = callbackAt - this.lastFrameCallbackTime
            this.frameGaps.count++
            this.frameGaps.total += gap
            this.frameGaps.max = Math.max(this.frameGaps.max, gap)
            this.frameGaps.maxCallbackGap = Math.max(this.frameGaps.maxCallbackGap, callbackGap)

            if (gap >= SLOW_FRAME_GAP_MS)
                this.frameGaps.slowCount++

            if (
                gap >= SLOW_FRAME_GAP_MS
                || callbackGap >= SLOW_FRAME_GAP_MS
            ) {
                if (this.frameIntervals.length < MAX_RESPONSIVENESS_INTERVALS)
                    this.frameIntervals.push({
                        frameStart: this.lastFrameTime,
                        frameEnd: time,
                        callbackStart: this.lastFrameCallbackTime,
                        callbackEnd: callbackAt,
                        heartbeatCount: this.heartbeatSequence - this.lastFrameHeartbeat,
                    })
                else
                    this.droppedFrameIntervals++
            }
        }

        this.lastFrameTime = time
        this.lastFrameCallbackTime = callbackAt
        this.lastFrameHeartbeat = this.heartbeatSequence
        this.frameRequest = window.requestAnimationFrame(this.sampleFrame)
    }

    private scheduleFlush(): void {
        const visible = document.visibilityState === 'visible'

        if (
            this.suspended
            || this.flushTimer !== undefined
            || (!visible && this.pending.length === 0)
        )
            return

        const start = performance.now()
        this.flushTimer = window.setTimeout(() => this.flush(start, visible), REPORT_INTERVAL_MS)
    }

    private flush(
        start: number,
        wasVisible: boolean,
    ): void {
        this.flushTimer = undefined
        const visibility = document.visibilityState
        const {
            count,
            total,
            max,
            maxCallbackGap,
            slowCount,
        } = this.frameGaps
        const duration = performance.now() - start
        const responsiveness = wasVisible
            && visibility === 'visible'
            ? {
                start: Math.round(start),
                duration: Math.round(duration),
                timerDelay: Math.round(
                    Math.max(0, duration - REPORT_INTERVAL_MS),
                ),
                frameGapCount: count,
                averageFrameGap: count ? Math.round(total / count) : null,
                maxFrameGap: count ? Math.round(max) : null,
                maxFrameCallbackGap: count ? Math.round(maxCallbackGap) : null,
                frameGapsAtLeast50ms: slowCount,
                frameIntervals: [...this.frameIntervals],
                droppedFrameIntervals: this.droppedFrameIntervals,
                heartbeat: {
                    interval: HEARTBEAT_INTERVAL_MS,
                    count: this.heartbeats.count,
                    maxLateness: this.heartbeats.count ? Math.round(this.heartbeats.maxLateness) : null,
                    delaysAtLeast50ms: this.heartbeats.slowCount,
                    intervals: [...this.heartbeatIntervals],
                    droppedIntervals: this.droppedHeartbeatIntervals,
                },
            }
            : null
        this.resetResponsiveness()

        if (
            responsiveness
            || this.pending.length
        ) {
            this.hot.send(
                CLIENT_PERFORMANCE_EVENT,
                {
                    source: {
                        pageId: this.pageId,
                        runtime: '__TAURI_INTERNALS__' in window ? 'tauri' : 'browser',
                        userAgent: navigator.userAgent,
                        timeOrigin: performance.timeOrigin,
                        width: window.innerWidth,
                        height: window.innerHeight,
                        devicePixelRatio: window.devicePixelRatio,
                        path: window.location.pathname,
                        visibility,
                        glassMode: document.documentElement.hasAttribute(GLASS_BYPASS_ATTRIBUTE) ? 'bypassed' : 'normal',
                        supportedEntryTypes: this.supportedEntryTypes,
                    },
                    entries: this.pending.splice(0),
                    droppedEntries: this.droppedEntries,
                    responsiveness,
                },
            )
            this.droppedEntries = 0
        }

        this.scheduleFlush()
    }
}

let activeReport: ClientPerformanceReport | undefined

// Call only when VITE_CLIENT_PERFORMANCE_DEBUG is enabled. Without the Vite
// development channel, the page installs no observers, timers or frame callbacks.
export const reportClientPerformance = (hot: HotChannel | undefined): void => {
    if (
        !hot
        || activeReport
    )
        return

    const report = new ClientPerformanceReport(hot)
    activeReport = report
    hot.dispose(() => {
        report.destroy()
        activeReport = undefined
    })
}
