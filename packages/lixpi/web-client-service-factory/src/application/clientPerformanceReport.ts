// The dev server event a development page reports its performance entries on.
export const CLIENT_PERFORMANCE_EVENT = 'lixpi:client-performance'

type HotChannel = {
    send: (
        event: string,
        data: unknown,
    ) => void
}

type ReportedEntry = {
    type: string
    name: string
    start: number
    duration: number
    // For a long animation frame, the scripts that ran longest in it.
    scripts?: string[]
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

// Reports what slows a development page down to the dev server log: tasks
// that held the main thread for 50 ms or more, input handled slowly,
// application marks and measures, and the page's own load timing. Entries
// are sent in batches once a second while new ones arrive. Call it only when
// `VITE_CLIENT_PERFORMANCE_DEBUG` is on, with the page's `import.meta.hot`;
// production builds have none, so nothing is observed there.
export const reportClientPerformance = (hot: HotChannel | undefined): void => {
    if (
        !hot
        || typeof PerformanceObserver === 'undefined'
    )
        return

    const pending: ReportedEntry[] = []
    let scheduled = false
    const flush = (): void => {
        scheduled = false

        if (!pending.length)
            return

        hot.send(
            CLIENT_PERFORMANCE_EVENT,
            pending.splice(0),
        )
    }
    const collect = (list: PerformanceObserverEntryList): void => {
        for (const entry of list.getEntries()) {
            const scripts = describeScripts(entry)
            pending.push({
                type: entry.entryType,
                name: entry.name,
                start: Math.round(entry.startTime),
                duration: Math.round(entry.duration),
                ...(scripts ? { scripts } : {}),
            })
        }

        if (!scheduled) {
            scheduled = true
            setTimeout(flush, 1000)
        }
    }
    const observe = (
        type: string,
        options: PerformanceObserverInit = {},
    ): void => {
        if (!PerformanceObserver.supportedEntryTypes?.includes(type))
            return

        try {
            new PerformanceObserver(collect).observe({
                type,
                buffered: true,
                ...options,
            })
        } catch {}
    }

    observe('longtask')
    observe('long-animation-frame')
    observe('mark')
    observe('measure')
    observe('event', { durationThreshold: 40 } as PerformanceObserverInit)
    observe('navigation')

    // How long the page spent fetching its modules and styles.
    addEventListener(
        'load',
        () => {
            const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
            const scripts = resources.filter(
                entry => entry.initiatorType === 'script' || entry.name.includes('.ts') || entry.name.includes('/.vite/deps/'),
            )
            pending.push({
                type: 'resource-summary',
                name: `${scripts.length} modules, last finished`,
                start: 0,
                duration: Math.round(
                    Math.max(0, ...scripts.map(entry => entry.responseEnd)),
                ),
            })
        },
        { once: true },
    )
}
