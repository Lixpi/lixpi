'use strict'

export type JwtVerifierConfig = {
    jwksUri: string
    audience: string
    issuer: string
    algorithms?: string[]
}

export type JwtVerificationResult = {
    decoded?: any
    error?: string
}

export type NKeyVerificationResult = {
    decoded?: any
    error?: string
}

export type ServiceAuthConfig = {
    publicKey: string
    userId: string
    permissions: {
        pub: { allow: string[] }
        sub: { allow: string[] }
    }
}
