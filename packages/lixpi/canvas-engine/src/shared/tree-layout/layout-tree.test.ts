'use strict'

import {
    describe,
    it,
    expect,
} from 'vitest'
import {
    layoutTree,
    type TreeLayoutNode,
} from './layout-tree.ts'

// =============================================================================
// PURE TIDY-TREE LAYOUT
// =============================================================================

// Geometry helpers used by the invariant assertions below.
const rectOf = (
    positions: Map<string, { x: number; y: number }>,
    node: TreeLayoutNode,
) => {
    const pos = positions.get(node.id)!
    return { x: pos.x, y: pos.y, width: node.width, height: node.height }
}

const overlaps = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
): boolean =>
    a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y

const centerY = (
    positions: Map<string, { x: number; y: number }>,
    node: TreeLayoutNode,
): number => positions.get(node.id)!.y + node.height / 2

const OPTS = { depthGap: 100, siblingGap: 40 }

describe('layoutTree', () => {
    it('returns an empty result for no nodes', () => {
        const result = layoutTree([], OPTS)
        expect(result.rootId).toBe('')
        expect(result.positions.size).toBe(0)
        expect(result.bounds).toEqual({ width: 0, height: 0 })
    })

    it('places a single root at the origin (no-op tree)', () => {
        const root: TreeLayoutNode = { id: 'R', parentId: null, width: 800, height: 600 }
        const result = layoutTree([root], OPTS)

        expect(result.rootId).toBe('R')
        expect(result.positions.get('R')).toEqual({ x: 0, y: 0 })
        expect(result.bounds).toEqual({ width: 800, height: 600 })
    })

    it('keeps a linear chain perfectly collinear', () => {
        const nodes: TreeLayoutNode[] = [
            { id: 'R', parentId: null, width: 800, height: 800 },
            { id: 'A', parentId: 'R', width: 800, height: 800 },
            { id: 'B', parentId: 'A', width: 800, height: 800 },
            { id: 'C', parentId: 'B', width: 800, height: 800 },
        ]
        const { positions } = layoutTree(nodes, OPTS)

        // Same Y for every node, X increases by width + depthGap each step.
        for (const id of ['R', 'A', 'B', 'C']) expect(positions.get(id)!.y).toBe(0)
        expect(positions.get('R')!.x).toBe(0)
        expect(positions.get('A')!.x).toBe(900)
        expect(positions.get('B')!.x).toBe(1800)
        expect(positions.get('C')!.x).toBe(2700)
    })

    it('places a two-child fork symmetrically around the root center', () => {
        const nodes: TreeLayoutNode[] = [
            { id: 'R', parentId: null, width: 800, height: 800 },
            { id: 'A', parentId: 'R', width: 800, height: 800 },
            { id: 'B', parentId: 'R', width: 800, height: 800 },
        ]
        const { positions } = layoutTree(nodes, OPTS)

        // Root holds the origin; both children share one column to its right.
        expect(positions.get('R')).toEqual({ x: 0, y: 0 })
        expect(positions.get('A')!.x).toBe(900)
        expect(positions.get('B')!.x).toBe(900)

        // A above, B below, symmetric about the root's vertical center.
        const rCenter = centerY(positions, nodes[0])
        const aCenter = centerY(positions, nodes[1])
        const bCenter = centerY(positions, nodes[2])
        expect(aCenter).toBeLessThan(rCenter)
        expect(bCenter).toBeGreaterThan(rCenter)
        expect((aCenter + bCenter) / 2).toBeCloseTo(rCenter, 6)

        // Siblings separated by exactly height + siblingGap, never overlapping.
        expect(bCenter - aCenter).toBe(800 + OPTS.siblingGap)
        expect(overlaps(rectOf(positions, nodes[1]), rectOf(positions, nodes[2]))).toBe(false)
    })

    it('aligns the middle of three children with the root center', () => {
        const nodes: TreeLayoutNode[] = [
            { id: 'R', parentId: null, width: 800, height: 800 },
            { id: 'A', parentId: 'R', width: 800, height: 800 },
            { id: 'B', parentId: 'R', width: 800, height: 800 },
            { id: 'C', parentId: 'R', width: 800, height: 800 },
        ]
        const { positions } = layoutTree(nodes, OPTS)

        const rCenter = centerY(positions, nodes[0])
        expect(centerY(positions, nodes[2])).toBeCloseTo(rCenter, 6) // B aligned with R
        expect(centerY(positions, nodes[1])).toBeLessThan(rCenter) // A above
        expect(centerY(positions, nodes[3])).toBeGreaterThan(rCenter) // C below
    })

    it('never overlaps any pair of nodes in a deep, unbalanced tree', () => {
        // R → { A → {A1, A2, A3}, B }: A's tall subtree must not collide with B.
        const nodes: TreeLayoutNode[] = [
            { id: 'R', parentId: null, width: 800, height: 800 },
            { id: 'A', parentId: 'R', width: 800, height: 800 },
            { id: 'B', parentId: 'R', width: 800, height: 800 },
            { id: 'A1', parentId: 'A', width: 800, height: 800 },
            { id: 'A2', parentId: 'A', width: 800, height: 800 },
            { id: 'A3', parentId: 'A', width: 800, height: 800 },
        ]
        const { positions } = layoutTree(nodes, OPTS)

        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                expect(overlaps(rectOf(positions, nodes[i]), rectOf(positions, nodes[j]))).toBe(false)
            }
        }
    })

    it('honors variable node sizes when computing depth columns', () => {
        const nodes: TreeLayoutNode[] = [
            { id: 'R', parentId: null, width: 400, height: 300 },
            { id: 'A', parentId: 'R', width: 1000, height: 500 },
            { id: 'B', parentId: 'A', width: 200, height: 200 },
        ]
        const { positions } = layoutTree(nodes, OPTS)

        // Each child's X = parent.x + parent.width + depthGap (variable widths).
        expect(positions.get('R')!.x).toBe(0)
        expect(positions.get('A')!.x).toBe(400 + OPTS.depthGap)
        expect(positions.get('B')!.x).toBe(400 + OPTS.depthGap + 1000 + OPTS.depthGap)
    })

    it('adds horizontal gap for each additional child of a large branching parent', () => {
        const children: TreeLayoutNode[] = Array.from({ length: 10 }, (_, index) => ({
            id: `C${index + 1}`,
            parentId: 'R',
            width: 800,
            height: 800,
        }))
        const nodes: TreeLayoutNode[] = [
            { id: 'R', parentId: null, width: 800, height: 800 },
            ...children,
            { id: 'C1A', parentId: 'C1', width: 800, height: 800 },
        ]
        const { positions } = layoutTree(nodes, {
            ...OPTS,
            branchFanoutDepthGap: 25,
        })

        const branchGap = OPTS.depthGap + 25 * (children.length - 1)
        for (const child of children) expect(positions.get(child.id)!.x).toBe(800 + branchGap)
        expect(positions.get('C1A')!.x).toBe(800 + branchGap + 800 + OPTS.depthGap)
    })

    it('keeps a single-child chain collinear even when sizes differ', () => {
        const nodes: TreeLayoutNode[] = [
            { id: 'R', parentId: null, width: 800, height: 1000 },
            { id: 'A', parentId: 'R', width: 800, height: 200 },
        ]
        const { positions } = layoutTree(nodes, OPTS)

        // Single child ⇒ parent inherits the child's center exactly.
        expect(centerY(positions, nodes[0])).toBeCloseTo(centerY(positions, nodes[1]), 6)
    })
})
