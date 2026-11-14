import { AsyncLocalStorage } from 'node:async_hooks'

// The native tool-call identity is trusted graph state, never a model argument.
export class AgentToolInvocation {
    private static readonly calls = new AsyncLocalStorage<string>()

    static async run<T>(
        callId: string,
        operation: () => Promise<T>,
    ): Promise<T> {
        if (!callId)
            throw new Error('AGENT_TOOL_CALL_ID_REQUIRED')

        return await this.calls.run(callId, operation)
    }

    static current(): string {
        const callId = this.calls.getStore()

        if (!callId)
            throw new Error('AGENT_TOOL_CALL_ID_REQUIRED')

        return callId
    }
}
