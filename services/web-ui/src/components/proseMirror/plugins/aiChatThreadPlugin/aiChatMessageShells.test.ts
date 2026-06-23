import { describe, expect, it } from 'vitest'
import { createAiResponseMessageShell } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatMessageShells.ts'

describe('aiResponseMessageShell', () => {
	it('renders shell structure with wrapper, message shell, and content slots', () => {
		const shell = createAiResponseMessageShell()

		expect(shell.wrapper.className).toBe('ai-response-message-wrapper')
		expect(shell.messageEl.className).toBe('ai-response-message')
		expect(shell.contentEl.className).toBe('ai-response-message-content')
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
})
