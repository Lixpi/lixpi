import {
    type ConversationMessageNode,
} from '@lixpi/constants'

export const containsCanvasMediaUrl = (
    fragment: ConversationMessageNode,
    url: string,
): boolean => {
    if (fragment.marks?.some(mark => mark.type === 'link' && mark.attrs?.href === url))
        return true

    const urls = fragment.text?.match(/https?:\/\/[^\s<>"']+/gu) ?? []

    if (urls.some(candidate => candidate === url || candidate.replace(/[.,;)\]]+$/u, '') === url))
        return true

    return fragment.content?.some(child => containsCanvasMediaUrl(child, url)) ?? false
}
