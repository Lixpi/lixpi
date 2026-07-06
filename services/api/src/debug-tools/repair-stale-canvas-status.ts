'use strict'

import process from 'node:process'

import DynamoDBService from '@lixpi/dynamodb-service'
import {
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
    type BranchOriginCanvasNode,
    type CanvasNode,
    type CanvasState,
} from '@lixpi/constants'

type RepairArgs = {
    workspaceId: string
    generationRequestId?: string
    apply: boolean
}

type BranchMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode

type MarkerSummary = {
    nodeId: string
    type: BranchMarkerNode['type']
    generationRequestId: string
    aiChatThreadId?: string
    branchId?: string
    reasoningRunId?: string
    reasoningModelId?: string
    reasoningIndex?: number
    pendingPhase?: string
    promptText?: string
}

const DEFAULT_WORKSPACE_ID = 'f079ab6d-90aa-42c4-bd6f-4c447aa55ff9'

type WorkspaceModel = Awaited<typeof import('../models/workspace.ts')>['default']

function requireEnv(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required env var ${name}`)
    return value
}

function createDynamoDbService(): DynamoDBService {
    const endpoint = process.env.DYNAMODB_ENDPOINT
    return new DynamoDBService({
        region: requireEnv('AWS_REGION'),
        ssoProfile: process.env.AWS_PROFILE ?? '',
        ...(endpoint ? { endpoint } : {}),
    })
}

async function loadWorkspaceModel(): Promise<WorkspaceModel> {
    const globalScope = globalThis as Record<string, unknown>
    globalScope.dynamoDBService = createDynamoDbService()
    const workspaceModule = await import('../models/workspace.ts')
    return workspaceModule.default
}

function readFlag(name: string, aliases: string[], fallback?: string): string | undefined {
    const flags = [name, ...aliases]
    for (const flag of flags) {
        const equalsArg = process.argv.find(arg => arg.startsWith(`${flag}=`))
        if (equalsArg) return equalsArg.slice(flag.length + 1)
        const index = process.argv.indexOf(flag)
        if (index >= 0) return process.argv[index + 1]
    }
    return fallback
}

function parseArgs(): RepairArgs {
    const workspaceId = readFlag('--workspace', ['--workspaceId'], DEFAULT_WORKSPACE_ID)
    if (!workspaceId) {
        throw new Error([
            'Usage:',
            'node src/debug-tools/repair-stale-canvas-status.ts [--workspace <workspaceId>] [--generation <generationRequestId>] [--apply]',
            '',
            'Default is dry-run. Pass --apply to write the repaired canvas state.',
        ].join('\n'))
    }

    return {
        workspaceId,
        generationRequestId: readFlag('--generation', ['--generationRequestId']),
        apply: process.argv.includes('--apply'),
    }
}

function isBranchMarkerNode(node: CanvasNode): node is BranchMarkerNode {
    return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
}

function getMarkerReasoningRunId(node: BranchMarkerNode): string | undefined {
    return node.type === 'branchFork' || node.type === 'branchLine' ? node.reasoningRunId : undefined
}

function getMarkerReasoningModelId(node: BranchMarkerNode): string | undefined {
    return node.type === 'branchFork' || node.type === 'branchLine'
        ? node.reasoningModelId
        : node.pendingState?.reasoningModelId
}

function getMarkerReasoningIndex(node: BranchMarkerNode): number | undefined {
    return node.type === 'branchFork' || node.type === 'branchLine'
        ? node.reasoningIndex
        : node.pendingState?.reasoningIndex
}

function matchesGenerationRequest(node: BranchMarkerNode, generationRequestId?: string): boolean {
    return !generationRequestId || node.generationRequestId === generationRequestId
}

function findPendingMarkers(canvasState: CanvasState, generationRequestId?: string): BranchMarkerNode[] {
    return canvasState.nodes.filter((node): node is BranchMarkerNode =>
        isBranchMarkerNode(node)
        && Boolean(node.pendingState)
        && matchesGenerationRequest(node, generationRequestId)
    )
}

function summarizeMarker(node: BranchMarkerNode): MarkerSummary {
    return {
        nodeId: node.nodeId,
        type: node.type,
        generationRequestId: node.generationRequestId,
        aiChatThreadId: node.aiChatThreadId,
        branchId: node.branchId,
        reasoningRunId: getMarkerReasoningRunId(node),
        reasoningModelId: getMarkerReasoningModelId(node),
        reasoningIndex: getMarkerReasoningIndex(node),
        pendingPhase: node.pendingState?.phase,
        promptText: node.pendingState?.promptText,
    }
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const item of items) {
        const key = keyFn(item)
        counts[key] = (counts[key] ?? 0) + 1
    }
    return counts
}

function summarizeCanvas(canvasState: CanvasState, generationRequestId?: string): Record<string, unknown> {
    const markerNodes = canvasState.nodes.filter(isBranchMarkerNode)
    const pendingMarkers = findPendingMarkers(canvasState, generationRequestId)
    const allPendingMarkers = findPendingMarkers(canvasState)
    return {
        totalNodes: canvasState.nodes.length,
        totalEdges: canvasState.edges.length,
        totalBranchMarkers: markerNodes.length,
        totalPendingBranchMarkers: allPendingMarkers.length,
        targetedPendingBranchMarkers: pendingMarkers.length,
        pendingBranchMarkersByGenerationRequestId: countBy(allPendingMarkers, marker => marker.generationRequestId || '(missing)'),
        pendingBranchMarkersByPhase: countBy(allPendingMarkers, marker => marker.pendingState?.phase ?? '(missing)'),
        targetedMarkers: pendingMarkers.map(summarizeMarker),
    }
}

function removePendingStateFromMarkers(canvasState: CanvasState, generationRequestId?: string): {
    canvasState: CanvasState
    changed: boolean
    removedMarkers: MarkerSummary[]
} {
    let changed = false
    const removedMarkers: MarkerSummary[] = []
    const nodes = canvasState.nodes.map((node): CanvasNode => {
        if (!isBranchMarkerNode(node) || !node.pendingState || !matchesGenerationRequest(node, generationRequestId)) {
            return node
        }

        removedMarkers.push(summarizeMarker(node))
        const settledNode = { ...node }
        delete settledNode.pendingState
        changed = true
        return settledNode
    })

    return {
        canvasState: changed ? { ...canvasState, nodes } : canvasState,
        changed,
        removedMarkers,
    }
}

async function main(): Promise<void> {
    const args = parseArgs()
    const Workspace = await loadWorkspaceModel()
    const workspace = await Workspace.getWorkspaceInternal({ workspaceId: args.workspaceId })
    if (!workspace) throw new Error(`Workspace not found: ${args.workspaceId}`)

    const canvasState = {
        viewport: workspace.canvasState?.viewport ?? { x: 0, y: 0, zoom: 1 },
        nodes: workspace.canvasState?.nodes ?? [],
        edges: workspace.canvasState?.edges ?? [],
    } as CanvasState
    const beforeSummary = summarizeCanvas(canvasState, args.generationRequestId)
    const dryRunRepair = removePendingStateFromMarkers(canvasState, args.generationRequestId)

    if (!args.apply) {
        console.log(JSON.stringify({
            mode: 'dry-run',
            workspaceId: args.workspaceId,
            generationRequestId: args.generationRequestId,
            wouldChange: dryRunRepair.changed,
            wouldRemovePendingStateCount: dryRunRepair.removedMarkers.length,
            removedMarkers: dryRunRepair.removedMarkers,
            before: beforeSummary,
        }, null, 2))
        return
    }

    const applied = await Workspace.mutateCanvasState({
        workspaceId: args.workspaceId,
        origin: 'repairStaleCanvasStatusDebugTool',
        mutate: currentCanvasState => removePendingStateFromMarkers(currentCanvasState, args.generationRequestId),
    })
    const repairedWorkspace = await Workspace.getWorkspaceInternal({ workspaceId: args.workspaceId })
    const repairedCanvasState = {
        viewport: repairedWorkspace?.canvasState?.viewport ?? { x: 0, y: 0, zoom: 1 },
        nodes: repairedWorkspace?.canvasState?.nodes ?? [],
        edges: repairedWorkspace?.canvasState?.edges ?? [],
    } as CanvasState

    console.log(JSON.stringify({
        mode: 'apply',
        workspaceId: args.workspaceId,
        generationRequestId: args.generationRequestId,
        applied,
        removedPendingStateCount: dryRunRepair.removedMarkers.length,
        removedMarkers: dryRunRepair.removedMarkers,
        before: beforeSummary,
        after: summarizeCanvas(repairedCanvasState, args.generationRequestId),
    }, null, 2))
}

try {
    await main()
} catch (error) {
    console.error(error)
    process.exitCode = 1
}
