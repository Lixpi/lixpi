// Whether the page draws the window's title bar row. The desktop app on macOS
// marks `<html>` with `data-title-bar="overlay"` before any page script runs,
// so the answer is settled by the time any module reads it, and it holds for
// the life of the page. A browser never sets it.

export const OVERLAY_TITLE_BAR = 'overlay'

export const hasOverlayTitleBar = (root: HTMLElement | undefined = globalThis.document?.documentElement): boolean =>
    root?.dataset.titleBar === OVERLAY_TITLE_BAR
