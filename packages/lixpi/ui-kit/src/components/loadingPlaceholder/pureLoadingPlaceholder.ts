import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    createButton,
    type ButtonInstance,
} from '../button/button.ts'

type PlaceholderConfig = {
    document?: Document
    withOverlay?: boolean
    theme?: 'light' | 'dark'
    className?: string
}

export type ErrorPlaceholderConfig = PlaceholderConfig & {
    message?: string
    retryLabel?: string
    onRetry?: () => void
}

type PlaceholderInstance = {
    readonly dom: HTMLElement
    show: () => void
    hide: () => void
    destroy: () => void
}

export type ErrorPlaceholderInstance = PlaceholderInstance & { setMessage: (message: string) => void }

const classes = (config: PlaceholderConfig): string =>
    `loading-placeholder ${config.withOverlay !== false ? 'with-overlay' : ''} theme-${config.theme ?? 'light'} ${config.className ?? ''}`

class ErrorPlaceholder implements ErrorPlaceholderInstance {
    readonly dom: HTMLElement
    private readonly message: HTMLElement
    private readonly retryButton: ButtonInstance

    constructor(private readonly config: ErrorPlaceholderConfig) {
        const html = createDocumentHtml(config.document ?? document)
        this.retryButton = createButton({
            label: config.retryLabel ?? 'Retry',
            variant: 'primary',
            className: 'retry-button',
            document: config.document,
            onClick: () => this.config.onRetry?.(),
        })
        this.dom = html`
            <div
                className=${`${classes(config)} error-state`}
                role="alert"
            >
            <div className="error-content">
                <span className="error-message">${config.message ?? 'Failed to load content'}</span>
                ${this.retryButton.element}
            </div>
        </div>
        ` as HTMLElement
        this.message = this.dom.querySelector('.error-message')!
    }

    show(): void {
        this.dom.style.display = 'flex'
    }
    hide(): void {
        this.dom.style.display = 'none'
    }
    setMessage(message: string): void {
        this.message.textContent = message
    }
    destroy(): void {
        this.retryButton.destroy()
        this.dom.remove()
    }
}

export const createErrorPlaceholder = (config: ErrorPlaceholderConfig = {}): ErrorPlaceholderInstance => new ErrorPlaceholder(config)
