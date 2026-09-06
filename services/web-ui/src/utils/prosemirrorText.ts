type Node = {
    type?: string
    text?: string
    content?: Node[]
    attrs?: Record<string, unknown>
}

export const extractContentFromProseMirror = (content: string | object): {
    text: string
    imageSrcs: string[]
} => {
    try {
        const root = typeof content === 'string' ? (JSON.parse(content) as Node) : (content as Node)
        const imageSrcs: string[] = []
        const walk = (node: Node): string => {
            if (
                node.type === 'image'
                && typeof node.attrs?.src === 'string'
            )
                imageSrcs.push(node.attrs.src)

            if (node.type === 'text')
                return node.text ?? ''

            const text = (node.content ?? []).map(walk).join('')

            return ['paragraph', 'heading', 'blockquote', 'list_item'].includes(node.type ?? '') ? `${text}\n` : text
        }

        return {
            text: walk(root).trim(),
            imageSrcs,
        }
    } catch {
        return {
            text: '',
            imageSrcs: [],
        }
    }
}
