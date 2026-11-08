import {
    describe,
    expect,
    it,
} from 'vitest'
import { lixpiLightTheme } from '@lixpi/themes'
import { createLixpiUiSettings } from './ui-settings.ts'

describe(
    'UI settings factory',
    () => {
        it('uses the shared theme geometry without changing the production panel defaults', () => {
            const settings = createLixpiUiSettings()
            const {
                navigationSidePanel,
                rightSidePanel,
            } = settings

            expect(navigationSidePanel.defaultDimensions.width).toBe(280)
            expect(navigationSidePanel.dimensions).toEqual({
                minWidth: 220,
                maxPaneMargin: 64,
            })
            expect(navigationSidePanel.toggle).toMatchObject({
                motion: 'fixed',
                openOffset: '20px',
                top: '20px',
                size: '20px',
            })
            expect(rightSidePanel.defaultDimensions.width).toBe(494)
            expect(rightSidePanel.dimensions).toEqual({
                minWidth: 320,
                maxPaneMargin: 64,
            })
            expect(rightSidePanel.toggle).toMatchObject({
                openOffset: 'calc(var(--workspace-right-side-panel-width) + 5px)',
                closedTravel: 'calc(var(--workspace-right-side-panel-width) - 10px)',
                top: '15px',
                size: '15px',
            })

            const geometry = lixpiLightTheme.components.sidePanel

            for (const panel of [navigationSidePanel, rightSidePanel]) {
                expect(panel.resizeHandle).toMatchObject(geometry.resizeHandle)
                expect(panel).not.toHaveProperty('animation')
            }

            expect(settings.aiChatThread.panelSwitch.height).toBe(lixpiLightTheme.components.rightPanel.geometry.modeSwitchHeight)
        })

        it(
            'keeps nested presentation changes local to one settings instance',
            () => {
                const first = createLixpiUiSettings()
                const second = createLixpiUiSettings()
                const expected = structuredClone(second)
                const sourceTheme = structuredClone(lixpiLightTheme)

                first.slidingDropdown.styles.indicator.insetShadow.topColor =
                    first.slidingDropdown.styles.indicator.insetShadow.bottomColor
                first.aiModelControls.styles.dimensionsGlyph.strokeWidth += 1
                first.videoControls.styles.liquidGlassFilter.seed += 1
                first.gradient.styles.shiftingColors.reverse()

                expect(first.slidingDropdown.styles).not.toEqual(expected.slidingDropdown.styles)
                expect(first.aiModelControls.styles).not.toEqual(expected.aiModelControls.styles)
                expect(first.videoControls.styles).not.toEqual(expected.videoControls.styles)
                expect(first.gradient.styles).not.toEqual(expected.gradient.styles)
                expect(second).toEqual(expected)
                expect(createLixpiUiSettings()).toEqual(expected)
                expect(lixpiLightTheme).toEqual(sourceTheme)
            },
        )
    },
)
