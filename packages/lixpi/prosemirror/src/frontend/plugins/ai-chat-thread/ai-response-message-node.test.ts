// @vitest-environment happy-dom
import {
    describe,
    it,
    expect,
    vi,
} from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'


import { applyStyle } from '@lixpi/ui-primitives/dom'
import {
    doc,
    p,
    response,
    thread,
    schema,
    createEditorState,
} from '@lixpi/prosemirror/test-helpers'
import {
    aiResponseMessageNodeSpec,
    aiResponseMessageNodeView,
} from './ai-response-message-node.ts'
import { withoutLayout } from '@lixpi/test-utils'

const loadScss = (): string => {
    return readFileSync(
        resolve(import.meta.dirname, './chat-thread.scss'),
        'utf-8',
    )
}

const loadSource = (filename: string): string => {
    return readFileSync(
        resolve(import.meta.dirname, filename),
        'utf-8',
    )
}

const loadAnimationsScss = (): string => {
    return readFileSync(
        resolve(import.meta.dirname, './chat-animations.scss'),
        'utf-8',
    )
}

const expectSourceToContain = (source: string, snippet: string, label = 'source excerpt'): void => {
    expect(
        withoutLayout(source).includes(withoutLayout(snippet)),
        `${label} should contain:\n${snippet}`,
    ).toBe(true)
}

const expectSourceNotToContain = (source: string, snippet: string, label = 'source excerpt'): void => {
    expect(
        withoutLayout(source).includes(withoutLayout(snippet)),
        `${label} should not contain:\n${snippet}`,
    ).toBe(false)
}

// =============================================================================
// aiResponseMessage — id attribute
// =============================================================================

describe('aiResponseMessage — id attribute', () => {
    it('stores the id attribute from node creation', () => {
        const responseNode = response({ id: 'msg-abc-123' }, p('Hello from AI'))
        const state = createEditorState(doc(thread(responseNode)))

        let found = false
        state.doc.descendants((node) => {
            if (node.type.name === 'aiResponseMessage') {
                expect(node.attrs.id).toBe('msg-abc-123')
                found = true
            }
        })
        expect(found).toBe(true)
    })

    it('defaults to empty string when id is not provided', () => {
        const responseNode = response(p('Hello from AI'))
        const state = createEditorState(doc(thread(responseNode)))

        let found = false
        state.doc.descendants((node) => {
            if (node.type.name === 'aiResponseMessage') {
                expect(node.attrs.id).toBe('')
                found = true
            }
        })
        expect(found).toBe(true)
    })

    it('serializes id into the DOM output', () => {
        const responseNode = response({ id: 'msg-unique-42' }, p('Test content'))
        const state = createEditorState(doc(thread(responseNode)))

        let targetNode = null as any
        state.doc.descendants((node) => {
            if (node.type.name === 'aiResponseMessage')
                targetNode = node
        })

        expect(targetNode).not.toBeNull()

        // Use ProseMirror's toDOM spec to check the serialized attrs
        const domOutput = targetNode.type.spec.toDOM(targetNode)

        // toDOM returns ['div', { id: ..., ... }, 0]
        expect(domOutput[0]).toBe('div')
        expect(domOutput[1].id).toBe('msg-unique-42')
    })
})

// =============================================================================
// aiResponseMessage — toDOM spec validation
// =============================================================================

describe('aiResponseMessage — toDOM spec', () => {
    it('produces a div with ai-response-message class', () => {
        const responseNode = response({
            id: 'msg-1',
            aiProvider: 'OpenAI',
        }, p('content'))
        const state = createEditorState(doc(thread(responseNode)))

        let targetNode = null as any
        state.doc.descendants((node) => {
            if (node.type.name === 'aiResponseMessage')
                targetNode = node
        })

        const domOutput = targetNode.type.spec.toDOM(targetNode)
        expect(domOutput[1].class).toBe('ai-response-message')
    })

    it('includes data-ai-provider attribute in serialized DOM', () => {
        const responseNode = response({
            id: 'msg-1',
            aiProvider: 'Anthropic',
        }, p('content'))
        const state = createEditorState(doc(thread(responseNode)))

        let targetNode = null as any
        state.doc.descendants((node) => {
            if (node.type.name === 'aiResponseMessage')
                targetNode = node
        })

        const domOutput = targetNode.type.spec.toDOM(targetNode)
        expect(domOutput[1]['data-ai-provider']).toBe('Anthropic')
    })

    it('content placeholder is 0 for ProseMirror to render children', () => {
        const responseNode = response({ id: 'msg-1' }, p('content'))
        const state = createEditorState(doc(thread(responseNode)))

        let targetNode = null as any
        state.doc.descendants((node) => {
            if (node.type.name === 'aiResponseMessage')
                targetNode = node
        })

        const domOutput = targetNode.type.spec.toDOM(targetNode)
        expect(domOutput[2]).toBe(0)
    })
})

// =============================================================================
// aiResponseMessage — parseDOM spec validation
// =============================================================================

describe('aiResponseMessage — parseDOM spec', () => {
    it('parses from div.ai-response-message', () => {
        const parseRule = aiResponseMessageNodeSpec.parseDOM[0]
        expect(parseRule.tag).toBe('div.ai-response-message')
    })

    it('extracts id, style, and aiProvider from DOM attributes', () => {
        const parseRule = aiResponseMessageNodeSpec.parseDOM[0]

        const mockDom = {
            getAttribute: (attr: string) => {
                const attrs: Record<string, string> = {
                    id: 'msg-parsed-123',
                    style: 'color: red',
                    'data-ai-provider': 'OpenAI',
                }

                return attrs[attr] ?? null
            },
        }

        const parsed = parseRule.getAttrs(mockDom)
        expect(parsed).toEqual({
            id: 'msg-parsed-123',
            style: 'color: red',
            aiProvider: 'OpenAI',
            conversationRole: 'assistant',
            failure: null,
            generationRequestId: '',
            reasoningRunId: '',
            mediaRunId: '',
            reasoningModelId: '',
            mediaModelId: '',
            mediaType: '',
        })
    })
})

// =============================================================================
// aiResponseMessageNodeView — ignoreMutation
// =============================================================================

const createResponseNodeView = (attrs: Record<string, unknown> = {}, content: any = schema.nodes.paragraph.create(null, schema.text('Hello'))) => {
    const node = schema.nodes.aiResponseMessage.create(
        {
            id: 'test-msg-1',
            aiProvider: 'Anthropic',
            ...attrs,
        },
        content,
    )

    const mockView = {
        state: { tr: { setNodeMarkup: vi.fn().mockReturnValue({ setNodeMarkup: vi.fn() }) } },
        dispatch: vi.fn(),
    }
    const getPos = vi.fn(() => 0)

    const nodeView = aiResponseMessageNodeView(node, mockView, getPos)

    return {
        nodeView,
        node,
        mockView,
        getPos,
    }
}

describe('aiResponseMessageNodeView — ignoreMutation', () => {
    it('returns true for style attribute mutations on the wrapper', () => {
        const { nodeView } = createResponseNodeView()

        const mutation = {
            type: 'attributes',
            attributeName: 'style',
            target: nodeView.dom,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(mutation)).toBe(true)
    })

    it('returns false for non-style attribute mutations', () => {
        const { nodeView } = createResponseNodeView()

        const mutation = {
            type: 'attributes',
            attributeName: 'class',
            target: nodeView.dom,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(mutation)).toBe(false)
    })

    it('returns false for childList mutations', () => {
        const { nodeView } = createResponseNodeView()

        const mutation = {
            type: 'childList',
            attributeName: null,
            target: nodeView.dom,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(mutation)).toBe(false)
    })

    it('returns false for characterData mutations', () => {
        const { nodeView } = createResponseNodeView()

        const mutation = {
            type: 'characterData',
            attributeName: null,
            target: nodeView.contentDOM!,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(mutation)).toBe(false)
    })

    it('returns true for style mutations even on data-message-id attribute', () => {
        const { nodeView } = createResponseNodeView()

        // data-message-id mutation should NOT be ignored
        const dataMutation = {
            type: 'attributes',
            attributeName: 'data-message-id',
            target: nodeView.dom,
        } as unknown as MutationRecord
        expect(nodeView.ignoreMutation!(dataMutation)).toBe(false)

        // but style mutation SHOULD be ignored
        const styleMutation = {
            type: 'attributes',
            attributeName: 'style',
            target: nodeView.dom,
        } as unknown as MutationRecord
        expect(nodeView.ignoreMutation!(styleMutation)).toBe(true)
    })
})

// =============================================================================
// aiResponseMessageNodeView — marginBottom preserved across update()
// =============================================================================

describe('aiResponseMessageNodeView — marginBottom survives update()', () => {
    it('preserves externally-set marginBottom when update() is called', () => {
        const { nodeView } = createResponseNodeView()
        const dom = nodeView.dom as HTMLElement

        // Simulate a canvas layout pass setting marginBottom.
        applyStyle(dom, { marginBottom: '120px' })
        expect(dom.style.marginBottom).toBe('120px')

        // Simulate ProseMirror calling update() with a new node (e.g. new animation frame)
        const updatedNode = schema.nodes.aiResponseMessage.create(
            {
                id: 'test-msg-1',
                aiProvider: 'Anthropic',
                currentFrame: 3,
            },
            schema.nodes.paragraph.create(null, schema.text('Hello')),
        )

        const result = nodeView.update!(updatedNode, [], null as any)

        expect(result).toBe(true)
        // marginBottom must survive the update — this is the entire point of ignoreMutation
        expect(dom.style.marginBottom).toBe('120px')
    })

    it('preserves marginBottom across multiple sequential updates', () => {
        const { nodeView } = createResponseNodeView()
        const dom = nodeView.dom as HTMLElement

        applyStyle(dom, { marginBottom: '200px' })

        // Simulate rapid animation frame updates (every 90ms during streaming)
        for (let frame = 0; frame < 8; frame++) {
            const updatedNode = schema.nodes.aiResponseMessage.create(
                {
                    id: 'test-msg-1',
                    aiProvider: 'Anthropic',
                    currentFrame: frame,
                    isReceivingAnimation: false,
                },
                schema.nodes.paragraph.create(null, schema.text('Hello')),
            )
            nodeView.update!(updatedNode, [], null as any)
        }

        expect(dom.style.marginBottom).toBe('200px')
    })
})

// =============================================================================
// aiResponseMessageNodeView — DOM structure
// =============================================================================

describe('aiResponseMessageNodeView — DOM structure', () => {
    it('creates wrapper with ai-response-message-wrapper class', () => {
        const { nodeView } = createResponseNodeView()
        const dom = nodeView.dom as HTMLElement

        expect(dom.className).toBe('ai-response-message-wrapper')
    })

    it('sets data-message-id attribute on wrapper', () => {
        const { nodeView } = createResponseNodeView({ id: 'msg-42' })
        const dom = nodeView.dom as HTMLElement

        expect(dom.getAttribute('data-message-id')).toBe('msg-42')
    })

    it('has contentDOM as ai-response-message-content element', () => {
        const { nodeView } = createResponseNodeView()
        const contentDOM = nodeView.contentDOM as HTMLElement

        expect(contentDOM.className).toBe('ai-response-message-content')
    })

    it('renders the response shell shell elements', () => {
        const { nodeView } = createResponseNodeView({ aiProvider: 'Google' })
        const dom = nodeView.dom as HTMLElement
        const messageRow = dom.querySelector('.ai-response-message')
        const loadingIndicator = dom.querySelector('.ai-response-loading-spinner')

        expect(messageRow).not.toBeNull()
        expect(loadingIndicator).not.toBeNull()
    })

    it('shows the ring loading indicator while an empty response is receiving', () => {
        const { nodeView } = createResponseNodeView({ isReceivingAnimation: true }, null)
        const dom = nodeView.dom as HTMLElement
        const bubble = dom.querySelector('.ai-response-message') as HTMLElement
        const loadingIndicator = dom.querySelector('.ai-response-loading-spinner') as HTMLElement

        expect(loadingIndicator).not.toBeNull()
        expect(bubble.classList.contains('is-waiting')).toBe(true)
        expect(bubble.classList.contains('is-empty')).toBe(true)
        expect(loadingIndicator.classList.contains('is-active')).toBe(true)
        expect(dom.querySelector(`.${['ai-response', 'message', 'spinner'].join('-')}`)).toBeNull()
    })

    it('clears the loading indicator after content arrives', () => {
        const { nodeView } = createResponseNodeView({ isReceivingAnimation: true }, null)
        const dom = nodeView.dom as HTMLElement
        const bubble = dom.querySelector('.ai-response-message') as HTMLElement
        const loadingIndicator = dom.querySelector('.ai-response-loading-spinner') as HTMLElement
        const updatedNode = schema.nodes.aiResponseMessage.create(
            {
                id: 'test-msg-1',
                aiProvider: 'Anthropic',
                isReceivingAnimation: false,
            },
            schema.nodes.paragraph.create(null, schema.text('Ready')),
        )

        nodeView.update!(updatedNode, [], null as any)

        expect(bubble.classList.contains('is-waiting')).toBe(false)
        expect(bubble.classList.contains('is-empty')).toBe(false)
        expect(loadingIndicator.classList.contains('is-active')).toBe(false)
    })

    it('update() refreshes data-message-id when node id changes', () => {
        const { nodeView } = createResponseNodeView({ id: 'msg-old' })
        const dom = nodeView.dom as HTMLElement

        expect(dom.getAttribute('data-message-id')).toBe('msg-old')

        const updatedNode = schema.nodes.aiResponseMessage.create(
            {
                id: 'msg-new',
                aiProvider: 'Anthropic',
            },
            schema.nodes.paragraph.create(null, schema.text('Updated')),
        )
        nodeView.update!(updatedNode, [], null as any)

        expect(dom.getAttribute('data-message-id')).toBe('msg-new')
    })

    it('update() returns false for a different node type', () => {
        const { nodeView } = createResponseNodeView()

        const wrongNode = schema.nodes.paragraph.create(null, schema.text('wrong'))
        const result = nodeView.update!(wrongNode, [], null as any)

        expect(result).toBe(false)
    })
})

// =============================================================================
// aiResponseMessageNodeView — loading indicator source guard
// =============================================================================

describe('aiResponseMessageNodeView — loading indicator source guard', () => {
    it('uses the ring loading contract and removes the legacy dot loader contract', () => {
        const oldSpinnerClass = ['ai-response', 'message', 'spinner'].join('-')
        const oldSpinnerMixin = ['horizontal', 'Spinner', 'Animation'].join('')
        const shellSource = loadSource('ai-chat-message-shells.ts')
        const responseNodeSource = loadSource('ai-response-message-node.ts')
        const threadScss = loadScss()
        const animationScss = loadAnimationsScss()

        expectSourceToContain(shellSource, 'ai-response-loading-spinner', 'response shell source')
        expectSourceToContain(threadScss, '.ai-response-loading-spinner', 'thread SCSS')
        expectSourceToContain(animationScss, 'animation: spin 0.8s linear infinite;', 'shared animations SCSS')
        expectSourceNotToContain(shellSource, oldSpinnerClass, 'response shell source')
        expectSourceNotToContain(responseNodeSource, oldSpinnerClass, 'response node source')
        expectSourceNotToContain(threadScss, oldSpinnerClass, 'thread SCSS')
        expectSourceNotToContain(threadScss, oldSpinnerMixin, 'thread SCSS')
        expectSourceNotToContain(animationScss, oldSpinnerMixin, 'shared animations SCSS')
    })
})

describe('Configuration records in the shared response renderer', () => {
    it('preserves the semantic role through DOM serialization and parsing', () => {
        const node = schema.nodes.aiResponseMessage.create(
            { conversationRole: 'configuration' },
            schema.nodes.paragraph.create(null, schema.text('Model preferences updated.')),
        )
        const serialized = node.type.spec.toDOM!(node) as [string, Record<string, string>, number]
        expect(serialized[1]['data-conversation-role']).toBe('configuration')
        const element = document.createElement('div')
        element.setAttribute('data-conversation-role', 'configuration')
        const parseRule = aiResponseMessageNodeSpec.parseDOM![0]
        expect((parseRule as { getAttrs: (element: HTMLElement) => object }).getAttrs(element)).toMatchObject({
            conversationRole: 'configuration',
        })
        expect(node.textContent).toBe('Model preferences updated.')
    })

    it('hides configuration audit records and restores a response when its role changes', () => {
        const {
            nodeView,
            node,
        } = createResponseNodeView({ conversationRole: 'configuration' })
        expect((nodeView.dom as HTMLElement).hidden).toBe(true)
        const assistant = node.type.create({
            ...node.attrs,
            conversationRole: 'assistant',
        }, node.content)
        nodeView.update!(assistant)
        expect((nodeView.dom as HTMLElement).hidden).toBe(false)
        expect((nodeView.dom as HTMLElement).dataset.conversationRole).toBe('assistant')
        nodeView.destroy?.()
    })
})

describe('Failure records in the shared response renderer', () => {
    const failure = {
        code: 'AGENT_MODEL_CALL_NOT_AUTHORIZED',
        message: 'Internal authorization diagnostic',
        recoverable: false,
    }

    it('round-trips failure metadata and rejects malformed DOM attributes', () => {
        const node = schema.nodes.aiResponseMessage.create(
            { failure },
            schema.nodes.paragraph.create(null, schema.text('Check your account settings.')),
        )
        const serialized = node.type.spec.toDOM!(node) as [string, Record<string, string>, number]
        const element = document.createElement('div')
        const parseRule = aiResponseMessageNodeSpec.parseDOM![0] as { getAttrs: (element: HTMLElement) => object }
        element.setAttribute('data-conversation-failure', serialized[1]['data-conversation-failure'])
        expect(parseRule.getAttrs(element)).toMatchObject({ failure })
        element.setAttribute('data-conversation-failure', '{"code":"missing-fields"}')
        expect(parseRule.getAttrs(element)).toMatchObject({ failure: null })
        element.setAttribute('data-conversation-failure', '{')
        expect(parseRule.getAttrs(element)).toMatchObject({ failure: null })
    })

    it('marks a failure visibly and accessibly without replacing the native content slot', () => {
        const {
            nodeView,
            node,
        } = createResponseNodeView()
        const content = nodeView.contentDOM as HTMLElement
        const text = document.createTextNode('Check your account settings.')
        content.append(text)
        const failed = node.type.create({
            ...node.attrs,
            failure,
            isReceivingAnimation: true,
            isInitialRenderAnimation: true,
        }, node.content)
        nodeView.update!(failed)
        const wrapper = nodeView.dom as HTMLElement
        const message = wrapper.querySelector<HTMLElement>('.ai-response-message')!
        const label = wrapper.querySelector<HTMLElement>('.ai-response-failure-label')!
        expect(message.classList.contains('is-failed')).toBe(true)
        expect(message.getAttribute('role')).toBe('group')
        expect(message.getAttribute('aria-label')).toBe('Response failed')
        expect(label.hidden).toBe(false)
        expect(label.getAttribute('contenteditable')).toBe('false')
        expect(wrapper.dataset.failureCode).toBe(failure.code)
        expect(wrapper.textContent).not.toContain(failure.message)
        expect(nodeView.contentDOM).toBe(content)
        expect(content.firstChild).toBe(text)
        expect(content.classList.contains('node-render-animation')).toBe(false)
        expect(message.classList.contains('is-waiting')).toBe(false)
        expect(nodeView.ignoreMutation!({
            type: 'attributes',
            target: label,
        } as MutationRecord)).toBe(true)

        nodeView.update!(node)
        expect(message.classList.contains('is-failed')).toBe(false)
        expect(label.hidden).toBe(true)
        expect(message.hasAttribute('role')).toBe(false)
        expect(wrapper.dataset.failureCode).toBeUndefined()
        expect(nodeView.contentDOM).toBe(content)
        nodeView.destroy?.()
    })
})
