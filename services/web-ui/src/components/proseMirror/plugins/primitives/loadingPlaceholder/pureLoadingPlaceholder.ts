// @ts-nocheck
import { html } from '$src/utils/domTemplates.ts'

type LoadingPlaceholderConfig = {
    size?: 'small' | 'medium' | 'large'
    withOverlay?: boolean
    theme?: 'light' | 'dark'
    className?: string
}

type ErrorPlaceholderConfig = {
    message?: string
    retryLabel?: string
    onRetry?: () => void
    withOverlay?: boolean
    theme?: 'light' | 'dark'
    className?: string
}

export function createLoadingPlaceholder(config: LoadingPlaceholderConfig = {}) {
    const {
        size = 'medium',
        withOverlay = true,
        theme = 'light',
        className = ''
    } = config

    const sizeClass = `size-${size}`
    const overlayClass = withOverlay ? 'with-overlay' : ''
    const themeClass = `theme-${theme}`

    // Create the loading placeholder DOM structure
    const dom = html`
        <div class="loading-placeholder ${sizeClass} ${overlayClass} ${themeClass} ${className}">
            <span class="loader"></span>
        </div>
    ` as HTMLElement

    // Public API
    return {
        dom,
        show() {
            dom.style.display = 'flex'
        },
        hide() {
            dom.style.display = 'none'
        },
        destroy() {
            dom.remove()
        }
    }
}

export function createErrorPlaceholder(config: ErrorPlaceholderConfig = {}) {
    const {
        message = 'Failed to load content',
        retryLabel = 'Retry',
        onRetry,
        withOverlay = true,
        theme = 'light',
        className = ''
    } = config

    const overlayClass = withOverlay ? 'with-overlay' : ''
    const themeClass = `theme-${theme}`

    // Create the error placeholder DOM structure
    const dom = html`
        <div class="loading-placeholder error-state ${overlayClass} ${themeClass} ${className}">
            <div class="error-content">
                <span class="error-message">${message}</span>
                <button class="retry-button" type="button">${retryLabel}</button>
            </div>
        </div>
    ` as HTMLElement

    // Wire up retry button
    const retryButton = dom.querySelector('.retry-button') as HTMLButtonElement
    if (retryButton && onRetry) {
        retryButton.addEventListener('click', onRetry)
    }

    // Public API
    return {
        dom,
        show() {
            dom.style.display = 'flex'
        },
        hide() {
            dom.style.display = 'none'
        },
        setMessage(newMessage: string) {
            const messageEl = dom.querySelector('.error-message')
            if (messageEl) {
                messageEl.textContent = newMessage
            }
        },
        destroy() {
            if (retryButton && onRetry) {
                retryButton.removeEventListener('click', onRetry)
            }
            dom.remove()
        }
    }
}
