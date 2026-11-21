import {
    createButton,
    type ButtonVariant,
} from '@lixpi/ui-kit/components/button'
import { createTextInput } from '@lixpi/ui-kit/components/text-input'

type LibraryButtonOptions = {
    label: string
    // Placement and lookup hook. The look is always the shared Button.
    className: string
    variant?: ButtonVariant
    action?: string
}

// Library panels place shared buttons inside the side panel. Each one opts out
// of the panel's swipe gesture and can carry the action its row handler reads.
export const createLibraryButton = (
    document: Document,
    options: LibraryButtonOptions,
): HTMLButtonElement => {
    const button = createButton({
        label: options.label,
        variant: options.variant,
        className: options.className,
        document,
    }).element
    button.dataset.sidePanelNoDrag = 'true'

    if (options.action)
        button.dataset.action = options.action

    return button
}

export const createLibraryTitleInput = (document: Document): HTMLInputElement =>
    createTextInput({
        ariaLabel: 'Title',
        className: 'media-library-detail-title',
        document,
    }).element
