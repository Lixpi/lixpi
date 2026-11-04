import { describe, expect, it } from 'vitest'
import { isOrthogonalRouteSimple } from './route-simplicity.ts'

describe('orthogonal route simplicity', () => {
    it('accepts a clear route with turns', () => {
        expect(isOrthogonalRouteSimple([
            {
                x: 0,
                y: 0,
            },
            {
                x: 100,
                y: 0,
            },
            {
                x: 100,
                y: 100,
            },
        ])).toBe(true)
    })

    it('accepts adjacent segments that meet at a corner', () => {
        expect(isOrthogonalRouteSimple([
            {
                x: 0,
                y: 0,
            },
            {
                x: 100,
                y: 0,
            },
            {
                x: 100,
                y: 100,
            },
            {
                x: 200,
                y: 100,
            },
        ])).toBe(true)
    })

    it('rejects diagonal and zero-length-only routes', () => {
        expect(isOrthogonalRouteSimple([
            {
                x: 0,
                y: 0,
            },
            {
                x: 100,
                y: 100,
            },
        ])).toBe(false)
        expect(isOrthogonalRouteSimple([
            {
                x: 0,
                y: 0,
            },
            {
                x: 0,
                y: 0,
            },
        ])).toBe(false)
    })

    it('rejects a route that retraces or crosses its earlier legs', () => {
        expect(isOrthogonalRouteSimple([
            {
                x: 0,
                y: 0,
            },
            {
                x: 100,
                y: 0,
            },
            {
                x: 100,
                y: 100,
            },
            {
                x: 50,
                y: 100,
            },
            {
                x: 50,
                y: -10,
            },
        ])).toBe(false)
        expect(isOrthogonalRouteSimple([
            {
                x: 0,
                y: 0,
            },
            {
                x: 100,
                y: 0,
            },
            {
                x: 100,
                y: 100,
            },
            {
                x: 0,
                y: 100,
            },
            {
                x: 0,
                y: 0,
            },
        ])).toBe(false)
    })
})

describe('orthogonal route simplicity adjacent segments', () => {
    it('rejects immediate backtracking and accepts duplicate adjacent points', () => {
        expect(isOrthogonalRouteSimple([
            {
                x: 0,
                y: 0,
            },
            {
                x: 100,
                y: 0,
            },
            {
                x: 50,
                y: 0,
            },
        ])).toBe(false)
        expect(isOrthogonalRouteSimple([
            {
                x: 0,
                y: 0,
            },
            {
                x: 0,
                y: 0,
            },
            {
                x: 100,
                y: 0,
            },
            {
                x: 100,
                y: 100,
            },
        ])).toBe(true)
    })
})
