import { describe, expect, it } from 'vitest'
import { createSessionHandoffUrl, createSessionAccountHint, matchesSessionAccount } from './sessionHandoff.ts'

describe('application session handoff', () => {
    it('preserves the configured destination without putting identity or credentials in the URL', () => void expect(createSessionHandoffUrl('https://portal.lixpi.test/onboarding?organization=one#setup')).toBe('https://portal.lixpi.test/onboarding?organization=one&auth=continue#setup'))

    it.each(['javascript:alert(1)', 'https://user:password@portal.lixpi.test', 'data:text/html,hello'])('rejects an unsafe destination: %s', destination => void expect(() => createSessionHandoffUrl(destination)).toThrow('Invalid application destination'))

    it('uses a different salted hint for each session and compares only the account', async () => {
        const accountHint = await createSessionAccountHint('email|same-user')
        expect(await createSessionAccountHint('email|same-user')).not.toBe(accountHint)
        await expect(matchesSessionAccount({ accountHint }, 'email|same-user')).resolves.toBe(true)
        await expect(matchesSessionAccount({ accountHint }, 'google-oauth2|other-user')).resolves.toBe(false)
        const destination = createSessionHandoffUrl('https://portal.lixpi.test', accountHint)
        expect(destination).not.toContain('same-user')
        expect(new URL(destination).searchParams.get('auth_account')).toBe(accountHint)
    })
})
