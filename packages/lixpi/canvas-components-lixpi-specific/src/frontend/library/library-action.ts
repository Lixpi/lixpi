// Reads may finish after a panel is replaced. Accepted writes still settle in
// the transport port, but their result must not update the replacement view.
export async function runLibraryAction<T>(signal: AbortSignal, action: () => Promise<T>, apply: (result: T) => void, onError: (error: unknown) => void): Promise<void> {
    if (signal.aborted) return
    try {
        const result = await action()
        if (!signal.aborted) apply(result)
    } catch (error) {
        if (!signal.aborted) onError(error)
    }
}
