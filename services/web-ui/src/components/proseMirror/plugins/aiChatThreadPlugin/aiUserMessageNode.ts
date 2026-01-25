import { html } from '$src/utils/domTemplates.ts'
import type { EditorView, NodeView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

export const aiUserMessageNodeType = 'aiUserMessage'

function createId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const aiUserMessageNodeSpec = {
    attrs: {
        id: { default: '' },
        createdAt: { default: 0 },
    },
    content: '(paragraph | block)+',
    group: 'block',
    draggable: false,
    parseDOM: [
        {
            tag: 'div.ai-user-message',
            getAttrs(dom: HTMLElement) {
                return {
                    id: dom.getAttribute('data-id') || '',
                    createdAt: Number(dom.getAttribute('data-created-at') || 0),
                }
            },
        },
    ],
    toDOM(node: any) {
        return [
            'div',
            {
                class: 'ai-user-message',
                'data-id': node.attrs.id,
                'data-created-at': String(node.attrs.createdAt || 0),
            },
            0,
        ]
    },
}

export function createAiUserMessageNodeAttrs(): { id: string; createdAt: number } {
    return { id: createId(), createdAt: Date.now() }
}

export const aiUserMessageNodeView = (
    node: ProseMirrorNode,
    _view: EditorView,
    _getPos: () => number | undefined
): NodeView => {
    const wrapper = html`
        <div className="ai-user-message-wrapper">
            <div className="ai-user-message">
                <div className="ai-user-message-content"></div>
            </div>
        </div>
    `

    const contentDOM = wrapper.querySelector('.ai-user-message-content') as HTMLElement

    return {
        dom: wrapper,
        contentDOM,
        update: (updatedNode: ProseMirrorNode) => {
            if (updatedNode.type.name !== aiUserMessageNodeType) return false
            node = updatedNode
            return true
        },
    }
}
