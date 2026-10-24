export const ACCOUNT_ADMISSION_CLAIM = 'https://lixpi.ai/admission'
export const ACCOUNT_ADMISSION_CHECK_SUBJECT = 'accounts.admission.check.v1'
export const ACCOUNT_ADMISSION_CHANGED_SUBJECT = 'accounts.admission.changed.v1'
export const ACCOUNT_WORK_ADMISSION_SUBJECT = 'accounts.admission.work.v1'

export type AccountWorkContext = Readonly<{
    identityKey: string
    issuer: string
    subject: string
    epoch: number
    personalOrganizationId: string
    tokenExpiresAt: number
}>
export const ACCOUNT_ADMISSION_REPLY_PREFIX = '_ADMISSION_REPLY'

export type AccountPolicyRequest = {
    version: 1
    nonce: string
    revision: string
    applicationRevision: string
    userNKey: string
    issuer: string
    subject: string
    audience: string
    claim: AdmissionClaim
    tokenExpiresAt: number
    grantExpiresAt: number
}

export type AccountPolicyDecision = {
    version: 1
    nonce: string
    revision: string
    applicationRevision: string
    userNKey: string
    subject: string
    allowed: boolean
    epoch: number
    expiresAt: number
}

export type AdmissionClaim = {
    v: 1
    epoch: number
}

export type AccountAdmissionRecord = {
    identityKey: string
    schemaVersion: 1
    issuer: string
    subject: string
    userId: string
    personalOrganizationId: string
    state: 'active' | 'blocked' | 'reconciling' | 'superseded' | 'verification_required' | 'unregistered'
    epoch: number
    emailVerification: {
        issuer: string
        subject: string
        connectionId: string
        email: string
        source: 'database_otp' | 'passwordless_otp' | 'enterprise_otp' | 'provider' | 'form_otp' | 'local_fixture'
        verifiedAt: number
        providerEmail: string | null
        challengeId?: string
        providerSubject?: string
    }
    completedAt: number
    updatedAt: number
    canonicalSubject?: string
    operationId?: string
    blockRequested?: boolean
    emailPending?: Array<{
        subject: string
        connectionId: string
        providerEmail: string | null
        nativeVerified: boolean
    }>
}

// Lengths count UTF-8 bytes, including when a subject contains non-ASCII text.
export const getAccountIdentityKey = (
    issuer: string,
    subject: string,
): string => {
    const encoder = new TextEncoder()
    const issuerLength = encoder.encode(issuer).length
    const subjectLength = encoder.encode(subject).length

    if (
        !issuerLength
        || !subjectLength
        || !issuer.isWellFormed()
        || !subject.isWellFormed()
        || issuerLength + subjectLength > 1800
    )
        throw new Error('Invalid account identity')

    return `${issuerLength}:${issuer}${subjectLength}:${subject}`
}
