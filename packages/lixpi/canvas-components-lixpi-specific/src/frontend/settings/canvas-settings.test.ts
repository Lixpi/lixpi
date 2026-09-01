import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    mediaGenerationLayoutSettings,
    workspaceCollisionSettings,
    workspacePersistenceSettings,
} from '@lixpi/constants'
import { createLixpiCanvasSettings } from './canvas-settings.ts'

describe('Lixpi canvas presets', () => {
    it('uses the API layout and persistence contracts without requiring a host theme', () => {
        const settings = createLixpiCanvasSettings()
        expect(settings.workspaceCollision).toEqual(workspaceCollisionSettings)
        expect(settings.workspacePersistence).toEqual(workspacePersistenceSettings)
        expect(settings.mediaBranchLineage.generatedMediaSize).toBe(mediaGenerationLayoutSettings.generatedMediaSize)
        expect(settings.mediaBranchLineage.marker.text).toEqual(mediaGenerationLayoutSettings.marker.text)
        expect(settings.mediaNode.generatedMediaChrome.zoomScaling).toEqual(mediaGenerationLayoutSettings.generatedMediaChrome.zoomScaling)
    })

    it('keeps nested overrides local to each canvas and leaves shared geometry unchanged', () => {
        const first = createLixpiCanvasSettings()
        const second = createLixpiCanvasSettings()
        const original = structuredClone(second)
        first.mediaBranchLineage.marker.text.messageFontSize += 10
        first.mediaNode.generatedMediaChrome.zoomScaling.minZoom += 1
        first.canvasChrome.glassBorder.materialColors.push('#000000')
        first.workspacePersistence.debounceMs += 100
        expect(second).toEqual(original)
        expect(createLixpiCanvasSettings()).toEqual(original)
    })

    it('applies supplied canvas colors without requiring or retaining the application palette', () => {
        const palette = { steelBlue: '#102030', offWhite: '#fefefe', nightBlue: '#304050' }
        const settings = createLixpiCanvasSettings(palette)
        expect(settings.connector.styles.lineDefaultColor).toBe(palette.steelBlue)
        expect(settings.mediaBranchLineage.branchOrigin.styles).toMatchObject({
            backgroundColor: palette.steelBlue,
            borderColor: palette.steelBlue,
            iconColor: palette.offWhite,
        })
        palette.steelBlue = '#abcdef'
        expect(settings.connector.styles.lineDefaultColor).toBe('#102030')
    })
})
