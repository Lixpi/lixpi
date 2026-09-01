export type SceneTransitionInput = {
    currentSceneKey: string
    nextSceneKey?: string
    renderedSceneKey: string | null
    hasSnapshot: boolean
    failed: boolean
}

export function planSceneTransition(input: SceneTransitionInput) {
    const sceneKey = input.nextSceneKey || input.currentSceneKey
    const routeChanged = Boolean(input.nextSceneKey && input.nextSceneKey !== input.currentSceneKey)
    const loadedChanged = Boolean(input.hasSnapshot && sceneKey && sceneKey !== input.renderedSceneKey)
    const clearContent = Boolean(sceneKey && !input.hasSnapshot && sceneKey !== input.renderedSceneKey)
    return { sceneKey, routeChanged, loadedChanged, sceneChanged: routeChanged || loadedChanged, clearContent, showLoading: clearContent && !input.failed }
}
