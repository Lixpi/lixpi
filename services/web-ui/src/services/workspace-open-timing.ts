// Records the phases of opening a workspace as User Timing measures, which
// the browser's performance tools show on their timings track. A phase that
// fails to record never affects the load itself.
type WorkspaceOpenPhase = 'fetch' | 'render' | 'assets'

const record = (
    phase: WorkspaceOpenPhase,
    workspaceId: string,
    start: number,
): void => {
    try {
        performance.measure(
            `workspace-open:${phase}`,
            {
                start,
                end: performance.now(),
                detail: { workspaceId },
            },
        )
    } catch {}
}

export const measureWorkspaceOpen = <Result>(
    phase: WorkspaceOpenPhase,
    workspaceId: string,
    run: () => Result,
): Result => {
    const start = performance.now()

    try {
        return run()
    } finally {
        record(
            phase,
            workspaceId,
            start,
        )
    }
}

export const measureWorkspaceOpenAsync = async <Result>(
    phase: WorkspaceOpenPhase,
    workspaceId: string,
    run: () => Promise<Result>,
): Promise<Result> => {
    const start = performance.now()

    try {
        return await run()
    } finally {
        record(
            phase,
            workspaceId,
            start,
        )
    }
}
