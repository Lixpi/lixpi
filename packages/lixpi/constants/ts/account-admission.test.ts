import {
    describe,
    expect,
    it,
} from 'vitest'
import { getAccountIdentityKey } from './account-admission.ts'

describe('account identity wire keys', () => {
    it.each([
        ['issuer', 'subject', '6:issuer7:subject'],
        ['https://tenant.example/', 'auth0|123', '23:https://tenant.example/9:auth0|123'],
        ['issuer', '用户|😀', '6:issuer11:用户|😀'],
        ['a:2', 'b:c', '3:a:23:b:c'],
    ])('matches the provisioner UTF-8 key for %s and %s', (issuer, subject, expected) => void expect(getAccountIdentityKey(issuer, subject)).toBe(expected))

    it('keeps different issuer and subject boundaries distinct', () => {
        expect(getAccountIdentityKey('a', 'bc')).not.toBe(getAccountIdentityKey('ab', 'c'))
        expect(getAccountIdentityKey('issuer/', 'subject')).not.toBe(getAccountIdentityKey('issuer', '/subject'))
    })

    it('accepts the byte limit and rejects a multibyte overflow', () => {
        expect(getAccountIdentityKey('a', `${'é'.repeat(899)  }b`)).toMatch(/^1:a1799:/)
        expect(() => getAccountIdentityKey('a', 'é'.repeat(900))).toThrow('Invalid account identity')
    })

    it.each([
        ['', 'subject'],
        ['issuer', ''],
        ['issuer', '\ud800'],
        ['\udc00', 'subject'],
    ])('rejects empty or malformed Unicode identities', (issuer, subject) => void expect(() => getAccountIdentityKey(issuer, subject)).toThrow('Invalid account identity'))
})
