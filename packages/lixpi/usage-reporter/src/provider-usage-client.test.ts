import { readFileSync } from 'node:fs'

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    ProviderUsageClient,
    type ProviderUsageOptions,
    type ProviderUsageTransport,
} from './provider-usage-client.ts'
import {
    PROVIDER_USAGE_CONTRACT_VERSION,
    type ProviderRequestAuthorizationRequest,
    type ProviderRequestAuthorizationResult,
    type ProviderUsageRecordRequest,
    type ProviderUsageRecordResult,
} from './provider-usage-contract.ts'

type ProviderUsageContractFixture = {
    version: number
    authorizationRequest: ProviderRequestAuthorizationRequest
    authorizationResult: ProviderRequestAuthorizationResult
    usageRecordRequest: ProviderUsageRecordRequest
    usageRecordResult: ProviderUsageRecordResult
}

const providerUsageContractFixture = JSON.parse(readFileSync(
    new URL('./provider-usage-contract.fixture.json', import.meta.url),
    'utf8',
)) as ProviderUsageContractFixture

const stubTransport = (request: ProviderUsageTransport['request'] = vi.fn()): ProviderUsageTransport => ({ request })

const options = (overrides: Partial<ProviderUsageOptions> = {}): ProviderUsageOptions => ({
    enabled: true,
    requestTimeoutMs: 3000,
    denyRequestWhenAuthorizationUnavailable: true,
    ...overrides,
})

const authorizationRequest: ProviderRequestAuthorizationRequest = {
    orgId: 'org_1',
    userId: 'usr_1',
    workflowId: 'wf_1',
    model: 'OpenAI:gpt-5',
    modality: 'tokens',
    estimatedUnits: 0,
}

const usageRecord: ProviderUsageRecordRequest = {
    providerRequestId: 'req_1',
    authorizationId: 'auth_1',
    orgId: 'org_1',
    userId: 'usr_1',
    workflowId: 'wf_1',
    workflowSeq: 1,
    model: 'OpenAI:gpt-5',
    modality: 'tokens',
    measuringUnit: 'tokens',
    usage: {
        promptTokens: 100,
        completionTokens: 50,
    },
    occurredAt: '2026-01-01T00:00:00.000Z',
}

const fixtureAuthorizationRequest: ProviderRequestAuthorizationRequest = {
    orgId: 'org_1',
    userId: 'usr_1',
    workspaceId: 'workspace_1',
    workflowId: 'workflow_1',
    model: 'OpenAI:gpt-5',
    modality: 'tokens',
    estimatedUnits: 1200,
}

const fixtureAuthorizationResult: ProviderRequestAuthorizationResult = {
    authorized: true,
    authorizationId: 'authorization_1',
}

const fixtureUsageRecordRequest: ProviderUsageRecordRequest = {
    providerRequestId: 'provider_request_1',
    authorizationId: 'authorization_1',
    orgId: 'org_1',
    userId: 'usr_1',
    workspaceId: 'workspace_1',
    workflowId: 'workflow_1',
    workflowSeq: 1,
    model: 'OpenAI:gpt-5',
    modality: 'tokens',
    measuringUnit: 'tokens',
    usage: {
        promptTokens: 800,
        completionTokens: 400,
        cachedTokens: 100,
        reasoningTokens: 50,
    },
    occurredAt: '2026-01-01T00:00:00Z',
}

const fixtureUsageRecordResult: ProviderUsageRecordResult = { recorded: true }

let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => void (consoleWarnSpy = vi.spyOn(
    console,
    'warn',
).mockImplementation(() => undefined)))

afterEach(() => {
    consoleWarnSpy?.mockRestore()
    consoleWarnSpy = null
})

describe('provider usage contract fixture', () => {
    it('matches the TypeScript request and result bytes', () => {
        expect(providerUsageContractFixture.version).toBe(PROVIDER_USAGE_CONTRACT_VERSION)
        expect(JSON.stringify(providerUsageContractFixture.authorizationRequest)).toBe(JSON.stringify(fixtureAuthorizationRequest))
        expect(JSON.stringify(providerUsageContractFixture.authorizationResult)).toBe(JSON.stringify(fixtureAuthorizationResult))
        expect(JSON.stringify(providerUsageContractFixture.usageRecordRequest)).toBe(JSON.stringify(fixtureUsageRecordRequest))
        expect(JSON.stringify(providerUsageContractFixture.usageRecordResult)).toBe(JSON.stringify(fixtureUsageRecordResult))
    })
})

describe('ProviderUsageClient.authorizeRequest', () => {
    it('authorizes locally without a request when integration is disabled', async () => {
        const request = vi.fn()
        const response = await new ProviderUsageClient(
            stubTransport(request),
            options({ enabled: false }),
        ).authorizeRequest(authorizationRequest)

        expect(response).toEqual({ authorized: true })
        expect(request).not.toHaveBeenCalled()
    })

    it('uses the neutral authorization subject and reduced response', async () => {
        const request = vi.fn().mockResolvedValue({
            authorized: true,
            authorizationId: 'auth_1',
            estimatedCost: 1000,
            balance: 5000,
        })
        const response = await new ProviderUsageClient(
            stubTransport(request),
            options(),
        ).authorizeRequest(authorizationRequest)

        expect(request).toHaveBeenCalledWith(
            'metrics.provider.request.authorize',
            authorizationRequest,
            3000,
        )
        expect(response).toEqual({
            authorized: true,
            authorizationId: 'auth_1',
        })
        expect('balance' in response).toBe(false)
        expect('estimatedCost' in response).toBe(false)
    })

    it('fails closed with a neutral reason when authorization is unavailable', async () => {
        const request = vi.fn().mockRejectedValue(new Error('timeout'))
        const response = await new ProviderUsageClient(
            stubTransport(request),
            options(),
        ).authorizeRequest(authorizationRequest)

        expect(response).toEqual({
            authorized: false,
            reason: 'authorization_unavailable',
        })
    })

    it('can fail open when configured', async () => {
        const request = vi.fn().mockRejectedValue(new Error('timeout'))
        const response = await new ProviderUsageClient(
            stubTransport(request),
            options({ denyRequestWhenAuthorizationUnavailable: false }),
        ).authorizeRequest(authorizationRequest)

        expect(response).toEqual({
            authorized: true,
            reason: 'authorization_unavailable',
        })
    })
})

describe('ProviderUsageClient.recordUsage', () => {
    it('does not send a record when integration is disabled', async () => {
        const request = vi.fn()
        const response = await new ProviderUsageClient(
            stubTransport(request),
            options({ enabled: false }),
        ).recordUsage(usageRecord)

        expect(response).toBeUndefined()
        expect(request).not.toHaveBeenCalled()
    })

    it('uses the neutral recording subject and accepts only an acknowledgement', async () => {
        const request = vi.fn().mockResolvedValue({
            recorded: true,
            transferId: 'private-transfer',
        })
        const response = await new ProviderUsageClient(
            stubTransport(request),
            options(),
        ).recordUsage(usageRecord)

        expect(request).toHaveBeenCalledWith(
            'metrics.provider.usage.record',
            usageRecord,
            3000,
        )
        expect(response).toEqual({ recorded: true })
        expect('transferId' in response!).toBe(false)
    })

    it('does not discard a provider response when recording fails', async () => {
        const request = vi.fn().mockRejectedValue(new Error('nats down'))
        const client = new ProviderUsageClient(
            stubTransport(request),
            options(),
        )

        await expect(client.recordUsage(usageRecord)).resolves.toBeUndefined()
    })
})
