import { resolve } from 'path'
import {
    describe,
    expect,
    it,
} from 'vitest'
import { compileThemedStylesheet } from '@lixpi/test-utils/stylesheets'

describe('Workspace conversation stylesheet integration', () => {
    it('compiles the composer and shared transcript shell against the theme roles', async () => {
        const css = await compileThemedStylesheet(resolve(import.meta.dirname, '../composer/workspace-prompt-composer.scss'))
        const messages = css.match(/\.workspace-conversation-messages\s*\{([^}]+)\}/u)?.[1] ?? ''
        const transcript = css.match(/\.workspace-conversation-transcript \.ProseMirror\s*\{([^}]+)\}/u)?.[1] ?? ''
        expect(messages.includes('overflow-y: auto'), 'the bounded transcript must remain scrollable').toBe(true)
        expect(messages.includes('min-height: 0'), 'the transcript must shrink without compressing the input').toBe(true)
        expect(transcript.includes('background: transparent'), 'the authoritative editor must use the single conversation surface').toBe(true)
        expect(css.includes('@media (prefers-reduced-transparency: reduce)'), 'the glass surface must support reduced transparency').toBe(true)
    })
})
