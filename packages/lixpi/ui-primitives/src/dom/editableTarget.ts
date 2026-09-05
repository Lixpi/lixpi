export const isEditableTarget = (target: EventTarget | null): boolean => {
    if (
        !target
        || !('nodeType' in target)
        || target.nodeType !== 1
    )
        return false

    const element = target as Element

    if (element.closest('input, textarea, select'))
        return true

    const editable = element.closest('[contenteditable]')

    return editable !== null && editable.getAttribute('contenteditable') !== 'false'
}
