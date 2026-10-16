import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthenticationFailure } from './authenticationFailure.ts'

const gradient = vi.hoisted(() => ({ destroy: vi.fn() }))
vi.mock('@lixpi/ui-primitives/gradients', () => ({ createShiftingGradientBackground: () => gradient }))

afterEach(() => {
    document.body.replaceChildren()
    vi.clearAllMocks()
})

describe('authentication failure recovery', () => {
    it('offers explicit signup and blocks both actions while a redirect is pending', async () => {
        const pending = Promise.withResolvers<void>()
        const retry = vi.fn()
        const signup = vi.fn(() => pending.promise)
        const view = new AuthenticationFailure(retry, signup)
        view.show(document.body)
        const buttons = [...document.querySelectorAll('button')]
        buttons[1].click()
        buttons[0].click()
        expect(signup).toHaveBeenCalledTimes(1)
        expect(retry).not.toHaveBeenCalled()
        expect(buttons.every(button => button.disabled)).toBe(true)
        pending.resolve()
        await vi.waitFor(() => expect(buttons.every(button => !button.disabled)).toBe(true))
        view.destroy()
        expect(gradient.destroy).toHaveBeenCalledOnce()
    })

    it('requires a button press, prevents concurrent retries and remains usable after a rejected retry', async () => {
        const pending = Promise.withResolvers<void>()
        const retry = vi.fn(() => pending.promise)
        const view = new AuthenticationFailure(retry)
        view.show(document.body)
        expect(retry).not.toHaveBeenCalled()
        const button = document.querySelector('button')!
        expect(button.textContent).toBe('Sign in again')
        button.click()
        button.click()
        expect(retry).toHaveBeenCalledTimes(1)
        expect(button.disabled).toBe(true)
        pending.reject(new Error('private provider diagnostics'))
        await vi.waitFor(() => expect(button.disabled).toBe(false))
        expect(document.body.textContent).not.toContain('private provider diagnostics')
        view.destroy()
        expect(document.body.textContent).toBe('')
    })
})
