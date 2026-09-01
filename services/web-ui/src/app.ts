// App entry component. Wires the global help-tooltip provider and mounts the
// root layout. Renderer: TypeScript DOM, no framework runtime.

import { createHelpTooltipProvider } from '@lixpi/ui-kit/components/help-tooltip'
import { settings } from '$src/settings.ts'
import '@lixpi/ui-kit/styles/bubble-menu'
import '@lixpi/ui-kit/styles/canvas-node-footer'
import '@lixpi/ui-kit/styles/dropdown'
import '@lixpi/ui-kit/styles/help-tooltip'
import '@lixpi/ui-kit/styles/info-bubble'
import '@lixpi/ui-kit/styles/media-model-badge'
import '@lixpi/ui-kit/styles/progress-timeline'
import '@lixpi/ui-kit/styles/side-panel'
import '@lixpi/ui-kit/styles/loading-placeholder'
import '@lixpi/ui-kit/styles/progress-ripple'
import '@lixpi/ui-kit/styles/preview'
import '@lixpi/canvas-engine/styles/interaction'

import {
    createLayout,
    type LayoutInstance,
} from '$src/views/layouts/layout.ts'
import '$src/sass/styles.scss'

export type AppInstance = {
    destroy: () => Promise<void>
}

class Application implements AppInstance {
    private readonly helpTooltipProvider: ReturnType<typeof createHelpTooltipProvider>
    private layout: LayoutInstance | null = null
    private destruction: Promise<void> | null = null

    constructor(target: HTMLElement, private readonly closeCanvasSessions: () => Promise<void>) {
        this.helpTooltipProvider = createHelpTooltipProvider({
            showDelayMs: settings.helpTooltip.providerShowDelayMs,
            root: document,
            shouldShow: trigger => trigger.getAttribute('aria-expanded') !== 'true',
        })
        try {
            this.layout = createLayout()
            target.append(this.layout.el)
        } catch (error) {
            const errors: unknown[] = [error]
            try {
                this.layout?.destroy()
            } catch (cleanupError) {
                errors.push(cleanupError)
            }
            try {
                this.helpTooltipProvider.destroy()
            } catch (cleanupError) {
                errors.push(cleanupError)
            }
            const detail = error instanceof Error ? error.message : String(error)
            throw new AggregateError(errors, `Application mount failed: ${detail}`)
        }
    }

    destroy = (): Promise<void> => {
        this.destruction ??= this.dispose()
        return this.destruction
    }

    private async dispose(): Promise<void> {
        // Publish the shared destruction promise before invoking reentrant cleanup.
        await Promise.resolve()
        const errors: unknown[] = []
        try {
            this.layout?.destroy()
        } catch (error) {
            errors.push(error)
        }
        try {
            this.helpTooltipProvider.destroy()
        } catch (error) {
            errors.push(error)
        }
        try {
            await this.closeCanvasSessions()
        } catch (error) {
            errors.push(error)
        }
        if (errors.length > 0) throw new AggregateError(errors, 'Application shutdown failed')
    }
}

export function mountApp(target: HTMLElement, closeCanvasSessions: () => Promise<void>): AppInstance {
    return new Application(target, closeCanvasSessions)
}
