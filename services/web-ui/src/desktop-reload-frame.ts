import { hasOverlayTitleBar } from './components/windowTitleBar/title-bar-mode.ts'

const startupSchemeKey = 'lixpi:desktop-startup-scheme'

type DesktopWindow = Window & {
    __lixpiReload?: () => void
    __lixpiDiagnostics?: string[]
}

export const mountDesktopReloadFrame = (window: DesktopWindow): (() => void) | undefined => {
    const {
        document,
        location,
    } = window
    const root = document.documentElement

    if (!hasOverlayTitleBar(root))
        return undefined

    const showReloadFrame = (): void => {
        const scheme = root.dataset.theme ?? root.dataset.desktopStartupScheme

        if (
            scheme === 'dark'
            || scheme === 'light'
        ) {
            root.dataset.desktopStartupScheme = scheme

            try {
                window.sessionStorage.setItem(startupSchemeKey, scheme)
            } catch {}
        }

        root.dataset.desktopStartup = 'reloading'
        const frame = document.getElementById('desktop-startup-frame')

        // Use the top layer to cover a fullscreen player or a dialog.
        if (
            frame?.showPopover
            && frame.popover !== 'manual'
        ) {
            frame.popover = 'manual'

            try {
                frame.showPopover()
            } catch {
                frame.popover = null
            }
        }
    }

    window.__lixpiReload = () => {
        if (root.dataset.desktopStartup === 'reloading')
            return

        showReloadFrame()

        if (document.visibilityState === 'hidden') {
            location.reload()

            return
        }

        // The first callback runs before a paint. Reload at the next one,
        // after Chromium has had a frame to present the outgoing cover.
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                if (window.__lixpiDiagnostics) {
                    const frame = document.getElementById('desktop-startup-frame')

                    if (frame) {
                        const {
                            backgroundColor,
                            display,
                            opacity,
                        } = window.getComputedStyle(frame)

                        try {
                            window.sessionStorage.setItem(
                                'lixpi:desktop-reload-outgoing-frame',
                                JSON.stringify({
                                    backgroundColor,
                                    display,
                                    opacity,
                                }),
                            )
                        } catch {}
                    }
                }

                location.reload()
            })
        })
    }

    // An older desktop menu or a browser-driven navigation can only notify
    // the outgoing page here. The next document still has its startup cover.
    window.addEventListener('beforeunload', showReloadFrame)
    window.addEventListener('pageshow', event => {
        if (
            event.persisted
            && root.dataset.desktopStartup === 'reloading'
        ) {
            const frame = document.getElementById('desktop-startup-frame')

            if (frame)
                frame.popover = null

            delete root.dataset.desktopStartup
        }
    })

    return () => {
        if (root.dataset.desktopStartup === 'loading')
            delete root.dataset.desktopStartup
    }
}
