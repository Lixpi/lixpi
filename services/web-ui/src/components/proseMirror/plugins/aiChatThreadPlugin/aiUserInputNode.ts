export const aiUserInputNodeType = 'aiUserInput'

export const aiUserInputNodeSpec = {
    content: '(paragraph | block)+',
    group: 'block',
    draggable: false,
    selectable: false,
    isolating: true,
    parseDOM: [
        {
            tag: 'div.ai-user-input-wrapper',
        },
    ],
    toDOM() {
        return [
            'div',
            {
                class: 'ai-user-input-wrapper',
            },
            0,
        ]
    },
}
