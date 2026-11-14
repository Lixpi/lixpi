import {
    createLixpiUiSettings,
    type Settings,
} from '@lixpi/canvas-components/workspace/settings'
import { hasOverlayTitleBar } from '$src/components/windowTitleBar/title-bar-mode.ts'

// Every settings type stays importable from here, so web-ui code only ever
// imports settings from this file. The local `settings` export below shadows
// the package's default instance.
export * from '@lixpi/canvas-components/workspace/settings'

export type SettingsOverrides = {
    [Section in keyof Settings]?: Settings[Section]
}

const sharedSettings = createLixpiUiSettings()

// In the desktop app the panel toggles sit in the window's title bar row,
// vertically centred in it; elsewhere they keep the shared position.
// `--window-title-bar-active` is 1 while that row shows and 0 otherwise.
const inWindowTitleBar = (
    browser: string,
    titleBar: string,
): string => `calc(${browser} * (1 - var(--window-title-bar-active, 0)) + ${titleBar} * var(--window-title-bar-active, 0))`

const centredInWindowTitleBar = (size: string): string => `((var(--window-title-bar-height, 0px) - ${size}) / 2)`

const navigationToggle = sharedSettings.navigationSidePanel.toggle
const rightToggle = sharedSettings.rightSidePanel.toggle

// In the title bar row the navigation toggle sits just outside the open
// panel's edge and slides with the panel to just after the traffic lights
// when it closes. Elsewhere it stays where it is, and a browser keeps the
// shared motion so the toggle doesn't follow a swipe that closes the panel.
const NAVIGATION_TOGGLE_PANEL_GAP = '12px'
const navigationToggleOpenOffset = `(var(--workspace-navigation-side-panel-width, 0px) + ${NAVIGATION_TOGGLE_PANEL_GAP})`

// The right toggle shows the navigation toggle's icon at the same size,
// centred where its own smaller icon used to be.
const rightToggleCentreShift = `((${rightToggle.size} - ${navigationToggle.size}) / 2)`

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
            motion: hasOverlayTitleBar() ? 'slide' : navigationToggle.motion,
            top: inWindowTitleBar(
                navigationToggle.top,
                centredInWindowTitleBar(navigationToggle.size),
            ),
            openOffset: inWindowTitleBar(navigationToggle.openOffset, navigationToggleOpenOffset),
            closedTravel: inWindowTitleBar('0px', `(${navigationToggleOpenOffset} - var(--window-controls-inset, 0px))`),
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
            toggleColor: 'var(--theme-panel-toggle-color)',
            toggleHoverColor: 'var(--theme-panel-toggle-hover)',
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
            size: navigationToggle.size,
            top: inWindowTitleBar(
                `calc(${rightToggle.top} + ${rightToggleCentreShift})`,
                centredInWindowTitleBar(navigationToggle.size),
            ),
            openOffset: `calc(${rightToggle.openOffset} + ${rightToggleCentreShift})`,
        },
    },
}

export const settings: Settings = {
    ...sharedSettings,
    ...settingsOverrides,
}

// Settings that belong to web-ui alone and not to the shared packages go
// below, as their own exports.
