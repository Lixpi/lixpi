import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const mocks = vi.hoisted(() => ({
    createLayout: vi.fn(),
    layoutDestroy: vi.fn(),
    tooltipDestroy: vi.fn(),
}))

vi.mock('$src/views/layouts/layout.ts', () => ({ createLayout: mocks.createLayout }))
vi.mock('@lixpi/ui-kit/components/help-tooltip', () => ({
    createHelpTooltipProvider: () => ({ destroy: mocks.tooltipDestroy }),
}))

import { mountApp } from './app.ts'

beforeEach(() => {
    vi.resetAllMocks()
    mocks.createLayout.mockImplementation(() => ({ el: document.createElement('main'), destroy: mocks.layoutDestroy }))
})

describe('application canvas session shutdown', () => {
    it('disposes views before awaiting session close and shares repeated destroy calls', async () => {
        const closed = Promise.withResolvers<void>()
        const close = vi.fn(() => {
            expect(mocks.layoutDestroy).toHaveBeenCalledTimes(1)
            return closed.promise
        })
        const application = mountApp(document.createElement('div'), close)
        const first = application.destroy()
        expect(application.destroy()).toBe(first)
        await Promise.resolve()
        expect(close).toHaveBeenCalledTimes(1)
        expect(mocks.tooltipDestroy).toHaveBeenCalledTimes(1)
        closed.resolve()
        await first
    })

    it('closes sessions even if both view and tooltip cleanup fail', async () => {
        mocks.layoutDestroy.mockImplementation(() => {
            throw new Error('layout failed')
        })
        mocks.tooltipDestroy.mockImplementation(() => {
            throw new Error('tooltip failed')
        })
        const close = vi.fn(async () => {
            throw new Error('save failed')
        })
        const application = mountApp(document.createElement('div'), close)
        const [outcome] = await Promise.allSettled([application.destroy()])
        expect(close).toHaveBeenCalledTimes(1)
        expect(outcome.status).toBe('rejected')
        if (outcome.status !== 'rejected') throw new Error('Expected cleanup failure')
        expect(outcome.reason).toBeInstanceOf(AggregateError)
        expect(outcome.reason.errors.map((error: Error) => error.message)).toEqual(['layout failed', 'tooltip failed', 'save failed'])
    })

    it('releases the tooltip provider when layout mounting fails', () => {
        mocks.createLayout.mockImplementation(() => {
            throw new Error('mount failed')
        })
        expect(() => mountApp(document.createElement('div'), async () => {})).toThrow('Application mount failed: mount failed')
        expect(mocks.tooltipDestroy).toHaveBeenCalledTimes(1)
    })

    it('releases a created layout when attaching its root fails', () => {
        const root = document.createElement('div')
        vi.spyOn(root, 'append').mockImplementation(() => {
            throw new Error('attach failed')
        })
        expect(() => mountApp(root, async () => {})).toThrow('Application mount failed: attach failed')
        expect(mocks.layoutDestroy).toHaveBeenCalledTimes(1)
        expect(mocks.tooltipDestroy).toHaveBeenCalledTimes(1)
    })
})
