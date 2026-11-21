import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import './panel-performance-scenario.scss'

const START_DELAY_MS = 4000
const SETTLE_MS = 2000

type PanelName = 'navigation' | 'right'
type Panel = {
    name: PanelName
    element: HTMLElement
    button: HTMLButtonElement
    initiallyOpen: boolean
}
type Run = {
    panels: Record<PanelName, Panel>
    action: number
}
const ACTIONS: readonly PanelName[] = ['navigation', 'navigation', 'navigation', 'navigation', 'right', 'right']

// Loaded only by the development profiling branch in main.ts.
export class PanelPerformanceScenario {
    private readonly trigger: HTMLButtonElement
    private run: Run | null = null
    private timer: number | undefined

    constructor() {
        const html = createDocumentHtml(document)
        this.trigger = html`
            <button
                type="button"
                className="panel-performance-trigger"
            >
                Profile panels
            </button>
        ` as HTMLButtonElement
        this.trigger.addEventListener('click', this.handleTrigger)
        document.body.append(this.trigger)

        window.addEventListener(
            'keydown',
            this.handleKey,
            true,
        )
        document.addEventListener('visibilitychange', this.handleVisibility)
        window.addEventListener('pagehide', this.handlePageHide)
    }

    destroy(): void {
        this.trigger.removeEventListener('click', this.handleTrigger)
        this.trigger.remove()
        window.removeEventListener(
            'keydown',
            this.handleKey,
            true,
        )
        document.removeEventListener('visibilitychange', this.handleVisibility)
        window.removeEventListener('pagehide', this.handlePageHide)
        this.cancel('dispose')
    }

    private mark(name: string): void {
        const key = `profile:panels:${name}`
        performance.mark(key)
        performance.clearMarks(key)
    }

    private isOpen(panel: Panel): boolean {
        return panel.element.classList.contains('side-panel-toggle-open')
    }

    private findPanel(name: PanelName): Panel | null {
        const selector = name === 'navigation' ? '.application-panel-toggle.side-panel-toggle-left' : '.application-panel-toggle.side-panel-toggle-right'
        const buttons = document.querySelectorAll<HTMLButtonElement>(`${selector} .side-panel-toggle-button`)
        const button = buttons[0]
        const element = button?.closest<HTMLElement>(selector)

        if (
            buttons.length !== 1
            || !element
            || button.disabled
        )
            return null

        return {
            name,
            element,
            button,
            initiallyOpen: element.classList.contains('side-panel-toggle-open'),
        }
    }

    private handleKey = (event: KeyboardEvent): void => {
        if (
            event.code !== 'KeyP'
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
        this.toggle('shortcut')
    }

    private handleTrigger = (): void => void this.toggle('button')

    private toggle(reason: 'shortcut' | 'button'): void {
        if (this.run) {
            this.cancel(reason)

            return
        }

        if (document.visibilityState !== 'visible')
            return

        const navigation = this.findPanel('navigation')
        const right = this.findPanel('right')

        if (
            !navigation
            || !right
        ) {
            this.mark('unavailable')

            return
        }

        this.run = {
            panels: {
                navigation,
                right,
            },
            action: 0,
        }
        this.trigger.textContent = 'Cancel panel profile'
        this.mark('start')
        this.mark(`initial:navigation:${navigation.initiallyOpen ? 'open' : 'closed'}:right:${right.initiallyOpen ? 'open' : 'closed'}`)
        this.timer = window.setTimeout(this.nextAction, START_DELAY_MS)
    }

    private nextAction = (): void => {
        this.timer = undefined
        const run = this.run

        if (!run)
            return

        const name = ACTIONS[run.action]

        if (!name) {
            const restored = Object.values(run.panels).every(panel => panel.button.isConnected && this.isOpen(panel) === panel.initiallyOpen)

            if (!restored) {
                this.cancel('final-state-mismatch')

                return
            }

            this.run = null
            this.trigger.textContent = 'Profile panels'
            this.mark('complete')

            return
        }

        const panel = run.panels[name]

        if (
            !panel.button.isConnected
            || panel.button.disabled
        ) {
            this.cancel('missing-target')

            return
        }

        const expectedOpen = !this.isOpen(panel)
        const action = `${run.action + 1}:${name}`
        const start = performance.now()
        this.mark(`${action}:start:${expectedOpen ? 'open' : 'closed'}`)
        panel.button.click()
        const end = performance.now()
        this.mark(`${action}:returned:${this.isOpen(panel) ? 'open' : 'closed'}`)
        const measure = `profile:panels:${action}:click`
        performance.measure(
            measure,
            {
                start,
                end,
            },
        )
        performance.clearMeasures(measure)

        if (this.run !== run)
            return

        this.timer = window.setTimeout(
            () => {
                this.timer = undefined

                if (this.run !== run)
                    return

                if (
                    !panel.button.isConnected
                    || this.isOpen(panel) !== expectedOpen
                ) {
                    this.cancel('state-mismatch')

                    return
                }

                this.mark(`${action}:verified:${expectedOpen ? 'open' : 'closed'}`)
                run.action++
                this.nextAction()
            },
            SETTLE_MS,
        )
    }

    private cancel(reason: string): void {
        window.clearTimeout(this.timer)
        this.timer = undefined
        const run = this.run
        this.run = null

        if (!run)
            return

        this.trigger.textContent = 'Profile panels'
        this.mark(`cancel:${reason}`)

        for (const panel of Object.values(run.panels)) {
            if (
                !panel.button.isConnected
                || panel.button.disabled
            ) {
                this.mark(`restore:${panel.name}:unavailable`)

                continue
            }

            if (this.isOpen(panel) !== panel.initiallyOpen)
                panel.button.click()

            this.mark(`restore:${panel.name}:${this.isOpen(panel) === panel.initiallyOpen ? 'verified' : 'pending'}`)
        }
    }

    private handleVisibility = (): void => {
        if (document.visibilityState !== 'visible')
            this.cancel('hidden')
    }

    private handlePageHide = (): void => void this.cancel('pagehide')
}
