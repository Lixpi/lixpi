import { getAiProviderClassSuffix, getAiProviderIcon } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiProviderIcons.ts'
import { html } from '$src/utils/domTemplates.ts'
import { settings } from '$src/settings.ts'

export type AiUserMessageShell = {
    wrapper: HTMLElement
    messageEl: HTMLElement
    referencePreviewsEl: HTMLElement
    contentEl: HTMLElement
}

export type AiResponseMessageShell = {
    wrapper: HTMLElement
    messageEl: HTMLElement
    bubbleEl: HTMLElement
    contentEl: HTMLElement
    metaEl: HTMLElement
    avatarEl: HTMLElement | null
    loadingEl: HTMLElement | null
    setMessageId: (messageId: string) => void
    setProvider: (provider: string | null | undefined, iconOverride?: string | null) => void
}

type MessageShellOptions = {
    wrapperClassName?: string
}

type ResponseMessageShellOptions = MessageShellOptions & {
    provider?: string | null
    messageId?: string
    includeLoadingIndicator?: boolean
    includeAvatar?: boolean
}

export function createAiUserMessageShell(options: MessageShellOptions = {}): AiUserMessageShell {
    const wrapperClassName = ['ai-user-message-wrapper', options.wrapperClassName].filter(Boolean).join(' ')
    const wrapper = html`
        <div className=${wrapperClassName}>
            <div className="ai-user-message">
                <div className="ai-user-message-reference-previews" contenteditable="false" hidden="true"></div>
                <div className="ai-user-message-content"></div>
            </div>
        </div>
    ` as HTMLElement

    return {
        wrapper,
        messageEl: wrapper.querySelector('.ai-user-message') as HTMLElement,
        referencePreviewsEl: wrapper.querySelector('.ai-user-message-reference-previews') as HTMLElement,
        contentEl: wrapper.querySelector('.ai-user-message-content') as HTMLElement,
    }
}

export function createAiResponseMessageShell(options: ResponseMessageShellOptions = {}): AiResponseMessageShell {
    const wrapperClassName = ['ai-response-message-wrapper', options.wrapperClassName].filter(Boolean).join(' ')
    const provider = options.provider ?? ''
    const providerIcon = getAiProviderIcon(provider)
    const loadingIndicator = options.includeLoadingIndicator === false
        ? null
        : html`<div className="ai-response-loading-spinner" aria-hidden="true"></div>`
    const avatar = options.includeAvatar === false
        ? null
        : html`<div className=${`user-avatar assistant-${getAiProviderClassSuffix(provider)}`} innerHTML=${providerIcon ?? ''}></div>`
    const wrapper = html`
        <div className=${wrapperClassName} data=${{ messageId: options.messageId ?? '' }}>
            <div className="ai-response-message">
                <div className="ai-response-message-bubble">
                    ${loadingIndicator}
                    <div className="ai-response-message-content"></div>
                </div>
            </div>
            <div className="ai-response-message-meta">
                ${avatar}
            </div>
        </div>
    ` as HTMLElement

    const bubbleEl = wrapper.querySelector('.ai-response-message-bubble') as HTMLElement
    bubbleEl.style.setProperty('--ai-response-bubble-color', settings.aiChatThread.styles.responseMessageBubbleColor)

    const setProvider = (nextProvider: string | null | undefined, iconOverride?: string | null): void => {
        const avatarEl = wrapper.querySelector('.user-avatar') as HTMLElement | null
        if (!avatarEl) return
        avatarEl.className = `user-avatar assistant-${getAiProviderClassSuffix(nextProvider)}`
        avatarEl.innerHTML = iconOverride ?? getAiProviderIcon(nextProvider) ?? ''
    }

    return {
        wrapper,
        messageEl: wrapper.querySelector('.ai-response-message') as HTMLElement,
        bubbleEl,
        contentEl: wrapper.querySelector('.ai-response-message-content') as HTMLElement,
        metaEl: wrapper.querySelector('.ai-response-message-meta') as HTMLElement,
        avatarEl: wrapper.querySelector('.user-avatar') as HTMLElement | null,
        loadingEl: wrapper.querySelector('.ai-response-loading-spinner') as HTMLElement | null,
        setMessageId: (messageId: string) => {
            wrapper.dataset.messageId = messageId
        },
        setProvider,
    }
}
