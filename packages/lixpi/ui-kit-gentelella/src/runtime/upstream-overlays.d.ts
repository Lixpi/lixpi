// Gentelella 4.2 declares these as module augmentations without a base declaration.
// Keep the focused runtime imports typed without loading its global JS entrypoint.
declare module 'gentelella/v4/modal' {
    export type ModalHandle = {
        dialog: HTMLElement
        body: HTMLElement
        close: () => void
    }

    export type ModalActionContext = ModalHandle

    export type ModalAction = {
        label: string
        variant?: 'primary' | 'outline' | 'danger' | 'ghost'
        action?: (context: ModalHandle) => unknown
        closeOnAction?: boolean
    }

    export type ModalOptions = {
        title?: string
        body?: string | HTMLElement
        actions?: ModalAction[]
        size?: 'sm' | 'md' | 'lg'
        onClose?: () => void
    }

    export function showModal(options?: ModalOptions): ModalHandle
    export function closeModal(options?: { skipHook?: boolean }): void
    export function isModalOpen(): boolean
}

declare module 'gentelella/v4/menus' {
    export type MenuItem = {
        label: string
        action?: (trigger: HTMLElement | null) => void
    }

    export type MenuEntry = MenuItem | '-'

    export function openMenu(
        trigger: HTMLElement,
        items: MenuEntry[],
    ): void
    export function openPanel(
        trigger: HTMLElement,
        content: HTMLElement | string,
        options?: {
            className?: string
            width?: number
        },
    ): void
    export function closeMenu(): void
    export const DEFAULT_CARD_MENU: readonly MenuEntry[]
}

declare module 'gentelella/v4/toast' {
    export type ToastOptions = {
        variant?: 'default' | 'success' | 'error' | 'info' | 'warning'
        duration?: number
    }

    export function showToast(
        message: string,
        options?: ToastOptions,
    ): HTMLDivElement
}
