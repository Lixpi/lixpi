import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'

export function destroyWorkspaceCanvasResources(cleanups: Iterable<() => void>): void {
    const lifetime = new Lifetime()
    for (const cleanup of cleanups) lifetime.own(cleanup)
    lifetime.destroy()
}
