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

// Web UI's own changes to the shared package defaults. It is empty on purpose,
// so web-ui looks and behaves exactly like every other service. Name a section
// here only when web-ui must deliberately differ.
const settingsOverrides: SettingsOverrides = {}

export const settings: Settings = {
    ...createLixpiUiSettings(),
    ...settingsOverrides,
}

// Settings that belong to web-ui alone and not to the shared packages go
// below, as their own exports.
