import { getNatsUserSubjectToken } from '@lixpi/constants'
import {
    type AuthClientInstance,
} from '@lixpi/auth-client'
import {
    type default as NatsService,
} from '@lixpi/nats-service'

export class OnboardingUnavailable extends Error {}

// The account service owns setup requirements. The browser follows its result.
export class OnboardingService {
    constructor(
        private readonly auth: AuthClientInstance,
        private readonly nats: Pick<NatsService, 'request'>,
        private readonly portalUrl: string,
        private readonly navigate = (url: string): void => void window.location.replace(url),
    ) {}

    async enterWorkspace(): Promise<boolean> {
        try {
            const organizationId = this.auth.userStore.getData('organizations')[0]
            const userId = this.auth.userStore.getData('userId')
            const token = await this.auth.getTokenSilently()

            if (
                !organizationId
                || !userId
                || !token
            )
                throw new OnboardingUnavailable()

            const state = await this.nats.request<Record<string, string>, {
                organizationId: string
                complete: boolean
            }>(
                `portal.module.account.${getNatsUserSubjectToken(userId)}.request.onboarding.get`,
                {
                    organizationId,
                    token,
                },
            )

            if (
                !state
                || state.organizationId !== organizationId
                || typeof state.complete !== 'boolean'
            )
                throw new OnboardingUnavailable()

            if (state.complete)
                return true

            const destination = new URL('/onboarding', this.portalUrl)

            if (
                destination.username
                || destination.password
                || (destination.protocol !== 'https:' && !(destination.protocol === 'http:' && destination.hostname === 'localhost'))
            )
                throw new OnboardingUnavailable()

            destination.searchParams.set('organization', organizationId)
            this.navigate(
                this.auth.createSessionHandoffUrl(destination.href),
            )

            return false
        } catch {
            throw new OnboardingUnavailable('Account setup could not be checked')
        }
    }
}
