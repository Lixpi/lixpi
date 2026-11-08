import { canvasThemeConnectorSettings } from '@lixpi/canvas-components/theme'
import {
    createArrowRightMarker,
    arrowRightMarkerBodyLengthFraction,
} from '@lixpi/ui-kit/svg'
import {
    CapabilityBoard,
    capabilityNode,
} from './capability-board.ts'
import { getExampleTheme } from './example-theme.ts'
import {
    type ExampleFrame,
} from './example-frame.ts'

export class ProximityExample {
    readonly board: CapabilityBoard
    readonly frame: ExampleFrame
    private enabled = true
    private threshold = 700
    private readonly settings

    constructor(host: HTMLElement) {
        this.settings = canvasThemeConnectorSettings(getExampleTheme(host).value)
        this.threshold = this.settings.proximityConnectThreshold
        this.board = new CapabilityBoard(
            host,
            {
                instructions: 'Drag Source until its right edge is near either target\'s left edge. A dashed ghost connection appears within the configured distance. Release to commit it, or press Escape to cancel. The disabled node is rejected by the proximity policy. Remove connections or reset the scene to try again.',
                scene: this.initialScene(),
                customDrag: true,
                connectors: {
                    settings: this.settings,
                    renderer: { marker: createArrowRightMarker() },
                    markerBodyLengthFraction: arrowRightMarkerBodyLengthFraction,
                    policy: {
                        canConnectProximity: (source, target) => this.enabled && source.nodeId === 'source' && target.nodeId.startsWith('target-'),
                        targetMarker: () => 'arrowhead',
                    },
                },
                onDrag: (nodeId, bounds) => {
                    this.board.connections?.checkProximity(
                        nodeId,
                        {
                            x: bounds.x,
                            y: bounds.y,
                        },
                        {
                            width: bounds.width,
                            height: bounds.height,
                        },
                    )
                    this.board.connections?.render()
                },
                onDrop: (_nodeId, moved) => {
                    if (moved)
                        this.board.connections?.commitProximityConnection()
                    else
                        this.board.connections?.cancelTransientConnection()

                    this.frame.report(`${this.board.scene.edges.length} committed connections. Drag Source toward an unconnected target.`)
                },
                onChange: intent => {
                    if (intent.kind === 'connect')
                        this.frame.report('Proximity connection committed through the host connect intent.')
                },
            },
        )
        this.frame = this.board.frame
        this.frame.toggle(
            'Enable proximity policy',
            this.enabled,
            value => {
                this.enabled = value
                this.board.connections?.cancelTransientConnection()
                this.frame.report(value ? 'Source can connect to Target A and Target B.' : 'The host policy rejects all proximity candidates.')
            },
        )
        const thresholdInput = this.frame.number(
            'Connection distance',
            {
                value: this.threshold,
            },
            value => {
                this.threshold = value
                getExampleTheme(this.frame.stage).update({ connectors: { proximityConnectThreshold: value } })
                this.board.connections?.cancelTransientConnection()
            },
        )
        const widthInput = this.frame.number(
            'Ghost and edge width',
            {
                value: this.settings.scaling.strokeWidth,
            },
            value => {
                getExampleTheme(this.frame.stage).update({ connectors: { scaling: { strokeWidth: value } } })
                this.board.connections?.render()
            },
        )
        this.frame.onThemeChange(() => {
            this.threshold = this.settings.proximityConnectThreshold
            thresholdInput.value = String(this.threshold)
            widthInput.value = String(this.settings.scaling.strokeWidth)

        })
        this.frame.button('Remove connections', () => {
            this.board.connections?.cancelTransientConnection()
            this.board.scene = {
                ...this.board.scene,
                edges: [],
            }
            this.board.publish()
            this.frame.report('Connections removed. Existing node positions are retained.')
        })
        this.frame.button('Reset scene', () => {
            this.board.connections?.cancelTransientConnection()
            this.board.scene = this.initialScene()
            this.board.publish()
            this.board.fit()
        })
        this.frame.code(
            () => [
                "import { CanvasController } from '@lixpi/canvas-engine/frontend/runtime'",
                "import { createCanvasConnectorSettings } from '@lixpi/canvas-components/connectors'",
                '',
                'const settings = createCanvasConnectorSettings()',
                `settings.proximityConnectThreshold = ${this.threshold}`,
                `settings.scaling.strokeWidth = ${this.settings.scaling.strokeWidth}`,
                '// Install connections once; retain the returned controls.',
                'const connections = canvas.installConnections({',
                '    settings,',
                '    policy: {',
                `        canConnectProximity: (source, target) => ${this.enabled} && source.nodeId === 'source' && target.nodeId.startsWith('target-'),`,
                '    },',
                '})',
                'canvas.startNodeDrag({',
                '    event, targets: [{ nodeId, bounds: originalBounds }],',
                '    onChange: bounds => {',
                '        const rect = bounds.get(nodeId)',
                '        connections.checkProximity(nodeId, rect, rect)',
                '        connections.render()',
                '    },',
                '    onEnd: (_event, bounds, moved) => {',
                '        // Persist positions and canvas.setScene before committing.',
                '        if (moved) {',
                '            const rect = bounds.get(nodeId)',
                '            connections.checkProximity(nodeId, rect, rect)',
                '            connections.commitProximityConnection()',
                '        }',
                '    },',
                '    onCancel: () => connections.cancelTransientConnection(),',
                '})',
                '// Apply the emitted connect intent to host state, then canvas.setScene(scene).',
                'canvas.destroy()',
            ].join('\n'),
        )
    }

    private initialScene() {
        return {
            sceneKey: 'library-proximity',
            revision: '0',
            nodes: [
                capabilityNode(
                    'source',
                    'Source',
                    30,
                    190,
                    210,
                    100,
                    {
                        lines: ['Drag my body toward a target'],
                        tag: 'movable source',
                    },
                ),
                capabilityNode(
                    'target-a',
                    'Target A',
                    1200,
                    30,
                    220,
                    110,
                    {
                        lines: ['Accepts proximity connection'],
                        tag: 'allowed',
                    },
                ),
                capabilityNode(
                    'target-b',
                    'Target B',
                    1200,
                    230,
                    220,
                    110,
                    {
                        lines: ['Accepts proximity connection'],
                        tag: 'allowed',
                    },
                ),
                capabilityNode(
                    'blocked',
                    'Disabled target',
                    1200,
                    430,
                    220,
                    110,
                    {
                        lines: ['Rejected by canConnectProximity'],
                        tag: 'blocked',
                    },
                ),
            ],
            edges: [],
        }
    }

    destroy(): void {
        this.board.destroy()
    }
}
