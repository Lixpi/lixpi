import { describe, expect, it } from 'vitest'
import { createAiResponseMessageShell } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatMessageShells.ts'
import { settings } from '$src/settings.ts'

describe('aiResponseMessageShell', () => {
    it('applies the response bubble color setting to the bubble style', () => {
        const shell = createAiResponseMessageShell()

        expect(shell.bubbleEl.style.getPropertyValue('--ai-response-bubble-color')).toBe(settings.aiChatThread.styles.responseMessageBubbleColor)
    })

    it('reads the response bubble color from settings when the shell is created', () => {
        const previousColor = settings.aiChatThread.styles.responseMessageBubbleColor
        settings.aiChatThread.styles.responseMessageBubbleColor = '#abcdef'

        try {
            const shell = createAiResponseMessageShell()

            expect(shell.bubbleEl.style.getPropertyValue('--ai-response-bubble-color')).toBe('#abcdef')
        } finally {
            settings.aiChatThread.styles.responseMessageBubbleColor = previousColor
        }
    })

    it('renders the ring loading indicator by default', () => {
        const shell = createAiResponseMessageShell()

        expect(shell.loadingEl).not.toBeNull()
        expect(shell.loadingEl!.className).toBe('ai-response-loading-spinner')
        expect(shell.wrapper.querySelector(`.${['ai-response', 'message', 'spinner'].join('-')}`)).toBeNull()
    })

    it('supports wrapper class, message id updates, and optional loading indicator removal', () => {
        const shell = createAiResponseMessageShell({
            wrapperClassName: 'custom-shell',
            messageId: 'message-1',
            includeLoadingIndicator: false,
        })

        expect(shell.wrapper.classList.contains('custom-shell')).toBe(true)
        expect(shell.wrapper.dataset.messageId).toBe('message-1')
        expect(shell.loadingEl).toBeNull()

        shell.setMessageId('message-2')
        expect(shell.wrapper.dataset.messageId).toBe('message-2')
    })

    it('supports runtime provider updates with optional icon override', () => {
        const shell = createAiResponseMessageShell()
        const defaultClass = shell.avatarEl.className

        expect(defaultClass).toContain('assistant-unknown')
        shell.setProvider('OpenAI')
        expect(shell.avatarEl.className).toContain('assistant-openai')

        const overrideIcon = '<span data-test="custom-avatar"></span>'
        shell.setProvider('Anthropic', overrideIcon)
        expect(shell.avatarEl.className).toContain('assistant-anthropic')
        expect(shell.avatarEl.innerHTML).toBe(overrideIcon)
    })
})
