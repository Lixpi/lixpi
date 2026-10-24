// Lixpi workspace nodes outside a renderer: operation status cards, branch
// markers with their reasoning and media-model circles, and marker actions.

import {
    type BranchLineCanvasNode,
    type OperationStatusCanvasNode,
} from '@lixpi/constants'
import { BranchMarkerPromptParts } from '@lixpi/canvas-components-lixpi-specific/frontend/nodes'
import {
    createCanvasPromptReferenceRenderer,
    createPromptReferenceChipElement,
} from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import { applyWorkspaceCanvasTheme } from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import {
    bytedanceIcon,
    claudeIcon,
    geminiIcon,
    gptAvatarIcon,
    stabilityIcon,
} from '@lixpi/ui-kit/svg'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    DemoWorkspaceNodes,
    type DemoBranchMarkerState,
} from '$src/fixtures/demoWorkspaceNodes.ts'
import { createWorkspaceAppearance } from '$src/fixtures/workspaceAppearance.ts'
import {
    ShowcasePage,
    createShowcaseRow,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/canvas/canvas-pages.scss'

const STAGE_PADDING = 16

const operation = (overrides: Partial<OperationStatusCanvasNode>): OperationStatusCanvasNode => ({
    createdAt: 1,
    dimensions: {
        height: 104,
        width: 340,
    },
    message: 'Creating a supported copy before adding it to the canvas.',
    nodeId: crypto.randomUUID(),
    operation: 'upload',
    position: {
        x: STAGE_PADDING,
        y: STAGE_PADDING,
    },
    status: 'in-progress',
    title: 'storyboard.mov',
    type: 'operationStatus',
    updatedAt: 1,
    ...overrides,
})

const OPERATIONS: Array<[string, Partial<OperationStatusCanvasNode>]> = [
    ['Upload converting', {}],
    ['Upload failed', {
        message: 'The file could not be converted to a supported format.',
        status: 'failed',
    }],
    ['Generation failed', {
        generationRequestId: 'request',
        message: 'The provider rejected the prompt.',
        operation: 'media-generation',
        status: 'failed',
        title: 'Hero frame',
    }],
    ['Action required', {
        generationRequestId: 'request',
        message: 'The provider needs you to verify the person in this reference.',
        operation: 'media-generation',
        requestRevision: 2,
        status: 'action-required',
        title: 'Character turnaround',
    }],
]

const MODELS = {
    claude: {
        icon: claudeIcon,
        title: 'Claude',
    },
    gemini: {
        color: '#4285F4',
        icon: geminiIcon,
        label: 'Image',
        title: 'Nano Banana Pro',
    },
    gpt: {
        color: '#5bbf97',
        icon: gptAvatarIcon,
        label: 'Image',
        title: 'GPT Image 1',
    },
    seedance: {
        color: '#325AB4',
        icon: bytedanceIcon,
        label: 'Video',
        title: 'Seedance 2.0',
    },
    stability: {
        color: '#8E44AD',
        icon: stabilityIcon,
        label: 'Image',
        title: 'Stable Image Ultra',
    },
}

const PROMPT: DemoBranchMarkerState['promptParts'] = [
    {
        text: 'Turn ',
        type: 'text',
    },
    {
        reference: {
            assetId: 'image-dawn',
            displayName: 'Dawn study',
            mediaKind: 'image',
            referenceType: 'media',
        },
        type: 'media',
    },
    {
        text: ' into a key frame using ',
        type: 'text',
    },
    {
        reference: {
            capabilityId: 'pose-sheet',
            displayName: 'Pose sheet',
            referenceType: 'skill',
        },
        type: 'skill',
    },
    {
        text: ' and ',
        type: 'text',
    },
    {
        reference: {
            displayName: 'Character creator',
            moduleId: 'character-creator',
            referenceType: 'capability-module',
        },
        type: 'capability-module',
    },
]

const MARKERS: Array<[string, DemoBranchMarkerState]> = [
    ['Pending, reasoning is streaming', {
        active: true,
        canAcceptAll: false,
        hasReviewOutputs: false,
        mediaModels: [MODELS.gemini],
        pending: true,
        promptParts: PROMPT,
        reasoningModel: MODELS.claude,
        receiving: true,
        responsePhase: 'preamble',
        responseText: 'Planning three framings from the reference…',
        showResponseLine: true,
    }],
    ['Generating with several media models', {
        active: true,
        canAcceptAll: false,
        hasReviewOutputs: false,
        mediaModels: [MODELS.gemini, MODELS.gpt, MODELS.stability],
        pending: false,
        promptParts: PROMPT,
        reasoningModel: MODELS.claude,
        receiving: false,
        responsePhase: 'final',
        responseText: 'Generating three image variants.',
        showResponseLine: true,
    }],
    ['Finished, outputs waiting for review', {
        active: false,
        canAcceptAll: true,
        hasReviewOutputs: true,
        mediaModels: [MODELS.seedance],
        pending: false,
        promptParts: [{
            text: 'A slow push-in on the hero frame at dusk',
            type: 'text',
        }],
        reasoningModel: null,
        receiving: false,
        responsePhase: 'final',
        responseText: '',
        showResponseLine: false,
    }],
    ['Finished, some outputs not ready to accept', {
        active: false,
        canAcceptAll: false,
        hasReviewOutputs: true,
        mediaModels: [MODELS.gemini, MODELS.gpt],
        pending: false,
        promptParts: PROMPT,
        reasoningModel: MODELS.claude,
        receiving: false,
        responsePhase: 'final',
        responseText: 'Two variants are ready; one is still assessing.',
        showResponseLine: true,
    }],
]

const branchNode = (nodeId: string): BranchLineCanvasNode => ({
    branchId: nodeId,
    dimensions: {
        height: 42,
        width: 340,
    },
    generationRequestId: `${nodeId}-request`,
    nodeId,
    position: {
        x: STAGE_PADDING,
        y: STAGE_PADDING,
    },
    temporary: true,
    type: 'branchLine',
})

const createNodeStage = (height: number): HTMLElement => {
    const stage = html`<div className="design-system-node-stage"></div>` as HTMLElement
    stage.style.height = `${height + STAGE_PADDING * 2}px`

    return stage
}

export const createWorkspaceNodesPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/canvas-components-lixpi-specific/frontend/nodes',
        title: 'Nodes and markers',
        description: 'Node content mounted through WorkspaceNodeShells, which the renderer otherwise positions on the canvas. The theme variables come from applyWorkspaceCanvasTheme, as in the workspace.',
    })
    const appearance = createWorkspaceAppearance()
    const nodes = page.own(
        new DemoWorkspaceNodes({ appearance }),
    )
    const themed = (element: HTMLElement): HTMLElement => {
        applyWorkspaceCanvasTheme(element, appearance)

        return element
    }

    page.addSection({
        title: 'Operation status',
        description: 'Upload conversion and generation problems. Actions report through the action ports; the host performs the transport.',
        columns: 2,
        content: OPERATIONS.map(([label, overrides]) => {
            const node = operation(overrides)
            const stage = themed(
                createNodeStage(node.dimensions.height),
            )
            stage.append(
                nodes.createOperationStatus(node),
            )

            return createShowcaseSpecimen({
                content: stage,
                label,
            })
        }),
    })

    page.addSection({
        title: 'Branch markers',
        description: 'The marker shows the submitted prompt with its reference atoms, the reasoning line, media-model glass circles and the stop or review actions.',
        columns: 2,
        content: MARKERS.map(([label, state], index) => {
            const stage = themed(
                createNodeStage(140),
            )
            stage.append(
                nodes.createBranchMarker(
                    branchNode(`marker-${index}`),
                    state,
                ),
            )

            return createShowcaseSpecimen({
                content: stage,
                label,
            })
        }),
    })

    const parts = page.own(
        new BranchMarkerPromptParts(
            PROMPT,
            createCanvasPromptReferenceRenderer({ document }),
        ),
    )
    const chips = (['media', 'tool', 'skill', 'capability-module'] as const).map(
        referenceType => createPromptReferenceChipElement(
            {
                displayName: referenceType === 'capability-module' ? 'Character creator' : `A ${referenceType}`,
                mediaKind: referenceType === 'media' ? 'image' : undefined,
                referenceType,
            },
            document,
        ),
    )
    page.addSection({
        title: 'Prompt parts and reference chips',
        description: 'BranchMarkerPromptParts renders text and reference atoms in their submitted order. Without a preview renderer each reference becomes a plain chip.',
        content: [
            createShowcaseSpecimen({
                content: themed(html`<p className="design-system-prompt-parts">${parts.items}</p>`),
                label: 'BranchMarkerPromptParts',
            }),
            createShowcaseSpecimen({
                content: themed(
                    createShowcaseRow(chips),
                ),
                label: 'createPromptReferenceChipElement for each reference type',
            }),
        ],
    })

    return page
}
