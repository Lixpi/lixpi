import { describe, expect, it } from 'vitest'
import fixtures from './path-baseline.json'
import {
    computePath,
    OrthogonalRoutingError,
} from './index.ts'
import { type AnchorPosition, type PathType } from '../path-types.ts'

const expectPathClearOfObstacles = (
    path: string,
    obstacles: Array<{
        id: string
        shape: 'rect'
        x: number
        y: number
        width: number
        height: number
    }>,
): void => {
    const points = Array.from(
        path.matchAll(/[ML] (-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g),
        match => ({
            x: Number(match[1]),
            y: Number(match[2]),
        }),
    )

    expect(points.length).toBeGreaterThan(1)

    for (const node of obstacles) {
        const left = node.x - 10
        const right = node.x + node.width + 10
        const top = node.y - 10
        const bottom = node.y + node.height + 10
        const intersects = points.slice(1).some((end, index) => {
            const start = points[index]

            return start.y === end.y
                ? start.y >= top
                    && start.y <= bottom
                    && Math.max(start.x, end.x) > left
                    && Math.min(start.x, end.x) < right
                : start.x >= left
                    && start.x <= right
                    && Math.max(start.y, end.y) > top
                    && Math.min(start.y, end.y) < bottom
        })

        expect(intersects, `route should clear obstacle ${node.id}`).toBe(false)
    }
}


describe('connector path compatibility with captured 0.0.82 output', () => {
    it('preserves paths, labels and offsets across side pairs, reversed axes and degenerate endpoints', () => {
        for (const fixture of fixtures) {
            const actual = computePath(fixture.kind as PathType, fixture.sourceX, fixture.sourceY, fixture.targetX, fixture.targetY, fixture.sourcePosition as AnchorPosition, fixture.targetPosition as AnchorPosition, fixture.curvature)
            expect([actual.path, actual.labelX, actual.labelY, actual.offsetX, actual.offsetY], JSON.stringify(fixture)).toEqual(fixture.expected)
        }
    })
})


describe('orthogonal connector obstacle routing', () => {

    it('keeps the demonstrated bridge-record route clear of conditions and review nodes', () => {
        const obstacles = [
            {
                id: 'conditions',
                shape: 'rect' as const,
                x: 1719,
                y: 422.5,
                width: 252,
                height: 79,
            },
            {
                id: 'review',
                shape: 'rect' as const,
                x: 1719,
                y: 183.5,
                width: 284,
                height: 79,
            },
        ]
        const result = computePath(
            'orthogonal',
            1606,
            462,
            2116,
            223,
            'right',
            'left',
            0.25,
            0,
            undefined,
            new Map(obstacles.map(node => [node.id, node])),
            'bridge-record',
            'review-conditions',
        )

        expectPathClearOfObstacles(result.path, obstacles)
    })

    it('keeps the demonstrated review-conditions route clear of each intervening branch', () => {
        const obstacles = [
            {
                id: 'next',
                shape: 'rect' as const,
                x: 1341,
                y: 183.5,
                width: 250,
                height: 79,
            },
            {
                id: 'finding',
                shape: 'rect' as const,
                x: 963,
                y: 303,
                width: 250,
                height: 79,
            },
            {
                id: 'repeated-runs',
                shape: 'rect' as const,
                x: 567,
                y: 303,
                width: 260,
                height: 79,
            },
        ]
        const result = computePath(
            'orthogonal',
            1704,
            223,
            470.261,
            342.5,
            'right',
            'left',
            0.25,
            0,
            undefined,
            new Map(obstacles.map(node => [node.id, node])),
            'review-conditions',
            'bridge-record',
        )

        expectPathClearOfObstacles(result.path, obstacles)
    })
    it('detours around an obstacle when endpoints share a Y coordinate', () => {
        const obstacle = {
            id: 'blocker',
            shape: 'rect' as const,
            x: 100,
            y: 0,
            width: 100,
            height: 100,
        }
        const result = computePath(
            'orthogonal',
            0,
            50,
            300,
            50,
            'right',
            'left',
            0.25,
            0,
            undefined,
            new Map([['blocker', obstacle]]),
            'source',
            'target',
        )

        expect(result.path).not.toBe('M 0,50 L 300,50')
        expect(result.path).toContain('L 80,115')
    })

    it('raises a typed error when the bounded local detour cannot escape an obstacle', () => {
        const obstacle = {
            id: 'blocker',
            shape: 'rect' as const,
            x: -100,
            y: -100,
            width: 500,
            height: 300,
        }

        expect(() => computePath(
            'orthogonal',
            0,
            50,
            300,
            50,
            'right',
            'left',
            0.25,
            0,
            undefined,
            new Map([['blocker', obstacle]]),
            'source',
            'target',
        )).toThrow(OrthogonalRoutingError)
    })
})

describe('orthogonal connector routing by endpoint direction', () => {
    it.each([
        {
            sourceSide: 'top' as const,
            targetSide: 'bottom' as const,
            sourceY: 100,
            targetY: 400,
            sourceOutwardSign: -1,
            targetApproachSign: -1,
        },
        {
            sourceSide: 'bottom' as const,
            targetSide: 'top' as const,
            sourceY: 400,
            targetY: 100,
            sourceOutwardSign: 1,
            targetApproachSign: 1,
        },
    ])('uses outward vertical leads for -to- endpoints', ({
        sourceSide,
        targetSide,
        sourceY,
        targetY,
        sourceOutwardSign,
        targetApproachSign,
    }) => {
        const sourceX = 100
        const targetX = 500
        const result = computePath(
            'orthogonal',
            sourceX,
            sourceY,
            targetX,
            targetY,
            sourceSide,
            targetSide,
            0.25,
            0,
        )
        const points = Array.from(
            result.path.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g),
            match => ({
                x: Number(match[1]),
                y: Number(match[2]),
            }),
        )

        expect(points.length).toBeGreaterThanOrEqual(3)
        expect(points[0]).toEqual({
            x: sourceX,
            y: sourceY,
        })
        expect(points[1].x).toBe(sourceX)
        expect(Math.sign(points[1].y - sourceY)).toBe(sourceOutwardSign)
        expect(points.at(-2)?.x).toBe(targetX)
        expect(Math.sign(targetY - points.at(-2)!.y)).toBe(targetApproachSign)
        expect(points.at(-1)).toEqual({
            x: targetX,
            y: targetY,
        })
    })
})

describe('orthogonal connector routing with mixed endpoint directions', () => {
    it.each([
        {
            sourceSide: 'right' as const,
            targetSide: 'bottom' as const,
            source: {
                x: 100,
                y: 400,
            },
            target: {
                x: 500,
                y: 100,
            },
            sourceLead: (point: {
                x: number
                y: number
            }) => point.x > 100 && point.y === 400,
            targetLead: (point: {
                x: number
                y: number
            }) => point.x === 500 && point.y > 100,
        },
        {
            sourceSide: 'top' as const,
            targetSide: 'left' as const,
            source: {
                x: 100,
                y: 400,
            },
            target: {
                x: 500,
                y: 100,
            },
            sourceLead: (point: {
                x: number
                y: number
            }) => point.x === 100 && point.y < 400,
            targetLead: (point: {
                x: number
                y: number
            }) => point.x < 500 && point.y === 100,
        },
    ])('leaves  and approaches  without an axis hook', ({
        sourceSide,
        targetSide,
        source,
        target,
        sourceLead,
        targetLead,
    }) => {
        const result = computePath(
            'orthogonal',
            source.x,
            source.y,
            target.x,
            target.y,
            sourceSide,
            targetSide,
            0.25,
            0,
        )
        const points = Array.from(
            result.path.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g),
            match => ({
                x: Number(match[1]),
                y: Number(match[2]),
            }),
        )

        expect(points.length).toBeGreaterThanOrEqual(3)
        expect(sourceLead(points[1])).toBe(true)
        expect(targetLead(points.at(-2)!)).toBe(true)
        expect(points.at(-1)).toEqual(target)
    })

    it('keeps a mixed right-to-bottom route clear of the intervening node', () => {
        const obstacle = {
            id: 'intervening',
            shape: 'rect' as const,
            x: 250,
            y: 300,
            width: 100,
            height: 160,
        }
        const result = computePath(
            'orthogonal',
            100,
            400,
            500,
            100,
            'right',
            'bottom',
            0.25,
            0,
            undefined,
            new Map([[obstacle.id, obstacle]]),
            'source',
            'target',
        )

        expectPathClearOfObstacles(result.path, [obstacle])
    })
})
