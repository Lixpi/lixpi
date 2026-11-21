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
        it('takes the conversation panel sizing from the theme and leaves its surface to the shared application panel', () => {
            const settings = createLixpiUiSettings()
            const geometry = lixpiLightTheme.components.rightPanel.geometry

            expect(settings.rightSidePanel.defaultDimensions.width).toBe(geometry.defaultWidth)
            expect(settings.rightSidePanel.dimensions).toEqual({
                minWidth: geometry.minWidth,
                maxPaneMargin: geometry.maxPaneMargin,
            })
            expect(settings.rightSidePanel.layout.contentInset).toBe(geometry.contentInset)

            for (const surfaceSetting of ['toggle', 'resizeHandle', 'overlay', 'drag', 'styles'])
                expect(settings.rightSidePanel).not.toHaveProperty(surfaceSetting)

            expect(settings).not.toHaveProperty('navigationSidePanel')
            expect(settings.aiChatThread.panelSwitch.height).toBe(geometry.modeSwitchHeight)
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
