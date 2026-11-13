const boundedInteger = (
    environment: Record<string, string | undefined>,
    name: string,
    fallback: number,
    maximum: number,
): number => {
    const raw = environment[name]
    const value = raw === undefined
        || raw === ''
        ? fallback
        : Number(raw)

    if (
        !Number.isSafeInteger(value)
        || value < 1
        || value > maximum
    )
        throw new Error(`Invalid ${name}`)

    return value
}

export class AgentConfiguration {
    readonly maxModelCalls: number
    readonly maxToolCalls: number
    readonly maxSpecialistCalls: number
    readonly maxDelegationCalls: number
    // How long a delegating agent waits for the child's answer before the
    // delegation continues as a pending operation.
    readonly delegationWaitMs: number

    constructor(environment: Record<string, string | undefined>) {
        this.maxModelCalls = boundedInteger(
            environment,
            'AGENT_MAX_MODEL_CALLS',
            24,
            256,
        )
        this.maxToolCalls = boundedInteger(
            environment,
            'AGENT_MAX_TOOL_CALLS',
            64,
            1024,
        )
        this.maxSpecialistCalls = boundedInteger(
            environment,
            'AGENT_MAX_SPECIALIST_CALLS',
            4,
            16,
        )
        this.maxDelegationCalls = boundedInteger(
            environment,
            'AGENT_MAX_DELEGATION_CALLS',
            8,
            64,
        )
        this.delegationWaitMs = boundedInteger(
            environment,
            'AGENT_DELEGATION_WAIT_MS',
            120_000,
            900_000,
        )
    }
}
