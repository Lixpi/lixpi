import { lixpiPalette as colorPalette } from '@lixpi/themes'
import {
    type CanvasTheme,
    type CanvasThemeSource,
} from '../frontend/theme/canvas-theme.ts'
import {
    type createLixpiUiSettings,
} from '../workspace/frontend/settings/ui-settings.ts'
import {
    type WorkspaceCanvasControlsSettings,
} from '../workspace/frontend/workspace/workspace-canvas-controls.ts'

export class LibraryColors {
    constructor(private readonly source: CanvasThemeSource) {}

    get background(): string {
        return this.source.value.colors.background
    }
    get surface(): string {
        return this.source.value.colors.surface
    }
    get group(): string {
        return this.source.value.colors.raised
    }
    get text(): string {
        return this.source.value.colors.text
    }
    get muted(): string {
        return this.source.value.colors.muted
    }
    get border(): string {
        return this.source.value.colors.border
    }
    get accent(): string {
        return this.source.value.colors.accent
    }
}

export const createLibraryMediaStyle = (theme: CanvasTheme) => ({
    radius: theme.shape.mediaRadius,
    placeholder: { color: theme.colors.surface },
})

export const createLibraryWorkspaceControlsSettings = (settings: ReturnType<typeof createLixpiUiSettings>): WorkspaceCanvasControlsSettings => ({
    panel: settings.rightSidePanel,
    modelMenuHoverBackground: settings.aiPromptInput.modelMenu.styles.triggerActiveBackground,
    palette: colorPalette,
})

export {
    ExampleBoxView,
    type ExampleBoxContent,
    type ExampleBoxViewOptions,
} from './example-box-node.ts'
