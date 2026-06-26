'use strict'

import { describe, it, expect, vi } from 'vitest'

import { projectBalanceChange, type AllowanceProjectionDeps } from './allowance-projection.ts'
import type { BalanceChanged } from './contracts.ts'

const ev: BalanceChanged = {
    orgId: 'org_1',
    balance: 1_000_000,
    currency: 'USD',
    allowed: { chat_text: true, chat_image: true, chat_video: false },
    reason: 'ai_charge',
    transferId: 'req_1',
    at: '2026-01-01T00:00:00.000Z',
}

function deps(over: Partial<AllowanceProjectionDeps> = {}): AllowanceProjectionDeps {
    return {
        getOrganizationMembers: vi.fn(async () => ['usr_1']),
        setUserAllowance: vi.fn(async () => {}),
        ...over,
    }
}

describe('projectBalanceChange', () => {
    it('writes the allowance + balance onto each org member', async () => {
        const getOrganizationMembers = vi.fn(async () => ['usr_1', 'usr_2'])
        const setUserAllowance = vi.fn(async () => {})
        await projectBalanceChange(ev, deps({ getOrganizationMembers, setUserAllowance }))

        expect(getOrganizationMembers).toHaveBeenCalledWith('org_1')
        expect(setUserAllowance).toHaveBeenCalledTimes(2)
        expect(setUserAllowance).toHaveBeenCalledWith({
            userId: 'usr_1',
            allowed: ev.allowed,
            balance: ev.balance,
        })
        expect(setUserAllowance).toHaveBeenCalledWith({
            userId: 'usr_2',
            allowed: ev.allowed,
            balance: ev.balance,
        })
    })

    it('is a no-op when the event has no orgId', async () => {
        const getOrganizationMembers = vi.fn(async () => ['usr_1'])
        await projectBalanceChange({ ...ev, orgId: '' }, deps({ getOrganizationMembers }))
        expect(getOrganizationMembers).not.toHaveBeenCalled()
    })

    it('does nothing when the org has no members', async () => {
        const setUserAllowance = vi.fn(async () => {})
        await projectBalanceChange(ev, deps({ getOrganizationMembers: vi.fn(async () => []), setUserAllowance }))
        expect(setUserAllowance).not.toHaveBeenCalled()
    })
})
