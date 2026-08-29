'use strict'

// Intro splash shown on the workspace shell when no workspace route is active.
// Renderer: TypeScript `html` DOM, so it needs no framework runtime.

import { html } from '$src/utils/domTemplates.ts'
import { aiRobotFaceIcon } from '@lixpi/ui-kit/svg'
import '$src/components/intro-page.scss'

export type IntroPageInstance = {
    el: HTMLElement
    destroy: () => void
}

export const createIntroPage = (): IntroPageInstance => {
    const el = html`
        <div className="intro-page">
            <div className="intro-message-container">
                <div className="intro-message">
                    <h1>I am <span className="accent">AI</span><span className="masked">...</span></h1>
                </div>
                <div className="intro-icon" innerHTML=${aiRobotFaceIcon}></div>
            </div>
        </div>
    ` as HTMLElement

    return {
        el,
        destroy: () => el.remove(),
    }
}
