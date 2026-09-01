import {
    type ConnectionSettings,
} from '@lixpi/canvas-engine/frontend/connectors'

export function createWorkspaceConnectorSettings(colors: { lineDefaultColor: string }): ConnectionSettings {
    return {
        // Default curve used for connector lines between nodes.
        lineCurve: 'horizontal-bezier',
        // Keep connector stroke, marker, and hit-area sizes usable as the canvas zoom changes.
        useZoomCompensatedScaling: true,
        // Connector screen-space base sizes and zoom breakpoint.
        scaling: {
            // Base screen-pixel connector stroke width at 100% and higher zoom.
            strokeWidth: 3,
            // Base screen-pixel arrowhead size at 100% and higher zoom.
            markerSize: 23,
            // Base screen-pixel gap between a connector endpoint and the node it
            // attaches to, at 100% and higher zoom. This is the pure node↔line gap
            // and is identical for both ends; it carries NO arrowhead knowledge —
            // WorkspaceConnectionManager adds the arrowhead's own length only on
            // ends that actually draw an arrow.
            markerOffset: { source: 15, target: 15 },
            // Screen-pixel width of the invisible selection hit area around connector lines.
            clickAreaWidth: 24,
            // Lower zoom breakpoint for connector chrome. Runtime call sites opt
            // this config into the shared adaptive low-zoom curve, which defaults
            // to 0.45 unless this object provides `lowZoomPower`.
            zoomScaling: { minZoom: 0.4 },
        },
        // Renderer-coordinate distance at which dragging a node near a thread shows a proximity connection.
        proximityConnectThreshold: 700,
        // Renderer-coordinate distance at which menu-driven connection placement snaps to a target.
        menuConnectionSnapRadius: 110,
        // Vertical auto-alignment of a connector's anchor along the target node's left edge.
        autoAlign: {
            // Minimum target-node height in pixels before the anchor can slide away from the vertical center.
            minSlideHeight: 120,
            // Fractional top/bottom margin where the sliding anchor stops, snapping to the nearest corner.
            edgeMargin: 0.065,
        },
        styles: {
            // Default color for connector lines between nodes.
            lineDefaultColor: colors.lineDefaultColor,
            // Focus and selection color for connector lines.
            lineFocusColor: '#000',
        },
    }
}
