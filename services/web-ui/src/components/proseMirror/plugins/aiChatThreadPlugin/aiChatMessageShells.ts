import { html } from '@lixpi/ui-primitives/dom'

export type AiUserMessageShell = {
    wrapper: HTMLElement
    messageEl: HTMLElement
    referencePreviewsEl: HTMLElement
    contentEl: HTMLElement
}

export type AiResponseMessageShell = {
    wrapper: HTMLElement
    messageEl: HTMLElement
    contentEl: HTMLElement
    loadingEl: HTMLElement | null
    capabilityProgressEl: HTMLElement
    setMessageId: (messageId: string) => void
}

type MessageShellOptions = {
    wrapperClassName?: string
}

type ResponseMessageShellOptions = MessageShellOptions & {
    messageId?: string
    includeLoadingIndicator?: boolean
}

export const createAiUserMessageShell = (options: MessageShellOptions = {}): AiUserMessageShell => {
    const wrapperClassName = ['ai-user-message-wrapper', options.wrapperClassName].filter(Boolean).join(' ')
    const wrapper = html`
        <div className=${wrapperClassName}>
            <div
                className="ai-user-message-reference-previews"
                contenteditable="false"
                hidden="true"
            ></div>
            <div className="ai-user-message">
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

export const createAiResponseMessageShell = (options: ResponseMessageShellOptions = {}): AiResponseMessageShell => {
    const wrapperClassName = ['ai-response-message-wrapper', options.wrapperClassName].filter(Boolean).join(' ')
    const loadingIndicator = options.includeLoadingIndicator === false
        ? null
        : html`<div
                className="ai-response-loading-spinner"
                aria-hidden="true"
            ></div>`
    const wrapper = html`
        <div
            className=${wrapperClassName}
            data=${{ messageId: options.messageId ?? '' }}
        >
            <div className="ai-response-message">
                ${loadingIndicator}
                <div className="ai-response-message-content"></div>
                <div
                    className="ai-response-capability-progress"
                    contenteditable="false"
                ></div>
            </div>
        </div>
    ` as HTMLElement

    return {
        wrapper,
        messageEl: wrapper.querySelector('.ai-response-message') as HTMLElement,
        contentEl: wrapper.querySelector('.ai-response-message-content') as HTMLElement,
        loadingEl: wrapper.querySelector('.ai-response-loading-spinner') as HTMLElement | null,
        capabilityProgressEl: wrapper.querySelector('.ai-response-capability-progress') as HTMLElement,
        setMessageId: (messageId: string) => void (wrapper.dataset.messageId = messageId),
    }
}
