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

// Web UI's own changes to the shared package defaults. Name a section here
// only when web-ui must deliberately differ, and spread the shared section so
// only the named fields change.
const settingsOverrides: SettingsOverrides = {
    navigationSidePanel: {
        ...sharedSettings.navigationSidePanel,
        // The workspace list takes its own space and the canvas shrinks beside
        // it. Set `overlay` to float the list over the canvas instead.
        placement: 'push',
        overlay: {
            ...sharedSettings.navigationSidePanel.overlay,
            // The list stays open when the user clicks the canvas. Set `true`
            // to close it on any click outside the panel.
            closeOnPointerDown: false,
        },
    },
}

export const settings: Settings = {
    ...sharedSettings,
    ...settingsOverrides,
}

// Settings that belong to web-ui alone and not to the shared packages go
// below, as their own exports.
