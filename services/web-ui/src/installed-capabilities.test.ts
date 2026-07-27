'use strict'

import { describe, expect, it, vi } from 'vitest'

import {
    actionTimelineFrontendDefinition,
} from '@lixpi/capability-system/frontend'

import { createInstalledCapabilityControls } from './installed-capabilities.ts'

describe('installed Action Timeline frontend', () => {
    it('registers a complete package-owned Artifact frontend definition', () => {
        expect(actionTimelineFrontendDefinition).toMatchObject({
            artifactTypeId: 'action-timeline',
            createCanvasNodeView: expect.any(Function),
            createGeneratedOutputInfoView: expect.any(Function),
            createPromptReferenceView: expect.any(Function),
            createLibraryItemView: expect.any(Function),
        })
        expect(actionTimelineFrontendDefinition.createPromptControls).toBeUndefined()
    })

    it('does not mount a parameter form for the Action Timeline module chip', () => {
        const container = document.createElement('div')
        const setCapabilityInputs = vi.fn()
        const setValidity = vi.fn()
        const controls = createInstalledCapabilityControls({
            container,
            getModuleIds: () => ['action-timeline'],
            getPromptText: () => 'Build a 15-second action timeline with 3-second beats.',
            getCapabilityInputs: () => ({}),
            setCapabilityInputs,
            setValidity,
        })
        controls.update()

        expect(container.childElementCount).toBe(0)
        expect(setCapabilityInputs).not.toHaveBeenCalled()
        expect(setValidity).not.toHaveBeenCalled()
        controls.destroy()
    })
})
