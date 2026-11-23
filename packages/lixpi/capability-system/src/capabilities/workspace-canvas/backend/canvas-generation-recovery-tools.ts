import {
    type CanvasCollaborationLease,
    type CanvasNode,
} from '@lixpi/constants'
import {
    type CapabilityAgentRegistration,
} from '../../../backend/capability-agent-registry.ts'
import {
    type CapabilityActionAuthorizationContext,
} from '../../../backend/capability-action-registry.ts'
import {
    type CanvasAgentAccess,
} from './canvas-agent-ports.ts'
import { WORKSPACE_CANVAS_OPERATION } from './canvas-agent-tools.ts'
import { withCanvasAgentLeases } from './canvas-agent-operations.ts'

export type CanvasResolveGenerationReference = {
    generationRequestId: string
    requestRevision: number
    bindingId: string
    assetId: string
}

export type CanvasRegenerateOutput = {
    nodeId: string
    mode: 'existing-prompt' | 'regenerate-prompt'
}

export const canvasRegenerationNodes = (
    nodes: CanvasNode[],
    nodeId: string,
) =>
    nodes.filter(
        node =>
            (node.type === 'image' || node.type === 'video')
            && (node.nodeId === nodeId || (node.generatedBy?.branchId && [
                node.generatedBy.branchOriginNodeId,
                node.generatedBy.branchForkNodeId,
                node.generatedBy.branchLineNodeId,
                node.generatedBy.lineageParentNodeId,
            ].includes(nodeId))),
    )

type CanvasGenerationRecoverySession = {
    resolve: (
        input: CanvasResolveGenerationReference,
        leases: CanvasCollaborationLease[],
    ) => Promise<object>
    regenerate: (
        input: CanvasRegenerateOutput,
        leases: CanvasCollaborationLease[],
    ) => Promise<object>
}

export type CanvasGenerationRecoveryAccess = (context: CapabilityActionAuthorizationContext) => Promise<CanvasGenerationRecoverySession>

const identifier = {
    type: 'string',
    pattern: '^[A-Za-z0-9_.:-]{1,192}$',
}

const report = async (operation: () => Promise<object>): Promise<object> => {
    try {
        const data = await operation()

        return 'status' in data
            && data.status === 'pending'
            ? data
            : {
                status: 'completed',
                data,
            }
    } catch (error) {
        const code = error instanceof Error ? error.message : ''

        if (!/^(CANVAS_LEASE_LOST|STALE_MEDIA_REQUEST_REVISION|(?:CANVAS_)?(?:REGENERATION|MEDIA_REQUEST|MEDIA_REFERENCE|PIPELINE)_[A-Z0-9_]+)$/u.test(code))
            throw error

        return {
            status: 'error',
            error: {
                code,
                message: 'Read the current canvas and generation status before retrying this action.',
                recoverable: true,
            },
        }
    }
}

export const createCanvasGenerationRecoveryTools = (
    access: CanvasAgentAccess,
    recovery: CanvasGenerationRecoveryAccess,
): CapabilityAgentRegistration[] => [{
    kind: 'tool',
    name: 'resolve_canvas_generation_reference',
    description: 'Bind an authorized workspace Asset to a missing reference of an existing canvas generation. Use the current request revision and binding ID from inspect_canvas_generation. When its last reference is resolved, the same generation request resumes.',
    intent: 'execute',
    operationFamilies: [WORKSPACE_CANVAS_OPERATION],
    schema: {
        type: 'object',
        additionalProperties: false,
        required: ['generationRequestId', 'requestRevision', 'bindingId', 'assetId'],
        properties: {
            generationRequestId: identifier,
            requestRevision: {
                type: 'integer',
                minimum: 1,
                maximum: Number.MAX_SAFE_INTEGER,
            },
            bindingId: identifier,
            assetId: identifier,
        },
    },
    execute: async (input, context) => {
        const request = input as CanvasResolveGenerationReference
        const session = await access(context)
        const operations = await recovery(context)
        const snapshot = await session.inspect()
        const targets = (snapshot.canvasState?.nodes ?? []).flatMap(
            node =>
                node.type === 'operationStatus'
                    && node.generationRequestId === request.generationRequestId
                    ? [`node:${node.nodeId}`]
                    : [],
        )

        return await report(
            async () => await withCanvasAgentLeases(
                session,
                targets,
                async leases => await operations.resolve(request, leases),
            ),
        )
    },
}, {
    kind: 'tool',
    name: 'regenerate_canvas_output',
    description: 'Regenerate an output or all variants under a branch marker. Existing-prompt mode replays the sealed generation prompt. Regenerate-prompt mode uses the source request’s original instruction to create a fresh prompt and branch.',
    intent: 'execute',
    operationFamilies: [WORKSPACE_CANVAS_OPERATION],
    schema: {
        type: 'object',
        additionalProperties: false,
        required: ['nodeId', 'mode'],
        properties: {
            nodeId: identifier,
            mode: {
                type: 'string',
                enum: ['existing-prompt', 'regenerate-prompt'],
            },
        },
    },
    execute: async (input, context) => {
        const request = input as CanvasRegenerateOutput
        const session = await access(context)
        const operations = await recovery(context)
        const { canvasState } = await session.inspect()
        const targets = canvasRegenerationNodes(canvasState?.nodes ?? [], request.nodeId).map(node => `node:${  node.nodeId}`)

        return await report(
            async () => await withCanvasAgentLeases(
                session,
                [`node:${  request.nodeId}`, ...targets],
                async leases => await operations.regenerate(request, leases),
            ),
        )
    },
}]
