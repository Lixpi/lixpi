import { describe, expect, it, vi } from 'vitest'
import { OnboardingService, OnboardingUnavailable } from './onboarding-service.ts'

describe('OnboardingService', () => {
    const setup = (response: unknown) => {
        const navigate = vi.fn()
        const request = vi.fn().mockResolvedValue(response)
        const service = new OnboardingService({
            userStore: { getData: (key: string) => key === 'userId' ? 'auth0|owner' : ['org-1'] },
            getTokenSilently: async () => 'token',
        } as never, { request } as never, 'http://localhost:3002', navigate)

        return {
            service,
            request,
            navigate,
        }
    }

    it('redirects incomplete setup to the configured portal without sending the token in the URL', async () => {
        const {
            service,
            navigate,
        } = setup({
            organizationId: 'org-1',
            complete: false,
        })
        await expect(service.enterWorkspace()).resolves.toBe(false)
        expect(navigate).toHaveBeenCalledWith('http://localhost:3002/onboarding?organization=org-1')
    })

    it('admits completed free onboarding without checking for a payment', async () => {
        const {
            service,
            navigate,
        } = setup({
            organizationId: 'org-1',
            complete: true,
            choice: 'free',
        })
        await expect(service.enterWorkspace()).resolves.toBe(true)
        expect(navigate).not.toHaveBeenCalled()
    })

    it.each([null, { error: 'unavailable' }, {
        organizationId: 'other',
        complete: true,
    }])('rejects an unavailable or unrelated result', async response => {
        const {
            service,
            navigate,
        } = setup(response)
        await expect(service.enterWorkspace()).rejects.toBeInstanceOf(OnboardingUnavailable)
        expect(navigate).not.toHaveBeenCalled()
    })
})
