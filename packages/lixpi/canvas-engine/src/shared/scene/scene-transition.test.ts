import {
    describe,
    expect,
    it,
} from 'vitest'
import { planSceneTransition } from './scene-transition.ts'

describe('planSceneTransition', () => {
    it('clears a previous scene during replacement loading and suppresses loading after failure', () => {
        const input = { currentSceneKey: 'a', nextSceneKey: 'b', renderedSceneKey: 'a', hasSnapshot: false, failed: false }
        expect(planSceneTransition(input)).toEqual({ sceneKey: 'b', routeChanged: true, loadedChanged: false, sceneChanged: true, clearContent: true, showLoading: true })
        expect(planSceneTransition({ ...input, failed: true }).showLoading).toBe(false)
        expect(planSceneTransition({ ...input, hasSnapshot: true })).toEqual({ sceneKey: 'b', routeChanged: true, loadedChanged: true, sceneChanged: true, clearContent: false, showLoading: false })
    })
})
