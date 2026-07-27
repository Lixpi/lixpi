export type CapabilityErrorCode =
    | 'CAPABILITY_NOT_FOUND_OR_FORBIDDEN'
    | 'CAPABILITY_MANIFEST_INTEGRITY_FAILED'
    | 'CAPABILITY_MANIFEST_INVALID'
    | 'CAPABILITY_RESOURCE_INTEGRITY_FAILED'
    | 'CAPABILITY_RESOURCE_INVALID'
    | 'CAPABILITY_RESOLUTION_LIMIT_EXCEEDED'
    | 'CAPABILITY_WORKFLOW_INVALID'
    | 'CAPABILITY_ACTION_NOT_ALLOWED'
    | 'CAPABILITY_ACTION_INPUT_INVALID'
    | 'CAPABILITY_ACTION_OUTPUT_INVALID'
    | 'CAPABILITY_ACTION_FAILED'
    | 'CAPABILITY_RUN_CANCELLED'
    | 'MODEL_INPUT_KIND_UNSUPPORTED'
    | 'MODEL_INPUT_CONTEXT_EXCEEDED'

export class CapabilityError extends Error {
    constructor(
        readonly code: CapabilityErrorCode,
        message: string,
        readonly details: Record<string, unknown> = {},
        options?: ErrorOptions,
    ) {
        super(message, options)
        this.name = 'CapabilityError'
    }
}

export function isCapabilityError(error: unknown): error is CapabilityError {
    return error instanceof CapabilityError
}
