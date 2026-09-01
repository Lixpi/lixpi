// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
} from 'vitest'
import { createLixpiCanvasSettings } from '../settings/index.ts'
import {
    applyWorkspaceCanvasTheme,
    getWorkspaceRightPanelCssProperties,
} from './workspace-canvas-theme.ts'
import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'

const settings = (): WorkspaceCanvasHost['settings'] => ({
    ...createLixpiCanvasSettings(),
    aiChatThread: {
        styles: { nodeBorder: 'border', nodeBoxShadow: 'shadow', panelSectionDividerBorder: 'divider' },
        contextPreview: {
            styles: new Proxy({}, { get: (_target, property) => String(property) }),
        },
        panelSwitch: {} as never,
    },
    rightSidePanel: {} as never,
    videoControls: {},
    helpTooltip: { interactiveHideDelayMs: 0 },
    dropdown: { styles: { popoverBoxShadow: '' } },
    aiPromptInput: { useShiftingGradientBackground: false },
    gradient: { styles: { shiftingColors: [] } },
})

describe('workspace canvas theme', () => {
    it('applies canvas CSS properties from instance settings', () => {
        const pane = document.createElement('div')
        const appearance = settings()

        applyWorkspaceCanvasTheme(pane, appearance)

        expect(pane.style.getPropertyValue('--connector-line-default-color')).toBe(appearance.connector.styles.lineDefaultColor)
        expect(pane.style.getPropertyValue('--workspace-media-node-border-radius')).toBe(`${appearance.mediaNode.styles.borderRadius}px`)
        expect(pane.style.getPropertyValue('--workspace-branch-marker-message-font-size')).toBe(`${appearance.mediaBranchLineage.marker.text.messageFontSize}px`)
    })

    it('maps right-panel and context-preview styles to stable CSS properties', () => {
        const properties = getWorkspaceRightPanelCssProperties(settings())

        expect(properties['--ai-chat-thread-node-border']).toBe('border')
        expect(properties['--context-preview-tooltip-color']).toBe('tooltipColor')
    })
})
