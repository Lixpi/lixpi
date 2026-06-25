import { describe, expect, it } from 'vitest'
import {
	createAiResponseMessageShell,
	createAiUserMessageShell,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatMessageShells.ts'

// =============================================================================
// aiUserMessageShell — reference previews live outside the message bubble
// =============================================================================

describe('aiUserMessageShell', () => {
	it('renders shell structure with wrapper, message shell, previews, and content slots', () => {
		const shell = createAiUserMessageShell()

		expect(shell.wrapper.className).toBe('ai-user-message-wrapper')
		expect(shell.messageEl.className).toBe('ai-user-message')
		expect(shell.referencePreviewsEl.className).toBe('ai-user-message-reference-previews')
		expect(shell.contentEl.className).toBe('ai-user-message-content')
	})

	it('renders reference previews outside the message bubble', () => {
		const shell = createAiUserMessageShell()

		expect(shell.messageEl.contains(shell.referencePreviewsEl)).toBe(false)
		expect(shell.wrapper.contains(shell.referencePreviewsEl)).toBe(true)
	})

	it('positions reference previews above the message bubble', () => {
		const shell = createAiUserMessageShell()
		const children = Array.from(shell.wrapper.children)

		expect(children.indexOf(shell.referencePreviewsEl))
			.toBeLessThan(children.indexOf(shell.messageEl))
	})

	it('keeps the content slot inside the message bubble', () => {
		const shell = createAiUserMessageShell()

		expect(shell.messageEl.contains(shell.contentEl)).toBe(true)
	})

	it('hides the reference previews container by default', () => {
		const shell = createAiUserMessageShell()

		expect(shell.referencePreviewsEl.hidden).toBe(true)
	})

	it('supports a custom wrapper class', () => {
		const shell = createAiUserMessageShell({ wrapperClassName: 'custom-user-shell' })

		expect(shell.wrapper.classList.contains('ai-user-message-wrapper')).toBe(true)
		expect(shell.wrapper.classList.contains('custom-user-shell')).toBe(true)
	})
})

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
