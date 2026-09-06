// App entry component. Mounts the root layout, which owns the sidebar and
// whichever page the route names. Renderer: TypeScript DOM, no framework
// runtime.

// The theme first: every component stylesheet below it is an override, and CSS
// ties are decided by which rule was loaded last.
import '$src/sass/styles.scss'
import {
    createLayout,
    type LayoutInstance,
} from '$src/views/layouts/layout.ts'

export type AppInstance = {
    destroy: () => void
}

class Application implements AppInstance {
    private layout: LayoutInstance | null = null

    constructor(target: HTMLElement) {
        try {
            this.layout = createLayout()
            target.append(this.layout.el)
        } catch (error) {
            this.layout?.destroy()
            this.layout = null

            const detail = error instanceof Error ? error.message : String(error)

            throw new Error(`Application mount failed: ${detail}`)
        }
    }

    destroy = (): void => {
        this.layout?.destroy()
        this.layout = null
    }
}

export const mountApp = (target: HTMLElement): AppInstance => new Application(target)
