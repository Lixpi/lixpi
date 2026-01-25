import type { EditorView } from 'prosemirror-view'

import {
    createAiModelSelectorDropdown,
    createAiSubmitButton,
    createImageGenerationToggle
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadControls.ts'
import {
    findThreadFromDescendantPos,
    isMeaningfullyEmpty
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPositionUtils.ts'

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

export const aiUserInputNodeView = (node: any, view: EditorView, getPos: () => number | undefined) => {
    const dom = document.createElement('div')
    dom.className = 'ai-user-input-wrapper'

    const contentDOM = document.createElement('div')
    contentDOM.className = 'ai-user-input-content'

    const controls = document.createElement('div')
    controls.className = 'ai-user-input-controls'

    let currentDropdown: { dom: HTMLElement; destroy?: () => void; update?: (v: any) => void; setOptions?: (v: any) => void } | null = null
    let currentUnsubscribe: (() => void) | null = null
    let currentDropdownIdSuffix = ''

    const imageToggle = createImageGenerationToggle(view, getPos)
    const submitButton = createAiSubmitButton(view, getPos)

    const mountOrRemountDropdownIfNeeded = () => {
        const inputPos = getPos()
        const threadInfo = typeof inputPos === 'number' ? findThreadFromDescendantPos(view.state, inputPos) : null
        const threadId = threadInfo?.threadId || ''
        const nextSuffix = threadId || (typeof inputPos === 'number' ? `pos-${inputPos}` : 'unknown')

        if (nextSuffix === currentDropdownIdSuffix && currentDropdown) {
            return
        }

        // teardown
        if (currentDropdown) {
            currentDropdown.destroy?.()
            currentDropdown = null
        }
        if (currentUnsubscribe) {
            currentUnsubscribe()
            currentUnsubscribe = null
        }
        // remove old dropdown DOM if still present
        const existing = controls.querySelector('.dropdown-menu-tag-pill-wrapper')
        if (existing) {
            existing.remove()
        }

        currentDropdownIdSuffix = nextSuffix

        const { dropdown, unsubscribe } = createAiModelSelectorDropdown(view, getPos, nextSuffix)
        currentDropdown = dropdown
        currentUnsubscribe = unsubscribe
        controls.insertBefore(dropdown.dom, controls.firstChild)
    }

    mountOrRemountDropdownIfNeeded()

    controls.appendChild(imageToggle.dom)
    controls.appendChild(submitButton)

    dom.appendChild(contentDOM)
    dom.appendChild(controls)

    const syncEmptyState = (n: any) => {
        const empty = isMeaningfullyEmpty(n)
        dom.setAttribute('data-empty', String(empty))
    }

    syncEmptyState(node)

    return {
        dom,
        contentDOM,
        ignoreMutation: (mutation: MutationRecord) => {
            if (mutation.target === controls || controls.contains(mutation.target as Node)) {
                return true
            }
            return false
        },
        update: (updatedNode: any) => {
            if (updatedNode.type.name !== aiUserInputNodeType) return false
            node = updatedNode
            mountOrRemountDropdownIfNeeded()
            syncEmptyState(updatedNode)
            imageToggle.update()
            return true
        },
        destroy: () => {
            currentDropdown?.destroy?.()
            currentUnsubscribe?.()
        },
    }
}
