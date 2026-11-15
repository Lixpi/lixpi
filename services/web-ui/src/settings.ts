import {
    createLixpiUiSettings,
    type Settings,
} from '@lixpi/canvas-components/workspace/settings'

// Every settings type stays importable from here, so web-ui code only ever
// imports settings from this file. The local `settings` export below shadows
// the package's default instance.
export * from '@lixpi/canvas-components/workspace/settings'

export type SettingsOverrides = {
    [Section in keyof Settings]?: Settings[Section]
}

const sharedSettings = createLixpiUiSettings()

// In the desktop app the panel toggles share the window's title bar row with
// the traffic lights. `--window-title-bar-active` is 1 while that row shows
// and 0 otherwise.
const inWindowTitleBar = (
    browser: string,
    titleBar: string,
): string => `calc(${browser} * (1 - var(--window-title-bar-active, 0)) + ${titleBar} * var(--window-title-bar-active, 0))`

// The toggles sit as far below the window's top edge as the traffic light oval
// in the desktop app, and the browser uses that offset too.
const TOGGLE_TOP = 'var(--window-title-bar-control-top, 0px)'

const navigationToggle = sharedSettings.navigationSidePanel.toggle
const rightToggle = sharedSettings.rightSidePanel.toggle

// The navigation toggle sits just outside the open panel's edge, over the
// canvas, so the canvas draws its glass rim like the controls beside the
// prompt input. When the panel closes it slides to the top-left margin in a
// browser, or to just after the traffic lights' oval in the title bar row.
const NAVIGATION_TOGGLE_PANEL_GAP = '12px'
const navigationToggleOpenOffset = `calc(var(--workspace-navigation-side-panel-width, 0px) + ${NAVIGATION_TOGGLE_PANEL_GAP})`
const navigationToggleClosedOffset = inWindowTitleBar(TOGGLE_TOP, 'var(--window-title-bar-toggle-left, 0px)')

// Web UI's own changes to the shared package defaults. Name a section here
// only when web-ui must deliberately differ, and spread the shared section so
// only the named fields change.
const settingsOverrides: SettingsOverrides = {
    navigationSidePanel: {
        ...sharedSettings.navigationSidePanel,
        // The workspace list takes its own space and the canvas shrinks beside
        // it. Set `overlay` to float the list over the canvas instead.
        placement: 'push',
        toggle: {
            ...navigationToggle,
            motion: 'slide',
            top: TOGGLE_TOP,
            openOffset: navigationToggleOpenOffset,
            closedTravel: `calc(${navigationToggleOpenOffset} - ${navigationToggleClosedOffset})`,
        },
        resizeHandle: {
            ...sharedSettings.navigationSidePanel.resizeHandle,
            styles: {
                gradient: 'var(--theme-panel-resize-handle-gradient)',
                width: 'var(--theme-navigation-resize-handle-width)',
            },
        },
        styles: {
            backdropFill: 'var(--theme-navigation-backdrop)',
            backdropFillOpaque: 'var(--theme-navigation-backdrop-opaque)',
        },
        overlay: {
            ...sharedSettings.navigationSidePanel.overlay,
            // The list stays open when the user clicks the canvas. Set `true`
            // to close it on any click outside the panel.
            closeOnPointerDown: false,
        },
    },
    rightSidePanel: {
        ...sharedSettings.rightSidePanel,
        toggle: {
            ...rightToggle,
            top: TOGGLE_TOP,
            // Closed, it keeps the same margin from the right edge as the
            // navigation toggle keeps from the left.
            closedTravel: `calc(${rightToggle.openOffset} - ${TOGGLE_TOP})`,
        },
    },
}

export const settings: Settings = {
    ...sharedSettings,
    ...settingsOverrides,
}

// Settings that belong to web-ui alone and not to the shared packages go
// below, as their own exports.
