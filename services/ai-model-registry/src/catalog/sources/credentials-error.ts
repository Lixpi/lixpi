// A provider being unreachable is a skip: the sync carries on with what it has. An
// expired or missing AWS session is not, because the run would silently produce a
// catalog missing everything Bedrock knows and nobody would see why. It stops.
export class CredentialsExpiredError extends Error {
    constructor(
        readonly profile: string,
        cause: unknown,
    ) {
        super(`AWS credentials for profile "${profile}" are missing or expired. Run \`aws sso login --profile ${profile}\` and re-run the sync.`)
        this.name = 'CredentialsExpiredError'
        this.cause = cause
    }
}

const CREDENTIAL_ERROR_NAMES = new Set([
    'CredentialsProviderError',
    'ExpiredTokenException',
    'ExpiredToken',
    'InvalidGrantException',
    'UnrecognizedClientException',
    'AccessDeniedException',
])

const CREDENTIAL_ERROR_HINTS = [
    'sso session',
    'was not found',
    'expired',
    'could not load credentials',
    'security token included in the request is invalid',
]

export const isCredentialsProblem = (error: unknown): boolean => {
    if (!(error instanceof Error))
        return false

    if (CREDENTIAL_ERROR_NAMES.has(error.name))
        return true

    const message = error.message.toLowerCase()

    return CREDENTIAL_ERROR_HINTS.some(hint => message.includes(hint))
}
