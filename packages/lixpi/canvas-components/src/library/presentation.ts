import { lixpiPalette as colorPalette } from '@lixpi/themes'
import {
    createDiagramNodeAppearance,
    type DiagramNodeLabelAppearance,
} from '../frontend/diagram/diagram-node-view.ts'
import {
    type CanvasTheme,
    type CanvasThemeSource,
} from '../frontend/theme/canvas-theme.ts'
import {
    type createLixpiUiSettings,
} from '../workspace/frontend/settings/ui-settings.ts'
import {
    type WorkspaceCanvasChromeSettings,
} from '../workspace/frontend/workspace/workspace-canvas-chrome.ts'

type LibraryDiagramOptions = {
    shape?: DiagramNodeLabelAppearance['shape']
    raised?: boolean
    heading?: DiagramNodeLabelAppearance['heading']
    selected?: boolean
}

export class CanvasLibraryColors {
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

export const createLibraryDiagramAppearance = (
    theme: CanvasTheme,
    options: LibraryDiagramOptions = {},
): DiagramNodeLabelAppearance => ({
    ...createDiagramNodeAppearance(options.shape, theme),
    fill: options.raised ? theme.colors.raised : theme.colors.surface,
    ...(options.heading ? { heading: options.heading } : {}),
    ...(options.selected !== undefined ? { selected: options.selected } : {}),
})

export const createLibraryMediaStyle = (theme: CanvasTheme) => ({
    radius: theme.shape.mediaRadius,
    placeholder: { color: theme.colors.surface },
})

export const createLibraryWorkspaceChromeSettings = (settings: ReturnType<typeof createLixpiUiSettings>): WorkspaceCanvasChromeSettings => ({
    panel: settings.rightSidePanel,
    modelMenuHoverBackground: settings.aiPromptInput.modelMenu.styles.triggerActiveBackground,
    palette: colorPalette,
})
