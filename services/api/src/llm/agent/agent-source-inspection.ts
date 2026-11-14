import {
    AgentExecutionScope,
    AgentReadTargetNotInContext,
} from './agent-execution-scope.ts'

export const inspectAgentSource = async (
    input: Readonly<Record<string, unknown>>,
    readSource: (
        assetId: string,
        offset?: number,
        limit?: number,
    ) => Promise<unknown>,
): Promise<unknown> => {
    const assetId = String(input.assetId)

    try {
        await AgentExecutionScope.assertReadTargets([assetId])
    } catch (error) {
        if (!(error instanceof AgentReadTargetNotInContext))
            throw error

        return {
            status: 'error',
            error: {
                code: error.message,
                message: 'This source is not admitted to the current context. Use an exact source ID from the available context or discover an authorized source when discovery is available.',
                recoverable: true,
            },
        }
    }

    return await readSource(
        assetId,
        input.offset as number | undefined,
        input.limit as number | undefined,
    )
}
