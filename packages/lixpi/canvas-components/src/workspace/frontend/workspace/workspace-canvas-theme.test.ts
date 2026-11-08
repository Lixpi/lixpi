// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
    describe,
    expect,
    it,
} from 'vitest'
import { createLixpiCanvasSettings } from '../settings/index.ts'
import {
    applyWorkspaceCanvasTheme,
} from '../settings/canvas-theme.ts'
import {
    createLixpiCanvasTheme,
} from '../settings/light-theme.ts'
import {
    createCanvasTheme,
} from '../../../frontend/theme/canvas-theme.ts'
import {
    getWorkspaceRightPanelCssProperties,
} from './workspace-canvas-theme.ts'
import {
    resolveLixpiCanvasTheme,
} from './workspace-theme.ts'

import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'

const settings = (): WorkspaceCanvasHost['settings'] => ({
    ...createLixpiCanvasSettings(),
    aiChatThread: {
        styles: {
            nodeBorder: 'border',
            nodeBoxShadow: 'shadow',
            panelSectionDividerBorder: 'divider',
        },
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
    it('keeps body typography from overriding configured control labels', () => {
        const source = readFileSync(resolve(import.meta.dirname, '../settings/canvas-theme.scss'), 'utf8')
        const rules = Array.from(source.matchAll(/(\[data-canvas-theme\][^{]*)\{([^}]*)\}/g))
            .map(([, selector, declarations]) => ({
                selector: selector.trim(),
                declarations,
            }))
        const root = rules.find(rule => rule.selector === '[data-canvas-theme]')
        expect(root?.declarations).toContain('font-size: var(--canvas-font-size);')

        for (const rule of rules) {
            if (rule === root)
                continue

            expect(rule.declarations).not.toContain('font-size: var(--canvas-font-size);')

            if (/\.sliding-(?:switch|dropdown)-option(?:\b|-)/.test(rule.selector))
                expect(rule.declarations).not.toMatch(/\bfont-(?:size|family|weight)\s*:/)
        }

        expect(root?.declarations).not.toContain('--help-tooltip-font-size:')
        expect(root?.declarations).not.toContain('--progress-timeline-title-size:')
        expect(root?.declarations).not.toContain('--progress-timeline-summary-size:')
    })

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

    it('preserves the original dark branch styles and transparent model-circle fill by default', () => {
        const original = createLixpiCanvasSettings()
        const resolved = resolveLixpiCanvasTheme(createCanvasTheme(), original)

        expect(resolved.mediaBranchLineage.branchOrigin.styles).toEqual(original.mediaBranchLineage.branchOrigin.styles)
        expect(resolved.mediaBranchLineage.mediaModelCircle.styles).toEqual(original.mediaBranchLineage.mediaModelCircle.styles)
        expect(resolved.mediaBranchLineage.branchOrigin.styles.backgroundColor).toBe('#5d656d')
        expect(resolved.mediaBranchLineage.branchOrigin.styles.iconColor).toBe('#f5f3f3')
        expect(resolved.mediaBranchLineage.mediaModelCircle.styles.backgroundColor).toBe('transparent')
        expect(createCanvasTheme().colors.background).toBe('transparent')
    })

    it('honors explicit overrides for branch and model-circle theme properties', () => {
        const resolved = resolveLixpiCanvasTheme(createCanvasTheme({
            properties: {
                '--canvas-lixpi-branch-background': '#123456',
                '--canvas-lixpi-model-circle-background': '#abcdef',
            },
        }), createLixpiCanvasSettings())

        expect(resolved.mediaBranchLineage.branchOrigin.styles.backgroundColor).toBe('#123456')
        expect(resolved.mediaBranchLineage.mediaModelCircle.styles.backgroundColor).toBe('#abcdef')
    })

    it('keeps Lixpi wrapper defaults for branch and model circles unless explicitly overridden', () => {
        const base = createCanvasTheme()
        const wrapped = createLixpiCanvasTheme(base)
        const settings = createLixpiCanvasSettings()
        const resolved = resolveLixpiCanvasTheme(wrapped, settings)

        expect(wrapped.colors.background).toBe('transparent')
        expect(resolved.mediaBranchLineage.branchOrigin.styles).toEqual(settings.mediaBranchLineage.branchOrigin.styles)
        expect(resolved.mediaBranchLineage.mediaModelCircle.styles).toEqual(settings.mediaBranchLineage.mediaModelCircle.styles)
    })
})
