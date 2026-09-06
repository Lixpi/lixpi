import {
    parseProseMirrorJsonContent,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror'

export const collectDocumentText = (doc: object): string => {
    const root = parseProseMirrorJsonContent(doc)

    if (!root)
        return ''

    const parts: string[] = []
    const visit = (node: ProseMirrorJsonNode): void => {
        if (
            node.type === 'text'
            && node.text
        )
            parts.push(node.text)
        else if (
            node.type === 'hard_break'
            || node.type === 'paragraph'
        )
            parts.push('\n')

        for (const child of node.content ?? [])
            visit(child)
    }
    visit(root)

    return parts
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}
