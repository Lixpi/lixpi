import {
    type CanvasTransform,
    type PanOnScrollMode,
} from '../../shared/viewport/coordinates.ts'

export const defaultPanZoomConfig = (onTransformChange: (transform: CanvasTransform) => void) => ({
    noWheelClassName: 'nowheel',
    noPanClassName: 'nopan',
    preventScrolling: true,
    panOnScroll: true,
    panOnDrag: true,
    panOnScrollMode: 'free' as PanOnScrollMode,
    panOnScrollSpeed: 1,
    zoomOnPinch: true,
    zoomOnScroll: false,
    zoomOnDoubleClick: true,
    zoomActivationKeyPressed: false,
    userSelectionActive: false,
    connectionInProgress: false,
    paneClickDistance: 0,
    selectionOnDrag: false,
    // Accepted for callers compiled against the existing configuration shape.
    lib: 'xy',
    onTransformChange,
})

export type CanvasPanZoomConfig = ReturnType<typeof defaultPanZoomConfig>
