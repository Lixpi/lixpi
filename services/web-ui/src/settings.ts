import {
    createLixpiUiSettings,
    type Settings,
} from '@lixpi/canvas-components/workspace/settings'

// Every settings type stays importable from here, so web-ui code only ever
// imports settings from this file. The local `settings` export below shadows
// the package's default instance.
export * from '@lixpi/canvas-components/workspace/settings'

// Web UI uses the shared package settings unchanged. Panel placement, toggles
// and geometry come from `uiKitSettings.applicationPanel`, which no service
// overrides, so every application shows the same panels.
export const settings: Settings = createLixpiUiSettings()

// Settings that belong to web-ui alone and not to the shared packages go
// below, as their own exports.
