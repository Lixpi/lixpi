// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type BranchOriginCanvasNode,
    type CanvasState,
} from '@lixpi/constants'
import {
    WorkspaceBranchMarkerPresentation,
    type WorkspaceBranchMarkerPresentationPorts,
} from './workspace-branch-marker-presentation.ts'

const fakes = vi.hoisted(() => ({
    contentOptions: [] as any[],
    actionOptions: [] as any[],
    zoomScales: [] as number[],
}))

vi.mock('@lixpi/canvas-components-lixpi-specific/frontend/nodes', async importOriginal => {
    const actual = await importOriginal<typeof import('@lixpi/canvas-components-lixpi-specific/frontend/nodes')>()
    return {
        ...actual,
        BranchMarkerContent: class {
            element = document.createElement('div')
            constructor(options: any) {
                this.element.className = 'workspace-branch-marker-content'
                fakes.contentOptions.push(options)
            }
            destroy() {}
        },
        BranchMarkerActions: class {
            stopControl = document.createElement('button')
            reviewControls = null
            constructor(options: any) {
                fakes.actionOptions.push(options)
            }
            setZoomScale(scale: number) {
                fakes.zoomScales.push(scale)
            }
            destroy() {}
        },
        BranchMediaModelCircleStyles: class {
            getGlassImage() {
                return ''
            }
            getTextureImage() {
                return ''
            }
            clear() {}
        },
    }
})

const marker: BranchOriginCanvasNode = {
    nodeId: 'marker-1',
    type: 'branchOrigin',
    branchId: 'branch-1',
    conversationAssetId: 'thread-1',
    generationRequestId: 'request-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 80 },
    temporary: true,
}

describe('WorkspaceBranchMarkerPresentation', () => {
    it('creates marker content and wires the info control to output details', () => {
        let infoClick = () => {}
        const own = vi.fn()
        const nodeElement = document.createElement('div')
        const dragOverlay = document.createElement('div')
        dragOverlay.className = 'branch-origin-drag-overlay'
        nodeElement.append(dragOverlay)
        const openDetails = vi.fn()
        const state = { nodes: [marker], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } satisfies CanvasState
        const owner = new WorkspaceBranchMarkerPresentation({
            document,
            shells: {
                createBranchMarker: (_node: BranchOriginCanvasNode, onInfoClick: () => void) => {
                    infoClick = onInfoClick
                    return { nodeEl: nodeElement, dragOverlay, own }
                },
            },
            modelCircleSettings: {},
            tooltipHideDelayMs: 0,
            models: {
                getReasoningModel: () => null,
                getTooltipEntries: () => [],
                getSummary: () => '',
            },
            getState: () => state,
            findElement: () => nodeElement,
            getUiPhase: () => undefined,
            hasStartedMedia: () => false,
            isPending: () => false,
            isGenerationGroupActive: () => false,
            getOutputs: () => [],
            isAccepted: () => false,
            isReviewReady: () => true,
            stop: vi.fn(async () => {}),
            accept: vi.fn(async () => {}),
            regenerate: vi.fn(async () => {}),
            getZoomScale: () => 0.75,
            getConversationPreview: () => null,
            getPromptParts: () => [{ type: 'text', text: 'draw it' }],
            getPromptPreviewRenderer: () => ({} as never),
            showResponseLine: () => false,
            createProgress: () => null,
            destroyProgress: vi.fn(),
            createReferenceResolution: () => null,
            openDetails,
            log: vi.fn(),
        } as WorkspaceBranchMarkerPresentationPorts)

        expect(owner.create(marker)).toBe(nodeElement)
        expect(fakes.contentOptions.at(-1)).toMatchObject({ label: 'Start branch', headerHeight: 80 })
        expect(fakes.zoomScales.at(-1)).toBe(0.75)
        expect(own).toHaveBeenCalledOnce()

        infoClick()
        expect(openDetails).toHaveBeenCalledWith(marker.nodeId)
        owner.destroy()
    })
})
