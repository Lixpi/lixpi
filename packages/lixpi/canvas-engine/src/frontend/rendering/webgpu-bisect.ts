// A diagnostic that finds which canvas feature makes a browser's WebGPU
// implementation fail. WebKit ends its GPU process on a Metal "invalid
// resource" error while drawing workspace images, which Chrome never does with
// the same commands, and WebKit doesn't say which command failed.
//
// Set `localStorage['canvas:webgpu-bisect'] = '1'` and reload a workspace that
// shows images. Each round turns off one suspect, or none for the first round,
// and waits for the device to be lost or for images to stay on screen long
// enough to count as surviving. It records the outcome, reloads into the next
// round, and after the last one logs a summary and clears the flag. Every line
// starts with `[webgpu-bisect]`, so the desktop app's diagnostics log has the
// whole run. Turning a feature off here only isolates the cause; it is never
// the fix.

export type WebGpuSuspect = 'mask' | 'mipmaps' | 'antialias' | 'captures' | 'bitmap-upload'

type RoundResult = {
    disabled: WebGpuSuspect | 'nothing'
    outcome: 'device lost' | 'survived'
}

type BisectState = {
    round: number
    results: RoundResult[]
}

const FLAG_KEY = 'canvas:webgpu-bisect'
const STATE_KEY = 'canvas:webgpu-bisect-state'

const ROUNDS: ReadonlyArray<WebGpuSuspect | null> = [
    null,
    'mask',
    'mipmaps',
    'antialias',
    'captures',
    'bitmap-upload',
]

// Images that stay on screen this long after their texture is created count
// as surviving. Every crash seen so far came within two seconds.
const SURVIVAL_MS = 10_000

const read = (
    storage: Storage | undefined,
    key: string,
): string | null => {
    try {
        return storage?.getItem(key) ?? null
    } catch {
        return null
    }
}

const write = (
    storage: Storage | undefined,
    key: string,
    value: string | null,
): void => {
    try {
        if (value === null)
            storage?.removeItem(key)
        else
            storage?.setItem(key, value)
    } catch {
        // Without storage the run can't continue across reloads; it just stops.
    }
}

class WebGpuBisect {
    private readonly state: BisectState
    private readonly disabled: WebGpuSuspect | null
    private survival: ReturnType<typeof setTimeout> | null = null
    private finished = false

    constructor() {
        const saved = read(globalThis.sessionStorage, STATE_KEY)
        this.state = saved ? JSON.parse(saved) as BisectState : {
            round: 0,
            results: [],
        }
        this.disabled = ROUNDS[this.state.round] ?? null
        console.info(`[webgpu-bisect] round ${this.state.round + 1} of ${ROUNDS.length}: ${this.disabled ? `${this.disabled} off` : 'everything on'}`)
    }

    disables(suspect: WebGpuSuspect): boolean {
        return this.disabled === suspect
    }

    watch(device: GPUDevice): void {
        device.addEventListener(
            'uncapturederror',
            event => void console.error(`[webgpu-bisect] uncaptured WebGPU error: ${(event as GPUUncapturedErrorEvent).error.message}`),
        )
        void (async () => {
            const info = await device.lost
            console.error(`[webgpu-bisect] device lost (${info.reason}): ${info.message}`)
            this.finish('device lost')
        })()
    }

    imageShown(): void {
        if (
            this.survival
            || this.finished
        )
            return

        this.survival = setTimeout(() => this.finish('survived'), SURVIVAL_MS)
    }

    private finish(outcome: RoundResult['outcome']): void {
        if (this.finished)
            return

        this.finished = true

        if (this.survival)
            clearTimeout(this.survival)

        const results = [
            ...this.state.results,
            {
                disabled: this.disabled ?? 'nothing',
                outcome,
            } satisfies RoundResult,
        ]
        console.info(`[webgpu-bisect] round ${this.state.round + 1}: ${this.disabled ? `${this.disabled} off` : 'everything on'}, ${outcome}`)
        const round = this.state.round + 1

        if (round >= ROUNDS.length) {
            const summary = results.map(result => `${result.disabled} off: ${result.outcome}`).join('; ')
            console.info(`[webgpu-bisect] done. ${summary}`)
            write(
                globalThis.sessionStorage,
                STATE_KEY,
                null,
            )
            write(
                globalThis.localStorage,
                FLAG_KEY,
                null,
            )

            return
        }

        write(
            globalThis.sessionStorage,
            STATE_KEY,
            JSON.stringify({
                round,
                results,
            } satisfies BisectState),
        )
        globalThis.location?.reload()
    }
}

let current: WebGpuBisect | null | undefined

// The run for this page, or null when the flag isn't set.
export const webGpuBisect = (): WebGpuBisect | null => {
    if (current === undefined)
        current = read(globalThis.localStorage, FLAG_KEY) === '1' ? new WebGpuBisect() : null

    return current
}
