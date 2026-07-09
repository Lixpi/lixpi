'use strict'

import { describe, it, expect } from 'vitest'
import type { CanvasNode, ImageCanvasNode, VideoCanvasNode, WorkspaceEdge } from '@lixpi/constants'
import {
    buildBranchTrees,
    applyBranchTreeLayout,
    rebalanceBranchTreesAndResolve,
} from '$src/infographics/workspace/branchTreeLayout.ts'

// =============================================================================
// BRANCH-LINEAGE TREE LAYOUT
// =============================================================================

const SIZE = 800
const OPTS = { depthGap: 192, siblingGap: 160 }
const FANOUT_OPTS = { ...OPTS, branchFanoutExtraGap: 96 }

type GenOpts = {
    branchId?: string
    parentMediaNodeId?: string
    createdAt?: number
    type?: 'image' | 'video'
    width?: number
    height?: number
}

// Generated-media node factory (image by default; video when requested).
const genMedia = (id: string, x: number, y: number, opts: GenOpts = {}): CanvasNode => {
    const width = opts.width ?? SIZE
    const height = opts.height ?? SIZE
    const generatedBy = {
        aiChatThreadId: 'thread-1',
        responseId: '',
        revisedPrompt: '',
        branchId: opts.branchId ?? 'branch-A',
        parentMediaNodeId: opts.parentMediaNodeId,
        createdAt: opts.createdAt ?? 0,
    }
    if (opts.type === 'video') {
        return {
            nodeId: id, type: 'video', fileId: id, posterFileId: '', workspaceId: 'w',
            src: '', posterSrc: '', aspectRatio: 1, durationSeconds: 4, hasAudio: false,
            position: { x, y }, dimensions: { width, height },
            generatedBy: { ...generatedBy, videoModel: '' as any },
        } as VideoCanvasNode
    }
    return {
        nodeId: id, type: 'image', fileId: id, workspaceId: 'w', src: '', aspectRatio: 1,
        position: { x, y }, dimensions: { width, height },
        generatedBy: { ...generatedBy, aiModel: '' as any },
    } as ImageCanvasNode
}

// Loose (uploaded) image — no generatedBy, so never a tree member.
const loose = (id: string, x: number, y: number): CanvasNode => ({
    nodeId: id, type: 'image', fileId: id, workspaceId: 'w', src: '', aspectRatio: 1,
    position: { x, y }, dimensions: { width: SIZE, height: SIZE },
} as ImageCanvasNode)

const edge = (source: string, target: string): WorkspaceEdge => ({
    edgeId: `edge-${source}-${target}`, sourceNodeId: source, targetNodeId: target,
})

const posOf = (nodes: CanvasNode[], id: string) => nodes.find(n => n.nodeId === id)!.position
const overlaps = (a: CanvasNode, b: CanvasNode): boolean =>
    a.position.x < b.position.x + b.dimensions.width &&
    a.position.x + a.dimensions.width > b.position.x &&
    a.position.y < b.position.y + b.dimensions.height &&
    a.position.y + a.dimensions.height > b.position.y

describe('buildBranchTrees', () => {
    it('returns no trees when there is no generated media', () => {
        expect(buildBranchTrees([loose('u1', 0, 0)], [])).toEqual([])
    })

    it('builds children from parentMediaNodeId (mixed image + video)', () => {
        const nodes = [
            genMedia('R', 0, 0, { createdAt: 1 }),
            genMedia('A', 0, 0, { parentMediaNodeId: 'R', createdAt: 2 }),
            genMedia('B', 0, 0, { parentMediaNodeId: 'R', createdAt: 3, type: 'video' }),
        ]
        const trees = buildBranchTrees(nodes, [])
        expect(trees).toHaveLength(1)
        expect(trees[0].rootId).toBe('R')
        expect(new Set(trees[0].memberIds)).toEqual(new Set(['R', 'A', 'B']))
        expect(trees[0].childrenByParentId.get('R')).toEqual(['A', 'B'])
    })

    it('does not infer generation trees from workspace lineage edges', () => {
        const nodes = [genMedia('R', 0, 0), genMedia('A', 0, 0)]
        const trees = buildBranchTrees(nodes, [edge('R', 'A')])
        expect(trees).toHaveLength(2)
        expect(new Set(trees.map((tree) => tree.rootId))).toEqual(new Set(['R', 'A']))
        expect(trees.every((tree) => tree.childrenByParentId.size === 0)).toBe(true)
    })

    it('keeps separate roots as separate trees and excludes loose/parented nodes', () => {
        const nodes: CanvasNode[] = [
            genMedia('R1', 0, 0, { branchId: 'b1' }),
            genMedia('R2', 0, 0, { branchId: 'b2' }),
            loose('u1', 0, 0),
            { ...genMedia('child', 0, 0, { branchId: 'b3' }), parentId: 'container' } as CanvasNode,
        ]
        const trees = buildBranchTrees(nodes, [])
        expect(trees.map(t => t.rootId).sort()).toEqual(['R1', 'R2'])
    })

    it('orders forked siblings deterministically by createdAt', () => {
        const nodes = [
            genMedia('R', 0, 0, { createdAt: 1 }),
            genMedia('late', 0, 0, { parentMediaNodeId: 'R', createdAt: 30 }),
            genMedia('early', 0, 0, { parentMediaNodeId: 'R', createdAt: 10 }),
        ]
        const trees = buildBranchTrees(nodes, [])
        expect(trees[0].childrenByParentId.get('R')).toEqual(['early', 'late'])
    })

    it('orders children by variantIndex before createdAt when available', () => {
        const nodes = [
            genMedia('R', 0, 0, { createdAt: 1, branchId: 'v' }),
            genMedia('v2', 0, 0, { parentMediaNodeId: 'R', createdAt: 30, branchId: 'v' }),
            genMedia('v1', 0, 0, { parentMediaNodeId: 'R', createdAt: 20, branchId: 'v' }),
        ]
        nodes[1].generatedBy.variantIndex = 2
        nodes[2].generatedBy.variantIndex = 1

        const trees = buildBranchTrees(nodes, [])
        expect(trees[0].childrenByParentId.get('R')).toEqual(['v1', 'v2'])
    })

    it('resolves branch members to branchOrigin before connector edges', () => {
        const nodes = [
            {
                nodeId: 'branch-origin',
                type: 'branchOrigin',
                workspaceId: 'w',
                dimensions: { width: SIZE, height: SIZE },
                position: { x: 10, y: 20 },
                fileId: 'branch-origin',
                branchId: 'branch-1',
                src: '',
            },
            genMedia('parent', 40, 50, { branchId: 'branch-1' }),
            genMedia('child', 60, 70, {
                branchId: 'branch-1',
                createdAt: 2,
                parentMediaNodeId: undefined,
            }),
        ] as any
        nodes[2].generatedBy.branchOriginNodeId = 'branch-origin'
        const nodesWithEdge = [...nodes]
        nodesWithEdge.push(edge('orphan', 'child'))

        const trees = buildBranchTrees(nodesWithEdge, [edge('parent', 'branch-origin')])
        expect(trees).toHaveLength(2)
        expect(new Set(trees.map((tree) => tree.rootId))).toEqual(new Set(['parent', 'branch-origin']))
        const branchOriginTree = trees.find((tree) => tree.rootId === 'branch-origin')
        expect(branchOriginTree).toBeDefined()
        expect(branchOriginTree?.childrenByParentId.get('branch-origin')).toEqual(['child'])
    })

    it('prefers branchFork over branchLine when both lineage markers are declared on a generated node', () => {
        const branchOrigin = {
            nodeId: 'branch-origin',
            type: 'branchOrigin',
            workspaceId: 'w',
            dimensions: { width: SIZE, height: SIZE },
            position: { x: 10, y: 20 },
            fileId: 'branch-origin',
            branchId: 'branch-1',
            src: '',
        }
        const branchFork = {
            nodeId: 'branch-fork',
            type: 'branchFork',
            workspaceId: 'w',
            dimensions: { width: SIZE, height: SIZE },
            position: { x: 40, y: 50 },
            fileId: 'branch-fork',
            branchId: 'branch-1',
            parentBranchNodeId: 'branch-origin',
            generationRequestId: 'req-1',
            temporary: true,
        }
        const branchLine = {
            nodeId: 'branch-line',
            type: 'branchLine',
            workspaceId: 'w',
            dimensions: { width: SIZE, height: SIZE },
            position: { x: 70, y: 80 },
            fileId: 'branch-line',
            branchId: 'branch-1',
            parentBranchNodeId: 'branch-origin',
            generationRequestId: 'req-1',
            temporary: true,
        }
        const nodes = [
            branchOrigin,
            branchFork,
            branchLine,
            genMedia('child', 90, 100, { branchId: 'branch-1', createdAt: 2 }),
        ] as any
        nodes[3].generatedBy.branchForkNodeId = 'branch-fork'
        nodes[3].generatedBy.branchLineNodeId = 'branch-line'

        const trees = buildBranchTrees(nodes, [])
        expect(trees).toHaveLength(1)
        expect(trees[0].rootId).toBe('branch-origin')
        expect(trees[0].childrenByParentId.get('branch-origin')).toBeUndefined()
        expect(trees[0].childrenByParentId.get('branch-fork')).toEqual(['child'])
        expect(trees[0].childrenByParentId.has('branch-line')).toBe(false)
    })

    it('keeps a branchLine continuation as one normal-gap chain with the marker off the depth path', () => {
        const branchLineMarker = {
            nodeId: 'branch-line',
            type: 'branchLine',
            workspaceId: 'w',
            dimensions: { width: SIZE, height: SIZE },
            position: { x: 0, y: 0 },
            fileId: 'branch-line',
            branchId: 'branch-1',
            generationRequestId: 'req-1',
            parentBranchNodeId: 'parent',
            temporary: true,
        }
        const nodes = [
        genMedia('parent', 0, 0, { branchId: 'branch-1', createdAt: 1 }),
        branchLineMarker,
        genMedia('child', 0, 0, { branchId: 'branch-1', createdAt: 2 }),
    ] as any
        nodes[2].generatedBy.parentMediaNodeId = 'parent'
        nodes[2].generatedBy.branchLineNodeId = 'branch-line'

        const trees = buildBranchTrees(nodes, [])
        expect(trees).toHaveLength(1)
        expect(trees[0].rootId).toBe('parent')
        expect(new Set(trees[0].memberIds)).toEqual(new Set(['parent', 'branch-line', 'child']))
        // The child chains directly off the parent media (one normal gap); the
        // marker is a member but never a depth child.
        expect(trees[0].childrenByParentId.get('parent')).toEqual(['child'])
        expect(trees[0].childrenByParentId.has('branch-line')).toBe(false)
    })

    it('positions a branchLine marker at the midpoint of the parent→child connector', () => {
        const branchLineMarker = {
            nodeId: 'branch-line', type: 'branchLine', workspaceId: 'w',
            dimensions: { width: SIZE, height: SIZE }, position: { x: 0, y: 0 },
            fileId: 'branch-line', branchId: 'branch-1', generationRequestId: 'req-1',
            parentBranchNodeId: 'parent', temporary: true,
        }
        const nodes = [
            genMedia('parent', 0, 0, { branchId: 'branch-1', createdAt: 1 }),
            branchLineMarker,
            genMedia('child', 0, 0, { branchId: 'branch-1', createdAt: 2 }),
        ] as any
        nodes[2].generatedBy.parentMediaNodeId = 'parent'
        nodes[2].generatedBy.branchLineNodeId = 'branch-line'

        const out = applyBranchTreeLayout(nodes, [], { depthGap: 100, siblingGap: 40 })
        const parent = out.find(n => n.nodeId === 'parent')!
        const child = out.find(n => n.nodeId === 'child')!
        const marker = out.find(n => n.nodeId === 'branch-line')!
        // Child sits one normal gap to the right of the parent (collinear).
        expect(child.position.x).toBe(parent.position.x + SIZE + 100)
        expect(child.position.y).toBe(parent.position.y)
        // Marker is centered between the parent's right edge and the child's left
        // edge, vertically centered on the parent.
        expect(marker.position.x).toBe((parent.position.x + SIZE + child.position.x) / 2 - SIZE / 2)
        expect(marker.position.y).toBe(parent.position.y + SIZE / 2 - SIZE / 2)
    })
})

describe('applyBranchTreeLayout', () => {
    it('leaves nodes untouched when there are no trees', () => {
        const nodes = [loose('u1', 10, 20)]
        expect(applyBranchTreeLayout(nodes, [], OPTS)).toBe(nodes)
    })

    it('preserves the root anchor and lays a chain out to its right', () => {
        const nodes = [
            genMedia('R', 500, 300, { createdAt: 1 }),
            genMedia('A', 9999, 9999, { parentMediaNodeId: 'R', createdAt: 2 }),
        ]
        const out = applyBranchTreeLayout(nodes, [], OPTS)
        // Root stays exactly where it was anchored.
        expect(posOf(out, 'R')).toEqual({ x: 500, y: 300 })
        // Child sits one column to the right, same Y (linear chain).
        expect(posOf(out, 'A')).toEqual({ x: 500 + SIZE + OPTS.depthGap, y: 300 })
    })

    it('keeps a single continuation on the media centerline when collision chrome extends below media', () => {
        const parent = genMedia('R', 500, 300, { createdAt: 1, width: 400, height: 400 })
        const child = genMedia('A', 9999, 9999, { parentMediaNodeId: 'R', createdAt: 2, width: 80, height: 80 })
        const out = applyBranchTreeLayout([parent, child], [], {
            ...OPTS,
            getNodeCollisionRect: (node, worldPosition) => ({
                x: worldPosition.x,
                y: worldPosition.y,
                width: node.dimensions.width,
                height: node.dimensions.height + (node.nodeId === 'R' ? 40 : 0),
            }),
        })
        const parentOut = out.find(node => node.nodeId === 'R')!
        const childOut = out.find(node => node.nodeId === 'A')!
        const parentCenterY = parentOut.position.y + parentOut.dimensions.height / 2
        const childCenterY = childOut.position.y + childOut.dimensions.height / 2

        expect(parentOut.position).toEqual({ x: 500, y: 300 })
        expect(childCenterY).toBe(parentCenterY)
    })

    it('keeps a midpoint marker on the connector centerline when collision chrome extends below media', () => {
        const parent = genMedia('R', 500, 300, { createdAt: 1, width: 400, height: 400 })
        const marker = {
            nodeId: 'line', type: 'branchLine', workspaceId: 'w',
            dimensions: { width: 100, height: 40 }, position: { x: 0, y: 0 },
            fileId: 'line', branchId: 'branch-A', generationRequestId: 'req-1',
            parentBranchNodeId: 'R', temporary: true,
        } as any
        const child = genMedia('A', 9999, 9999, { parentMediaNodeId: 'R', createdAt: 2, width: 400, height: 400 }) as ImageCanvasNode
        child.generatedBy!.branchLineNodeId = 'line'
        const pendingVisualSize = 120
        const pendingVisualInset = (400 - pendingVisualSize) / 2
        const options = {
            ...OPTS,
            getNodeCollisionRect: (node: CanvasNode, worldPosition: { x: number; y: number }) => {
                if (node.nodeId === 'A') {
                    return {
                        x: worldPosition.x + pendingVisualInset,
                        y: worldPosition.y + pendingVisualInset,
                        width: pendingVisualSize,
                        height: pendingVisualSize,
                    }
                }
                return {
                    x: worldPosition.x,
                    y: worldPosition.y,
                    width: node.dimensions.width,
                    height: node.dimensions.height + (node.nodeId === 'R' ? 40 : 0),
                }
            },
            getNodeConnectorAnchorRect: (node: CanvasNode, worldPosition: { x: number; y: number }) => {
                if (node.nodeId === 'A') {
                    return {
                        x: worldPosition.x + pendingVisualInset,
                        y: worldPosition.y + pendingVisualInset,
                        width: pendingVisualSize,
                        height: pendingVisualSize,
                    }
                }
                return {
                    x: worldPosition.x,
                    y: worldPosition.y,
                    width: node.dimensions.width,
                    height: node.dimensions.height,
                }
            },
        }

        const out = rebalanceBranchTreesAndResolve([parent, marker, child], [], options)
        const parentOut = out.find(node => node.nodeId === 'R')!
        const markerOut = out.find(node => node.nodeId === 'line')!
        const childOut = out.find(node => node.nodeId === 'A')!
        const parentCenterY = parentOut.position.y + parentOut.dimensions.height / 2
        const markerCenterY = markerOut.position.y + markerOut.dimensions.height / 2
        const childAnchorCenterY = childOut.position.y + pendingVisualInset + pendingVisualSize / 2

        expect(markerCenterY).toBe(parentCenterY)
        expect(childAnchorCenterY).toBe(parentCenterY)

        const second = rebalanceBranchTreesAndResolve(out, [], options)
        expect(second.map(node => [node.nodeId, node.position])).toEqual(out.map(node => [node.nodeId, node.position]))
    })

    it('spaces pending visual boxes by configured gaps even when persisted nodes are full media size', () => {
        const parent = genMedia('R', 0, 0, { createdAt: 1 })
        const children = [
            genMedia('A', 9999, 9999, { parentMediaNodeId: 'R', createdAt: 2 }),
            genMedia('B', 9999, 9999, { parentMediaNodeId: 'R', createdAt: 3 }),
        ]
        const pendingVisualSize = 200
        const pendingVisualInset = (SIZE - pendingVisualSize) / 2
        const out = applyBranchTreeLayout([parent, ...children], [], {
            ...OPTS,
            getNodeCollisionRect: (node, worldPosition) => node.nodeId === 'A' || node.nodeId === 'B'
                ? {
                    x: worldPosition.x + pendingVisualInset,
                    y: worldPosition.y + pendingVisualInset,
                    width: pendingVisualSize,
                    height: pendingVisualSize,
                }
                : {
                    x: worldPosition.x,
                    y: worldPosition.y,
                    width: node.dimensions.width,
                    height: node.dimensions.height,
                },
        })

        const a = out.find(node => node.nodeId === 'A')!
        const b = out.find(node => node.nodeId === 'B')!
        const aVisual = { x: a.position.x + pendingVisualInset, y: a.position.y + pendingVisualInset }
        const bVisual = { x: b.position.x + pendingVisualInset, y: b.position.y + pendingVisualInset }

        expect(aVisual.x).toBe(parent.position.x + parent.dimensions.width + OPTS.depthGap)
        expect(bVisual.x).toBe(aVisual.x)
        expect(bVisual.y - (aVisual.y + pendingVisualSize)).toBe(OPTS.siblingGap)
    })

    it('does not add fanout depth while every child is a pending visual box', () => {
        const parent = genMedia('R', 0, 0, { createdAt: 1 })
        const pendingIds = new Set(['A', 'B', 'C'])
        const children = [
            genMedia('A', 9999, 9999, { parentMediaNodeId: 'R', createdAt: 2 }),
            genMedia('B', 9999, 9999, { parentMediaNodeId: 'R', createdAt: 3 }),
            genMedia('C', 9999, 9999, { parentMediaNodeId: 'R', createdAt: 4 }),
        ]
        const pendingVisualSize = 200
        const pendingVisualInset = (SIZE - pendingVisualSize) / 2
        const out = applyBranchTreeLayout([parent, ...children], [], {
            ...FANOUT_OPTS,
            getBranchFanoutExtraGap: (_parentNode, childNodes) =>
                childNodes.every(child => pendingIds.has(child.nodeId))
                    ? 0
                    : FANOUT_OPTS.branchFanoutExtraGap,
            getNodeCollisionRect: (node, worldPosition) => pendingIds.has(node.nodeId)
                ? {
                    x: worldPosition.x + pendingVisualInset,
                    y: worldPosition.y + pendingVisualInset,
                    width: pendingVisualSize,
                    height: pendingVisualSize,
                }
                : {
                    x: worldPosition.x,
                    y: worldPosition.y,
                    width: node.dimensions.width,
                    height: node.dimensions.height,
                },
        })

        for (const child of children) {
            const resolved = out.find(node => node.nodeId === child.nodeId)!
            expect(resolved.position.x + pendingVisualInset)
                .toBe(parent.position.x + parent.dimensions.width + FANOUT_OPTS.depthGap)
        }
    })

    it('fans a two-child fork symmetrically around the anchored root', () => {
        const nodes = [
            genMedia('R', 0, 0, { createdAt: 1 }),
            genMedia('A', 1, 1, { parentMediaNodeId: 'R', createdAt: 2 }),
            genMedia('B', 2, 2, { parentMediaNodeId: 'R', createdAt: 3 }),
        ]
        const out = applyBranchTreeLayout(nodes, [], OPTS)
        expect(posOf(out, 'R')).toEqual({ x: 0, y: 0 })
        // Children share one column; A above the root center, B below; symmetric.
        const rCenter = posOf(out, 'R').y + SIZE / 2
        const aCenter = posOf(out, 'A').y + SIZE / 2
        const bCenter = posOf(out, 'B').y + SIZE / 2
        expect(posOf(out, 'A').x).toBe(SIZE + OPTS.depthGap)
        expect(posOf(out, 'B').x).toBe(SIZE + OPTS.depthGap)
        expect(aCenter).toBeLessThan(rCenter)
        expect(bCenter).toBeGreaterThan(rCenter)
        expect((aCenter + bCenter) / 2).toBeCloseTo(rCenter, 6)
    })

    it('pushes a whole child column farther right when a parent has a large fork', () => {
        const children = Array.from({ length: 10 }, (_, index) =>
            genMedia(`C${index + 1}`, index + 1, index + 1, {
                parentMediaNodeId: 'R',
                createdAt: index + 2,
            })
        )
        const nodes = [
            genMedia('R', 0, 0, { createdAt: 1 }),
            ...children,
            genMedia('C1A', 20, 20, { parentMediaNodeId: 'C1', createdAt: 20 }),
        ]
        const out = applyBranchTreeLayout(nodes, [], FANOUT_OPTS)
        const forkGap = FANOUT_OPTS.depthGap + FANOUT_OPTS.branchFanoutExtraGap * (children.length - 1)

        for (const child of children) expect(posOf(out, child.nodeId).x).toBe(SIZE + forkGap)
        expect(posOf(out, 'C1A').x).toBe(SIZE + forkGap + SIZE + FANOUT_OPTS.depthGap)
    })

    it('keeps a fork balanced after children resolve to non-square final frames', () => {
        const nodes = [
            genMedia('R', 0, 0, { createdAt: 1 }),
            genMedia('A', 1, 1, { parentMediaNodeId: 'R', createdAt: 2, height: 450 }),
            genMedia('B', 2, 2, { parentMediaNodeId: 'R', createdAt: 3, height: 450 }),
        ]
        const out = applyBranchTreeLayout(nodes, [], OPTS)
        const rCenter = posOf(out, 'R').y + SIZE / 2
        const aCenter = posOf(out, 'A').y + 225
        const bCenter = posOf(out, 'B').y + 225

        expect(aCenter).toBeLessThan(rCenter)
        expect(bCenter).toBeGreaterThan(rCenter)
        expect((aCenter + bCenter) / 2).toBeCloseTo(rCenter, 6)
        expect(posOf(out, 'B').y - (posOf(out, 'A').y + 450)).toBe(OPTS.siblingGap)
    })
})

describe('rebalanceBranchTreesAndResolve', () => {
    it('moves a whole tree as a rigid block away from a loose node', () => {
        // Loose node sits on top of where the fork's lower child lands.
        const nodes: CanvasNode[] = [
            genMedia('R', 0, 0, { createdAt: 1 }),
            genMedia('A', 1, 1, { parentMediaNodeId: 'R', createdAt: 2 }),
            genMedia('B', 2, 2, { parentMediaNodeId: 'R', createdAt: 3 }),
            loose('u1', SIZE + OPTS.depthGap, SIZE), // overlaps child column
        ]
        const tidied = applyBranchTreeLayout(nodes, [], OPTS)
        const out = rebalanceBranchTreesAndResolve(nodes, [], OPTS)

        // Internal tree geometry is preserved: every member shifted by one delta.
        const dR = { x: posOf(out, 'R').x - posOf(tidied, 'R').x, y: posOf(out, 'R').y - posOf(tidied, 'R').y }
        const dA = { x: posOf(out, 'A').x - posOf(tidied, 'A').x, y: posOf(out, 'A').y - posOf(tidied, 'A').y }
        const dB = { x: posOf(out, 'B').x - posOf(tidied, 'B').x, y: posOf(out, 'B').y - posOf(tidied, 'B').y }
        expect(dA).toEqual(dR)
        expect(dB).toEqual(dR)
        expect(dR.x !== 0 || dR.y !== 0).toBe(true) // the tree actually moved

        // No member overlaps the loose node afterwards.
        const byId = new Map(out.map(n => [n.nodeId, n]))
        for (const id of ['R', 'A', 'B']) {
            expect(overlaps(byId.get(id)!, byId.get('u1')!)).toBe(false)
        }
    })

    it('separates two overlapping trees without un-tidying either', () => {
        const nodes: CanvasNode[] = [
            genMedia('R1', 0, 0, { branchId: 'b1', createdAt: 1 }),
            genMedia('A1', 0, 0, { branchId: 'b1', parentMediaNodeId: 'R1', createdAt: 2 }),
            genMedia('R2', 0, 0, { branchId: 'b2', createdAt: 1 }),
            genMedia('A2', 0, 0, { branchId: 'b2', parentMediaNodeId: 'R2', createdAt: 2 }),
        ]
        const out = rebalanceBranchTreesAndResolve(nodes, [], OPTS)
        const byId = new Map(out.map(n => [n.nodeId, n]))

        // Each chain stays collinear (tidy preserved) ...
        expect(byId.get('A1')!.position.y).toBe(byId.get('R1')!.position.y)
        expect(byId.get('A2')!.position.y).toBe(byId.get('R2')!.position.y)
        // ... and the two trees no longer occupy the same rows.
        expect(byId.get('R1')!.position.y).not.toBe(byId.get('R2')!.position.y)
    })

    it('still de-overlaps loose nodes when no trees exist (parity with prior behavior)', () => {
        const nodes: CanvasNode[] = [loose('u1', 0, 0), loose('u2', 40, 0)]
        const out = rebalanceBranchTreesAndResolve(nodes, [], OPTS)
        const byId = new Map(out.map(n => [n.nodeId, n]))
        expect(overlaps(byId.get('u1')!, byId.get('u2')!)).toBe(false)
    })
})
