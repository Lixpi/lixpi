import {
    type CanvasNode,
    type CanvasState,
    type DocumentMediaCanvasNode,
    type WorkspaceEdge,
    type OperationStatusCanvasNode,
} from '@lixpi/constants'
import {
    fixtureTime,
    uploadedDocumentFixtures,
    type WorkspaceFixtures,
} from './fixtures.ts'

export const createOperationFixture = (
    status: OperationStatusCanvasNode['status'],
    operation: OperationStatusCanvasNode['operation'] = 'media-generation',
): OperationStatusCanvasNode => ({
    nodeId: `operation-${operation}-${status}`,
    type: 'operationStatus',
    operation,
    status,
    title: operation === 'upload' ? 'Uploaded document' : 'Local generation fixture',
    message: status === 'failed'
        ? 'The simulated operation failed. Its request can be edited or dismissed.'
        : status === 'action-required'
            ? 'Choose a reference or verify the request to continue.'
            : 'This fixture is waiting for the next local state.',
    generationRequestId: operation === 'media-generation' ? 'fixture-operation-request' : undefined,
    requestRevision: operation === 'media-generation' ? 1 : undefined,
    generationRun: operation === 'media-generation' ? 0 : undefined,
    verificationAssetId: status === 'action-required' ? 'fixture-image' : undefined,
    position: {
        x: 60,
        y: 50,
    },
    dimensions: {
        width: 340,
        height: 180,
    },
    createdAt: fixtureTime,
    updatedAt: fixtureTime,
})

const createBranchConversations = (fixtures: WorkspaceFixtures): void => {
    for (const [role, title, prompt, response] of [
        ['origin', 'Original branch', 'Start a branch from the canvas study.', 'The original scene establishes this branch.'],
        ['continuation', 'Continue original branch', 'Continue this branch with the next scene.', 'The next scene keeps the original branch.'],
        ['fork', 'Alternative branch', 'Fork the original branch into an alternative scene.', 'The alternative starts a separate branch.'],
    ] as const) {
        const assetId = `fixture-conversation-${role}`

        if (fixtures.getAsset(assetId))
            continue

        const generationRequestId = `fixture-generation-${role}`
        fixtures.addAsset(
            assetId,
            title,
            'conversation',
            {
                type: 'doc',
                content: [{
                    type: 'aiChatThread',
                    attrs: { threadId: assetId },
                    content: [
                        {
                            type: 'aiUserMessage',
                            attrs: {
                                id: `${assetId}-user`,
                                createdAt: fixtureTime,
                            },
                            content: [{
                                type: 'paragraph',
                                content: [{
                                    type: 'text',
                                    text: prompt,
                                }],
                            }],
                        },
                        {
                            type: 'aiResponseMessage',
                            attrs: {
                                id: `${assetId}-assistant`,
                                generationRequestId,
                            },
                            content: [{
                                type: 'paragraph',
                                content: [{
                                    type: 'text',
                                    text: response,
                                }],
                            }],
                        },
                    ],
                }],
            },
        )
        fixtures.createConversation(assetId, title)
    }
}

// Uploads land on a letter-shaped frame, like the canvas upload action
// (width / 0.7727). The poster is fitted inside it without cropping.
export const createUploadedDocumentNodes = (): DocumentMediaCanvasNode[] => uploadedDocumentFixtures.map(
    (upload, index) => ({
        nodeId: index === 0 ? 'node-media-document' : `node-${upload.assetId.replace('fixture-', '')}`,
        type: 'mediaDocument',
        assetId: upload.assetId,
        position: {
            x: 60 + index * 300,
            y: 80,
        },
        dimensions: {
            width: 240,
            height: Math.round(240 / 0.7727),
        },
    }),
)

export const createCanvasFixture = (fixtures: WorkspaceFixtures): CanvasState => {
    createBranchConversations(fixtures)
    const nodes: CanvasNode[] = [
        {
            nodeId: 'node-document',
            type: 'document',
            assetId: 'fixture-document',
            position: {
                x: 60,
                y: 80,
            },
            dimensions: {
                width: 390,
                height: 270,
            },
        },
        {
            nodeId: 'node-image',
            type: 'image',
            assetId: 'fixture-image',
            position: {
                x: 550,
                y: 100,
            },
            dimensions: {
                width: 300,
                height: 200,
            },
        },
        {
            nodeId: 'node-video',
            type: 'video',
            assetId: 'fixture-video',
            position: {
                x: 950,
                y: 100,
            },
            dimensions: {
                width: 300,
                height: 200,
            },
        },
        {
            nodeId: 'node-audio',
            type: 'audio',
            assetId: 'fixture-audio',
            position: {
                x: 1360,
                y: 100,
            },
            dimensions: {
                width: 300,
                height: 100,
            },
        },
        {
            ...createUploadedDocumentNodes()[0],
            position: {
                x: 1760,
                y: 100,
            },
        },
        {
            nodeId: 'node-origin',
            type: 'branchOrigin',
            branchId: 'fixture-branch-original',
            generationRequestId: 'fixture-generation-origin',
            conversationAssetId: 'fixture-conversation-origin',
            temporary: true,
            position: {
                x: 60,
                y: 530,
            },
            dimensions: {
                width: 390,
                height: 140,
            },
        },
        {
            nodeId: 'node-fork',
            type: 'branchFork',
            branchId: 'fixture-branch-alternative',
            generationRequestId: 'fixture-generation-fork',
            conversationAssetId: 'fixture-conversation-fork',
            parentBranchNodeId: 'node-origin',
            temporary: true,
            position: {
                x: 680,
                y: 700,
            },
            dimensions: {
                width: 390,
                height: 140,
            },
        },
        {
            nodeId: 'node-line',
            type: 'branchLine',
            branchId: 'fixture-branch-original',
            generationRequestId: 'fixture-generation-continuation',
            conversationAssetId: 'fixture-conversation-continuation',
            parentBranchNodeId: 'node-origin',
            temporary: true,
            position: {
                x: 680,
                y: 450,
            },
            dimensions: {
                width: 390,
                height: 140,
            },
        },
        {
            ...createOperationFixture('in-progress', 'upload'),
            position: {
                x: 1610,
                y: 530,
            },
        },
    ]

    for (const [index, [assetId]] of [...fixtures.artifacts.documents].entries()) {
        const asset = fixtures.requireAsset(assetId)
        const definition = fixtures.artifacts.frontend.require(asset.artifact!.artifactTypeId)
        nodes.push({
            nodeId: `node-${assetId}`,
            type: 'capabilityArtifact',
            assetId,
            artifactTypeId: asset.artifact!.artifactTypeId,
            position: {
                x: 60 + index * 600,
                y: 870,
            },
            dimensions: { ...definition.initialCanvasDimensions },
        })
    }

    const lineageEdges: WorkspaceEdge[] = nodes.flatMap((node): WorkspaceEdge[] => {
        if (
            (node.type !== 'branchFork' && node.type !== 'branchLine')
            || !node.parentBranchNodeId
        )
            return []

        // Match WorkspaceLineageProjection.createBranchMarkerEdge's persisted topology.
        return [{
            edgeId: `edge-${node.parentBranchNodeId}-${node.nodeId}`,
            sourceNodeId: node.parentBranchNodeId,
            targetNodeId: node.nodeId,
            sourceHandle: 'right',
            targetHandle: 'left',
        }]
    })

    return {
        nodes,
        edges: [
            ...lineageEdges,
            {
                edgeId: 'document-image',
                sourceNodeId: 'node-document',
                targetNodeId: 'node-image',
            },
            {
                edgeId: 'image-video',
                sourceNodeId: 'node-image',
                targetNodeId: 'node-video',
            },
        ],
        viewport: {
            x: 30,
            y: 40,
            zoom: 0.42,
        },
        lastActiveConversationAssetId: 'fixture-conversation',
        aiChatPanel: {
            isOpen: false,
            topLevelMode: 'media',
            contextChips: [],
        },
    }
}
