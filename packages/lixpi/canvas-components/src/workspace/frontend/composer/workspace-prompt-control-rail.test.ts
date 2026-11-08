// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { WorkspacePromptControlRail } from './workspace-prompt-control-rail.ts'

describe('WorkspacePromptControlRail ownership', () => {
    it('replaces borrowed controls and rejects late mounts after destruction', () => {
        const rail = new WorkspacePromptControlRail({ document })
        const mediaControl = document.createElement('button')
        const replacement = document.createElement('button')
        const modelControl = document.createElement('button')
        const lateControl = document.createElement('button')

        rail.mountMediaModeSwitch(mediaControl)
        rail.mountModelMenuControl(modelControl)
        expect(rail.mediaModeSwitchMount.firstElementChild).toBe(mediaControl)
        expect(rail.modelMenuControlMount.firstElementChild).toBe(modelControl)

        rail.mountMediaModeSwitch(replacement)
        expect(rail.mediaModeSwitchMount.firstElementChild).toBe(replacement)
        expect(mediaControl.parentElement).toBeNull()

        rail.destroy()
        rail.mountMediaModeSwitch(lateControl)
        rail.mountModelMenuControl(document.createElement('button'))

        expect(rail.element.parentElement).toBeNull()
        expect(lateControl.parentElement).toBeNull()
        expect(replacement.parentElement).toBe(rail.mediaModeSwitchMount)
        expect(modelControl.parentElement).toBe(rail.modelMenuControlMount)
    })
})
