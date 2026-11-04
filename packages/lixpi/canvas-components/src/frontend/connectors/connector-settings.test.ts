import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    createCanvasConnectorSettings,
    createDiagramConnectorSettings,
} from './connector-settings.ts'

describe('diagram connector settings', () => {
    it('keeps workspace connector sizing intact and uses compact diagram sizing', () => {
        const workspace = createCanvasConnectorSettings()
        const compact = createDiagramConnectorSettings()
        const compactWithMarkers = createDiagramConnectorSettings({ markers: true })

        expect(workspace.scaling).toMatchObject({
            strokeWidth: 3,
            markerSize: 23,
            markerOffset: {
                source: 15,
                target: 15,
            },
            clickAreaWidth: 24,
        })
        expect(compact).toMatchObject({
            lineCurve: 'bezier',
            scaling: {
                strokeWidth: 1.5,
                markerSize: 6,
                markerOffset: {
                    source: 0,
                    target: 0,
                },
                clickAreaWidth: 8,
            },
        })
        expect(compactWithMarkers.scaling).toMatchObject({
            markerSize: 6,
            markerOffset: {
                source: 6,
                target: 6,
            },
        })
    })
})
