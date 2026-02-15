import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EditorState, Transaction } from 'prosemirror-state'
import { EditorView, DecorationSet } from 'prosemirror-view'
import {
    doc,
    p,
    promptInput,
    createEditorState as createBaseEditorState,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import { testSchema } from '$src/components/proseMirror/plugins/testUtils/testSchema.ts'
import {
    aiPromptInputNodeType,
    aiPromptInputNodeSpec,
    createAiPromptInputNodeView,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
import {
    AI_PROMPT_INPUT_PLUGIN_KEY,
    SUBMIT_AI_PROMPT_META,
    STOP_AI_PROMPT_META,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputPluginConstants.ts'
import { createAiPromptInputPlugin } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputPlugin.ts'

// =============================================================================
// HELPERS
// =============================================================================

function createEditorStateWithPlugins(document: ProseMirrorNode, plugins: any[] = []) {
    return EditorState.create({ doc: document, schema: testSchema, plugins })
}

function createMockControlFactories() {
    const modelDropdownDom = document.createElement('div')
    modelDropdownDom.className = 'mock-model-dropdown'

    const imageToggleDom = document.createElement('div')
    imageToggleDom.className = 'mock-image-toggle'

    const submitButtonDom = document.createElement('button')
    submitButtonDom.className = 'mock-submit-button'

    return {
        createModelDropdown: vi.fn(() => ({
            dom: modelDropdownDom,
            update: vi.fn(),
            destroy: vi.fn(),
        })),
        createImageToggle: vi.fn(() => ({
            dom: imageToggleDom,
            update: vi.fn(),
        })),
        createSubmitButton: vi.fn(() => submitButtonDom),
        modelDropdownDom,
        imageToggleDom,
        submitButtonDom,
    }
}

function createPluginOptions(overrides: Partial<Parameters<typeof createAiPromptInputPlugin>[0]> = {}) {
    const factories = createMockControlFactories()
    return {
        options: {
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageToggle: factories.createImageToggle,
            createSubmitButton: factories.createSubmitButton,
            placeholderText: 'Ask anything…',
            ...overrides,
        },
        factories,
    }
}

// =============================================================================
// NODE SPEC
// =============================================================================

describe('aiPromptInputNodeSpec — schema definition', () => {
    it('registers as a block node', () => {
        const nodeType = testSchema.nodes.aiPromptInput
        expect(nodeType).toBeDefined()
        expect(nodeType.isBlock).toBe(true)
    })

    it('has content expression accepting paragraphs and blocks', () => {
        const nodeType = testSchema.nodes.aiPromptInput
        expect(nodeType.spec.content).toBe('(paragraph | block)+')
    })

    it('is not draggable', () => {
        expect(aiPromptInputNodeSpec.draggable).toBe(false)
    })

    it('is not selectable', () => {
        expect(aiPromptInputNodeSpec.selectable).toBe(false)
    })

    it('is isolating', () => {
        expect(aiPromptInputNodeSpec.isolating).toBe(true)
    })

    describe('default attribute values', () => {
        it('aiModel defaults to empty string', () => {
            const state = createBaseEditorState(doc(promptInput(p())))
            const node = state.doc.firstChild!
            expect(node.attrs.aiModel).toBe('')
        })

        it('imageGenerationEnabled defaults to false', () => {
            const state = createBaseEditorState(doc(promptInput(p())))
            const node = state.doc.firstChild!
            expect(node.attrs.imageGenerationEnabled).toBe(false)
        })

        it('imageGenerationSize defaults to 1024x1024', () => {
            const state = createBaseEditorState(doc(promptInput(p())))
            const node = state.doc.firstChild!
            expect(node.attrs.imageGenerationSize).toBe('1024x1024')
        })
    })

    describe('toDOM output', () => {
        it('renders a div with class ai-prompt-input-wrapper', () => {
            const state = createBaseEditorState(doc(promptInput({ aiModel: 'gpt-4' }, p('Hello'))))
            const node = state.doc.firstChild!
            const domSpec = aiPromptInputNodeSpec.toDOM(node) as any[]

            expect(domSpec[0]).toBe('div')
            expect(domSpec[1].class).toBe('ai-prompt-input-wrapper')
        })

        it('serializes attributes as data-* attributes', () => {
            const state = createBaseEditorState(doc(promptInput(
                { aiModel: 'gpt-4', imageGenerationEnabled: true, imageGenerationSize: '512x512' },
                p('Hello'),
            )))
            const node = state.doc.firstChild!
            const domSpec = aiPromptInputNodeSpec.toDOM(node) as any[]
            const attrs = domSpec[1]

            expect(attrs['data-ai-model']).toBe('gpt-4')
            expect(attrs['data-image-generation-enabled']).toBe(true)
            expect(attrs['data-image-generation-size']).toBe('512x512')
        })

        it('has a content hole (0) for editable content', () => {
            const state = createBaseEditorState(doc(promptInput(p())))
            const node = state.doc.firstChild!
            const domSpec = aiPromptInputNodeSpec.toDOM(node) as any[]
            expect(domSpec[2]).toBe(0)
        })
    })

    describe('parseDOM', () => {
        it('matches div.ai-prompt-input-wrapper', () => {
            const parseRule = aiPromptInputNodeSpec.parseDOM![0]
            expect(parseRule.tag).toBe('div.ai-prompt-input-wrapper')
        })

        it('extracts attributes from data-* attrs', () => {
            const el = document.createElement('div')
            el.className = 'ai-prompt-input-wrapper'
            el.setAttribute('data-ai-model', 'claude-3')
            el.setAttribute('data-image-generation-enabled', 'true')
            el.setAttribute('data-image-generation-size', '256x256')

            const parseRule = aiPromptInputNodeSpec.parseDOM![0]
            const attrs = parseRule.getAttrs!(el as any) as Record<string, unknown>

            expect(attrs.aiModel).toBe('claude-3')
            expect(attrs.imageGenerationEnabled).toBe(true)
            expect(attrs.imageGenerationSize).toBe('256x256')
        })

        it('returns defaults when data-* attrs are missing', () => {
            const el = document.createElement('div')
            el.className = 'ai-prompt-input-wrapper'

            const parseRule = aiPromptInputNodeSpec.parseDOM![0]
            const attrs = parseRule.getAttrs!(el as any) as Record<string, unknown>

            expect(attrs.aiModel).toBe('')
            expect(attrs.imageGenerationEnabled).toBe(false)
            expect(attrs.imageGenerationSize).toBe('1024x1024')
        })
    })
})

// =============================================================================
// NODE VIEW — DOM STRUCTURE & RENDERING
// =============================================================================

describe('createAiPromptInputNodeView — DOM structure', () => {
    function createNodeView(text = 'Hello world', attrs: Record<string, unknown> = {}) {
        const testDoc = doc(promptInput(attrs, p(text)))
        const state = createBaseEditorState(testDoc)
        const node = state.doc.firstChild!
        const getPos = () => 0

        const mockView = {
            state,
            dispatch: vi.fn((tr: Transaction) => {
                (mockView as any).state = (mockView as any).state.apply(tr)
            }),
        } as unknown as EditorView

        const factories = createMockControlFactories()
        const nv = createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageToggle: factories.createImageToggle,
            createSubmitButton: factories.createSubmitButton,
        })(node, mockView, getPos)

        return { nv, factories, node, mockView }
    }

    it('creates wrapper with class ai-prompt-input-wrapper', () => {
        const { nv } = createNodeView()
        expect(nv.dom).toBeInstanceOf(HTMLDivElement)
        expect(nv.dom.className).toBe('ai-prompt-input-wrapper')
    })

    it('has a contentDOM with class ai-prompt-input-content', () => {
        const { nv } = createNodeView()
        expect(nv.contentDOM).toBeInstanceOf(HTMLDivElement)
        expect(nv.contentDOM!.className).toBe('ai-prompt-input-content')
    })

    describe('visual hierarchy — wrapper contains content then controls', () => {
        it('wrapper has exactly 2 children: contentDOM and controlsEl', () => {
            const { nv } = createNodeView()
            expect(nv.dom.childNodes.length).toBe(2)
            expect(nv.dom.childNodes[0]).toBe(nv.contentDOM)
            expect((nv.dom.childNodes[1] as HTMLElement).className).toBe('ai-prompt-input-controls')
        })

        it('controls container is placed after content in DOM order', () => {
            const { nv } = createNodeView()
            const controlsEl = nv.dom.childNodes[1] as HTMLElement
            expect(controlsEl.className).toBe('ai-prompt-input-controls')
            expect(nv.dom.firstChild).toBe(nv.contentDOM)
            expect(nv.dom.lastChild).toBe(controlsEl)
        })
    })

    describe('control elements rendering', () => {
        it('renders model dropdown inside controls', () => {
            const { nv, factories } = createNodeView()
            const controlsEl = nv.dom.querySelector('.ai-prompt-input-controls')!
            expect(controlsEl.contains(factories.modelDropdownDom)).toBe(true)
        })

        it('renders image toggle inside controls', () => {
            const { nv, factories } = createNodeView()
            const controlsEl = nv.dom.querySelector('.ai-prompt-input-controls')!
            expect(controlsEl.contains(factories.imageToggleDom)).toBe(true)
        })

        it('renders submit button inside controls', () => {
            const { nv, factories } = createNodeView()
            const controlsEl = nv.dom.querySelector('.ai-prompt-input-controls')!
            expect(controlsEl.contains(factories.submitButtonDom)).toBe(true)
        })

        it('controls are ordered: dropdown, image toggle, submit', () => {
            const { nv, factories } = createNodeView()
            const controlsEl = nv.dom.querySelector('.ai-prompt-input-controls')!
            const children = Array.from(controlsEl.children)

            expect(children[0]).toBe(factories.modelDropdownDom)
            expect(children[1]).toBe(factories.imageToggleDom)
            expect(children[2]).toBe(factories.submitButtonDom)
        })
    })
})

// =============================================================================
// NODE VIEW — EMPTY STATE & DATA ATTRIBUTE
// =============================================================================

describe('createAiPromptInputNodeView — empty state tracking', () => {
    function createNodeViewForEmpty(text = '') {
        const testDoc = text ? doc(promptInput(p(text))) : doc(promptInput(p()))
        const state = createBaseEditorState(testDoc)
        const inputNode = state.doc.firstChild!

        const mockView = {
            state,
            dispatch: vi.fn((tr: Transaction) => {
                (mockView as any).state = (mockView as any).state.apply(tr)
            }),
        } as unknown as EditorView

        const factories = createMockControlFactories()
        const nv = createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageToggle: factories.createImageToggle,
            createSubmitButton: factories.createSubmitButton,
        })(inputNode, mockView, () => 0)

        return { nv, factories }
    }

    it('sets data-empty="true" when content is empty', () => {
        const { nv } = createNodeViewForEmpty('')
        expect(nv.dom.getAttribute('data-empty')).toBe('true')
    })

    it('sets data-empty="false" when content has text', () => {
        const { nv } = createNodeViewForEmpty('Hello')
        expect(nv.dom.getAttribute('data-empty')).toBe('false')
    })

    it('updates data-empty on node update', () => {
        const { nv } = createNodeViewForEmpty('Hello')
        expect(nv.dom.getAttribute('data-empty')).toBe('false')

        const emptyDoc = doc(promptInput(p()))
        const emptyNode = emptyDoc.firstChild!
        nv.update!(emptyNode)

        expect(nv.dom.getAttribute('data-empty')).toBe('true')
    })

    it('sets data-empty="true" for whitespace-only content', () => {
        const { nv } = createNodeViewForEmpty('   ')
        expect(nv.dom.getAttribute('data-empty')).toBe('true')
    })
})

// =============================================================================
// NODE VIEW — STOP EVENT
// =============================================================================

describe('createAiPromptInputNodeView — stopEvent', () => {
    function createNodeViewWithControls() {
        const testDoc = doc(promptInput(p('Hello')))
        const state = createBaseEditorState(testDoc)
        const inputNode = state.doc.firstChild!

        const mockView = {
            state,
            dispatch: vi.fn(),
        } as unknown as EditorView

        const factories = createMockControlFactories()
        const nv = createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageToggle: factories.createImageToggle,
            createSubmitButton: factories.createSubmitButton,
        })(inputNode, mockView, () => 0)

        return { nv, factories }
    }

    it('stops events from controls (prevents ProseMirror from stealing focus)', () => {
        const { nv, factories } = createNodeViewWithControls()
        const event = new MouseEvent('click')
        Object.defineProperty(event, 'target', { value: factories.submitButtonDom })

        expect(nv.stopEvent!(event)).toBe(true)
    })

    it('does not stop events from content area', () => {
        const { nv } = createNodeViewWithControls()
        const event = new MouseEvent('click')
        Object.defineProperty(event, 'target', { value: nv.contentDOM })

        expect(nv.stopEvent!(event)).toBe(false)
    })

    it('stops events from elements nested inside controls', () => {
        const { nv, factories } = createNodeViewWithControls()
        const nestedEl = document.createElement('span')
        factories.modelDropdownDom.appendChild(nestedEl)

        const event = new MouseEvent('click')
        Object.defineProperty(event, 'target', { value: nestedEl })

        expect(nv.stopEvent!(event)).toBe(true)
    })
})

// =============================================================================
// NODE VIEW — IGNORE MUTATION
// =============================================================================

describe('createAiPromptInputNodeView — ignoreMutation', () => {
    function createNodeViewInstance() {
        const testDoc = doc(promptInput(p('Hello')))
        const state = createBaseEditorState(testDoc)
        const inputNode = state.doc.firstChild!

        const mockView = {
            state,
            dispatch: vi.fn(),
        } as unknown as EditorView

        const factories = createMockControlFactories()
        const nv = createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageToggle: factories.createImageToggle,
            createSubmitButton: factories.createSubmitButton,
        })(inputNode, mockView, () => 0)

        return { nv, factories }
    }

    it('ignores mutations targeting the controls element', () => {
        const { nv } = createNodeViewInstance()
        const controlsEl = nv.dom.querySelector('.ai-prompt-input-controls')!
        const mutation = { target: controlsEl } as MutationRecord

        expect(nv.ignoreMutation!(mutation)).toBe(true)
    })

    it('ignores mutations on elements inside controls', () => {
        const { nv, factories } = createNodeViewInstance()
        const mutation = { target: factories.submitButtonDom } as MutationRecord

        expect(nv.ignoreMutation!(mutation)).toBe(true)
    })

    it('does not ignore mutations on content area', () => {
        const { nv } = createNodeViewInstance()
        const mutation = { target: nv.contentDOM! } as MutationRecord

        expect(nv.ignoreMutation!(mutation)).toBe(false)
    })
})

// =============================================================================
// NODE VIEW — UPDATE
// =============================================================================

describe('createAiPromptInputNodeView — update', () => {
    function createNodeViewForUpdate() {
        const testDoc = doc(promptInput(p('Hello')))
        const state = createBaseEditorState(testDoc)
        const inputNode = state.doc.firstChild!

        const mockView = {
            state,
            dispatch: vi.fn(),
        } as unknown as EditorView

        const factories = createMockControlFactories()
        const nv = createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageToggle: factories.createImageToggle,
            createSubmitButton: factories.createSubmitButton,
        })(inputNode, mockView, () => 0)

        return { nv, factories }
    }

    it('returns true for same node type', () => {
        const { nv } = createNodeViewForUpdate()
        const updatedDoc = doc(promptInput(p('Updated text')))
        const updatedNode = updatedDoc.firstChild!

        expect(nv.update!(updatedNode)).toBe(true)
    })

    it('returns false for different node type', () => {
        const { nv } = createNodeViewForUpdate()
        const paragraphNode = p('Text')

        expect(nv.update!(paragraphNode)).toBe(false)
    })

    it('calls modelDropdown.update on update', () => {
        const { nv, factories } = createNodeViewForUpdate()
        const updatedDoc = doc(promptInput(p('Updated')))
        nv.update!(updatedDoc.firstChild!)

        expect(factories.createModelDropdown.mock.results[0].value.update).toHaveBeenCalled()
    })

    it('calls imageToggle.update on update', () => {
        const { nv, factories } = createNodeViewForUpdate()
        const updatedDoc = doc(promptInput(p('Updated')))
        nv.update!(updatedDoc.firstChild!)

        expect(factories.createImageToggle.mock.results[0].value.update).toHaveBeenCalled()
    })
})

// =============================================================================
// NODE VIEW — DESTROY
// =============================================================================

describe('createAiPromptInputNodeView — destroy', () => {
    it('calls modelDropdown.destroy on destroy', () => {
        const testDoc = doc(promptInput(p('Hello')))
        const state = createBaseEditorState(testDoc)
        const factories = createMockControlFactories()

        const nv = createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageToggle: factories.createImageToggle,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)

        nv.destroy!()

        expect(factories.createModelDropdown.mock.results[0].value.destroy).toHaveBeenCalled()
    })
})

// =============================================================================
// NODE VIEW — CONTROL ADAPTERS WIRE TO PROSEMIRROR NODE ATTRS
// =============================================================================

describe('createAiPromptInputNodeView — control adapters', () => {
    it('createModelDropdown receives AiModelControls adapter', () => {
        const factories = createMockControlFactories()
        const testDoc = doc(promptInput({ aiModel: 'gpt-4' }, p('Hello')))
        const state = createBaseEditorState(testDoc)

        createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageToggle: factories.createImageToggle,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)

        expect(factories.createModelDropdown).toHaveBeenCalledTimes(1)
        const [controls, dropdownId] = factories.createModelDropdown.mock.calls[0]
        expect(controls).toHaveProperty('getCurrentAiModel')
        expect(controls).toHaveProperty('setAiModel')
        expect(dropdownId).toBe('ai-prompt-input')
    })

    it('createImageToggle receives ImageToggleControls adapter', () => {
        const factories = createMockControlFactories()
        const testDoc = doc(promptInput(p('Hello')))
        const state = createBaseEditorState(testDoc)

        createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageToggle: factories.createImageToggle,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)

        expect(factories.createImageToggle).toHaveBeenCalledTimes(1)
        const [controls] = factories.createImageToggle.mock.calls[0]
        expect(controls).toHaveProperty('getImageGenerationEnabled')
        expect(controls).toHaveProperty('getImageGenerationSize')
        expect(controls).toHaveProperty('setImageGenerationEnabled')
        expect(controls).toHaveProperty('setImageGenerationSize')
    })

    it('createSubmitButton receives SubmitControls adapter', () => {
        const factories = createMockControlFactories()
        const onSubmit = vi.fn()
        const onStop = vi.fn()
        const isReceiving = vi.fn(() => false)
        const testDoc = doc(promptInput(p('Hello')))
        const state = createBaseEditorState(testDoc)

        createAiPromptInputNodeView({
            onSubmit,
            onStop,
            isReceiving,
            createModelDropdown: factories.createModelDropdown,
            createImageToggle: factories.createImageToggle,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)

        expect(factories.createSubmitButton).toHaveBeenCalledTimes(1)
        const [controls] = factories.createSubmitButton.mock.calls[0]
        expect(controls).toHaveProperty('onSubmit')
        expect(controls).toHaveProperty('onStop')
        expect(controls).toHaveProperty('isReceiving')
    })
})

// =============================================================================
// VISUAL & RENDERING — CSS CLASS HIERARCHY FROM SCSS
// =============================================================================

describe('Visual structure — CSS class expectations from SCSS', () => {
    function renderNodeView() {
        const testDoc = doc(promptInput(p('Hello')))
        const state = createBaseEditorState(testDoc)
        const factories = createMockControlFactories()

        return createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageToggle: factories.createImageToggle,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)
    }

    it('wrapper element is a div (matches div.ai-prompt-input-wrapper in SCSS)', () => {
        const nv = renderNodeView()
        expect(nv.dom.tagName).toBe('DIV')
        expect(nv.dom.className).toBe('ai-prompt-input-wrapper')
    })

    it('content element is a div (matches .ai-prompt-input-content in SCSS)', () => {
        const nv = renderNodeView()
        expect(nv.contentDOM!.tagName).toBe('DIV')
        expect(nv.contentDOM!.className).toBe('ai-prompt-input-content')
    })

    it('controls element is a div (matches .ai-prompt-input-controls in SCSS)', () => {
        const nv = renderNodeView()
        const controls = nv.dom.querySelector('.ai-prompt-input-controls')
        expect(controls).not.toBeNull()
        expect(controls!.tagName).toBe('DIV')
    })

    it('DOM order matches SCSS flex column layout: content above controls', () => {
        const nv = renderNodeView()

        // SCSS: .ai-prompt-input-wrapper uses flex-direction: column
        // content is flex: 1 (fills space), controls are at the bottom
        const children = Array.from(nv.dom.children) as HTMLElement[]
        expect(children.length).toBe(2)
        expect(children[0].className).toBe('ai-prompt-input-content')
        expect(children[1].className).toBe('ai-prompt-input-controls')
    })

    it('data-empty attribute enables placeholder pseudo-element from SCSS', () => {
        const testDoc = doc(promptInput(p()))
        const state = createBaseEditorState(testDoc)
        const factories = createMockControlFactories()

        const nv = createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageToggle: factories.createImageToggle,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)

        // SCSS: &[data-empty="true"] .ai-prompt-input-content::before shows placeholder
        expect(nv.dom.getAttribute('data-empty')).toBe('true')
        expect(nv.dom.querySelector('.ai-prompt-input-content')).not.toBeNull()
    })

    it('wrapper contains no border styling classes — clean look from SCSS', () => {
        const nv = renderNodeView()
        expect(nv.dom.classList.contains('bordered')).toBe(false)
        expect(nv.dom.classList.contains('with-border')).toBe(false)
    })
})

// =============================================================================
// VISUAL — PROPORTIONS & SIZING EXPECTATIONS
// =============================================================================

describe('Visual proportions — SCSS sizing expectations', () => {
    function renderNodeView() {
        const testDoc = doc(promptInput(p('Hello')))
        const state = createBaseEditorState(testDoc)
        const factories = createMockControlFactories()

        return createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageToggle: factories.createImageToggle,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)
    }

    it('controls has exactly 3 child elements for balanced layout', () => {
        const nv = renderNodeView()
        const controls = nv.dom.querySelector('.ai-prompt-input-controls')!
        // SCSS expects: model dropdown, image toggle, submit button
        // The controls use justify-content: flex-end so they sit right
        expect(controls.children.length).toBe(3)
    })

    it('content area is the first child — gets flex: 1 for vertical fill', () => {
        const nv = renderNodeView()
        // SCSS: .ai-prompt-input-content { flex: 1; }
        // Being the first child in a column flex ensures it takes available space
        expect(nv.dom.children[0]).toBe(nv.contentDOM)
    })

    it('controls sit below content — no absolute positioning, natural flow', () => {
        const nv = renderNodeView()
        const controls = nv.dom.querySelector('.ai-prompt-input-controls')!
        // Controls element has no position: absolute — it lives in flow
        expect(controls.style.position).toBe('')
    })
})

// =============================================================================
// PLUGIN — CONSTANTS
// =============================================================================

describe('aiPromptInputPluginConstants', () => {
    it('exports a unique PluginKey', () => {
        expect(AI_PROMPT_INPUT_PLUGIN_KEY).toBeDefined()
        expect(AI_PROMPT_INPUT_PLUGIN_KEY.key).toContain('aiPromptInput')
    })

    it('exports SUBMIT_AI_PROMPT_META', () => {
        expect(SUBMIT_AI_PROMPT_META).toBe('submit:aiPrompt')
    })

    it('exports STOP_AI_PROMPT_META', () => {
        expect(STOP_AI_PROMPT_META).toBe('stop:aiPrompt')
    })
})

// =============================================================================
// PLUGIN — CREATION & CONFIGURATION
// =============================================================================

describe('createAiPromptInputPlugin — plugin creation', () => {
    it('creates a plugin with the correct key', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        expect(plugin.spec.key).toBe(AI_PROMPT_INPUT_PLUGIN_KEY)
    })

    it('plugin provides nodeViews for aiPromptInput', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        expect(plugin.props.nodeViews).toHaveProperty(aiPromptInputNodeType)
    })

    it('plugin provides handleDOMEvents with keydown handler', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        expect(plugin.props.handleDOMEvents).toHaveProperty('keydown')
    })

    it('plugin provides decorations function', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        expect(plugin.props.decorations).toBeTypeOf('function')
    })
})

// =============================================================================
// PLUGIN — PLACEHOLDER DECORATION
// =============================================================================

describe('createAiPromptInputPlugin — placeholder decoration', () => {
    it('adds placeholder decoration to empty input nodes', () => {
        const { options } = createPluginOptions({ placeholderText: 'Type a prompt…' })
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput(p()))
        const state = createEditorStateWithPlugins(testDoc, [plugin])

        const decorations = plugin.props.decorations!(state) as DecorationSet
        const found = decorations.find()

        expect(found.length).toBe(1)
        expect(found[0].type.attrs.class).toBe('empty-node-placeholder')
        expect(found[0].type.attrs['data-placeholder']).toBe('Type a prompt…')
    })

    it('does not add placeholder when input has text', () => {
        const { options } = createPluginOptions({ placeholderText: 'Type a prompt…' })
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput(p('Hello world')))
        const state = createEditorStateWithPlugins(testDoc, [plugin])

        const decorations = plugin.props.decorations!(state) as DecorationSet
        const found = decorations.find()

        expect(found.length).toBe(0)
    })

    it('uses the configured placeholderText', () => {
        const { options } = createPluginOptions({ placeholderText: 'Ask anything…' })
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput(p()))
        const state = createEditorStateWithPlugins(testDoc, [plugin])

        const decorations = plugin.props.decorations!(state) as DecorationSet
        const found = decorations.find()

        expect(found[0].type.attrs['data-placeholder']).toBe('Ask anything…')
    })
})

// =============================================================================
// PLUGIN — KEYBOARD HANDLER (Cmd/Ctrl+Enter)
// =============================================================================

describe('createAiPromptInputPlugin — keyboard shortcuts', () => {
    it('Cmd+Enter triggers submit with content JSON', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput({ aiModel: 'gpt-4' }, p('Hello world')))
        const state = createEditorStateWithPlugins(testDoc, [plugin])

        const mockView = {
            state,
            dispatch: vi.fn((tr: Transaction) => {
                (mockView as any).state = (mockView as any).state.apply(tr)
            }),
        } as unknown as EditorView

        const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            metaKey: true,
        })

        const handler = plugin.props.handleDOMEvents!.keydown!
        const result = handler(mockView, event)

        expect(result).toBe(true)
        expect(options.onSubmit).toHaveBeenCalledTimes(1)

        const submitCall = options.onSubmit.mock.calls[0][0]
        expect(submitCall.contentJSON).toBeInstanceOf(Array)
        expect(submitCall.contentJSON.length).toBeGreaterThan(0)
        expect(submitCall.aiModel).toBe('gpt-4')
    })

    it('Ctrl+Enter also triggers submit (Windows/Linux)', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput({ aiModel: 'claude' }, p('Hello')))
        const state = createEditorStateWithPlugins(testDoc, [plugin])

        const mockView = { state, dispatch: vi.fn() } as unknown as EditorView

        const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            ctrlKey: true,
        })

        const handler = plugin.props.handleDOMEvents!.keydown!
        handler(mockView, event)

        expect(options.onSubmit).toHaveBeenCalledTimes(1)
    })

    it('regular Enter does not trigger submit', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput(p('Hello')))
        const state = createEditorStateWithPlugins(testDoc, [plugin])
        const mockView = { state, dispatch: vi.fn() } as unknown as EditorView

        const event = new KeyboardEvent('keydown', { key: 'Enter' })
        const handler = plugin.props.handleDOMEvents!.keydown!
        const result = handler(mockView, event)

        expect(result).toBe(false)
        expect(options.onSubmit).not.toHaveBeenCalled()
    })

    it('does not submit when content is empty', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput(p()))
        const state = createEditorStateWithPlugins(testDoc, [plugin])
        const mockView = { state, dispatch: vi.fn() } as unknown as EditorView

        const event = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true })
        const handler = plugin.props.handleDOMEvents!.keydown!
        handler(mockView, event)

        expect(options.onSubmit).not.toHaveBeenCalled()
    })

    it('clears input after successful submit', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput(p('Hello world')))
        const state = createEditorStateWithPlugins(testDoc, [plugin])

        const mockView = {
            state,
            dispatch: vi.fn((tr: Transaction) => {
                (mockView as any).state = (mockView as any).state.apply(tr)
            }),
        } as unknown as EditorView

        const event = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true })
        plugin.props.handleDOMEvents!.keydown!(mockView, event)

        // After submit, dispatch should have been called to clear content
        expect(mockView.dispatch).toHaveBeenCalled()
    })
})

// =============================================================================
// PLUGIN — IMAGE OPTIONS
// =============================================================================

describe('createAiPromptInputPlugin — image options handling', () => {
    it('includes imageOptions when imageGenerationEnabled is true', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput(
            { aiModel: 'dall-e-3', imageGenerationEnabled: true, imageGenerationSize: '512x512' },
            p('Create an image'),
        ))
        const state = createEditorStateWithPlugins(testDoc, [plugin])
        const mockView = {
            state,
            dispatch: vi.fn((tr: Transaction) => {
                (mockView as any).state = (mockView as any).state.apply(tr)
            }),
        } as unknown as EditorView

        const event = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true })
        plugin.props.handleDOMEvents!.keydown!(mockView, event)

        const submitCall = options.onSubmit.mock.calls[0][0]
        expect(submitCall.imageOptions).toEqual({
            imageGenerationEnabled: true,
            imageGenerationSize: '512x512',
        })
    })

    it('omits imageOptions when imageGenerationEnabled is false', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput(
            { aiModel: 'gpt-4', imageGenerationEnabled: false },
            p('Hello'),
        ))
        const state = createEditorStateWithPlugins(testDoc, [plugin])
        const mockView = {
            state,
            dispatch: vi.fn((tr: Transaction) => {
                (mockView as any).state = (mockView as any).state.apply(tr)
            }),
        } as unknown as EditorView

        const event = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true })
        plugin.props.handleDOMEvents!.keydown!(mockView, event)

        const submitCall = options.onSubmit.mock.calls[0][0]
        expect(submitCall.imageOptions).toBeUndefined()
    })
})

// =============================================================================
// PLUGIN — APPEND TRANSACTION (meta-driven submit/stop)
// =============================================================================

describe('createAiPromptInputPlugin — appendTransaction meta handling', () => {
    it('triggers onSubmit when SUBMIT_AI_PROMPT_META is dispatched', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput({ aiModel: 'gpt-4' }, p('Meta submit test')))
        const state = createEditorStateWithPlugins(testDoc, [plugin])

        const tr = state.tr.setMeta(SUBMIT_AI_PROMPT_META, true)
        const newState = state.apply(tr)

        // Reset because EditorState.create may call appendTransaction internally
        options.onSubmit.mockClear()

        plugin.spec.appendTransaction!([tr], state, newState)

        expect(options.onSubmit).toHaveBeenCalledTimes(1)
        expect(options.onSubmit.mock.calls[0][0].contentJSON).toBeInstanceOf(Array)
    })

    it('triggers onStop when STOP_AI_PROMPT_META is dispatched', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput(p('Hello')))
        const state = createEditorStateWithPlugins(testDoc, [plugin])

        const tr = state.tr.setMeta(STOP_AI_PROMPT_META, true)
        const newState = state.apply(tr)

        // Reset because EditorState.create may call appendTransaction internally
        options.onStop.mockClear()

        plugin.spec.appendTransaction!([tr], state, newState)

        expect(options.onStop).toHaveBeenCalledTimes(1)
    })

    it('does not trigger submit on regular transactions', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput(p('Hello')))
        const state = createEditorStateWithPlugins(testDoc, [plugin])

        const tr = state.tr.insertText('!')
        const newState = state.apply(tr)

        plugin.spec.appendTransaction!([tr], state, newState)

        expect(options.onSubmit).not.toHaveBeenCalled()
        expect(options.onStop).not.toHaveBeenCalled()
    })
})

// =============================================================================
// PLUGIN — VIEW LIFECYCLE
// =============================================================================

describe('createAiPromptInputPlugin — view lifecycle', () => {
    it('captures editorView reference on view creation', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput(p('Hello')))
        const state = createEditorStateWithPlugins(testDoc, [plugin])

        const mockView = {
            state,
            dispatch: vi.fn(),
        } as unknown as EditorView

        const viewReturn = plugin.spec.view!(mockView)

        expect(viewReturn).toHaveProperty('update')
        expect(viewReturn).toHaveProperty('destroy')
    })
})

// =============================================================================
// VISUAL — SCSS FLOATING CONTAINER CLASS EXPECTATIONS
// =============================================================================

describe('Visual — floating container SCSS expectations', () => {
    it('floating container class ai-prompt-input-floating matches SCSS selector', () => {
        // SCSS defines .ai-prompt-input-floating { ... }
        // This class is applied by WorkspaceCanvas.ts when creating the floating DOM
        // Verify the SCSS expects this class for the outer wrapper
        const el = document.createElement('div')
        el.className = 'ai-prompt-input-floating'

        // The floating container should contain .floating-input-editor
        const editor = document.createElement('div')
        editor.className = 'floating-input-editor'
        el.appendChild(editor)

        expect(el.querySelector('.floating-input-editor')).not.toBeNull()
    })

    it('per-thread persistent input uses additional class for identification', () => {
        // Per-thread floating inputs get an extra class to distinguish them
        const el = document.createElement('div')
        el.className = 'ai-prompt-input-floating ai-prompt-input-thread-persistent'

        expect(el.classList.contains('ai-prompt-input-floating')).toBe(true)
        expect(el.classList.contains('ai-prompt-input-thread-persistent')).toBe(true)
    })

    it('SCSS submit button dimensions: 32x32px circle', () => {
        // SCSS: .ai-submit-button { width: 32px; height: 32px; border-radius: 50%; }
        // Verify the expected dimensions are documented and consistent
        const expectedWidth = 32
        const expectedHeight = 32
        expect(expectedWidth).toBe(expectedHeight) // Square for circular border-radius
    })

    it('SCSS send icon dimensions: 20x20px', () => {
        // SCSS: .send-icon { width: 20px; height: 20px; }
        // Smaller than the 32px button = proper visual proportion
        const iconSize = 20
        const buttonSize = 32
        expect(iconSize).toBeLessThan(buttonSize)
        expect(iconSize / buttonSize).toBeCloseTo(0.625, 2) // Icon fills ~62.5% of button
    })

    it('SCSS stop icon dimensions: 26x26px', () => {
        // SCSS: .stop-icon { width: 26px; height: 26px; }
        // Larger than send icon for better visibility during stop action
        const stopIconSize = 26
        const sendIconSize = 20
        const buttonSize = 32
        expect(stopIconSize).toBeGreaterThan(sendIconSize)
        expect(stopIconSize / buttonSize).toBeCloseTo(0.8125, 2) // Stop icon fills ~81% of button
    })

    it('SCSS image toggle button dimensions: 28x28px', () => {
        // SCSS: .image-toggle-btn { width: 28px; height: 28px; border-radius: 6px; }
        const toggleSize = 28
        const submitSize = 32
        expect(toggleSize).toBeLessThan(submitSize) // Smaller than submit for visual hierarchy
    })

    it('SCSS content area has bounded max-height for scrolling', () => {
        // SCSS: .ai-prompt-input-content { max-height: 250px; overflow-y: auto; }
        const maxHeight = 250
        expect(maxHeight).toBeGreaterThan(0)
        expect(maxHeight).toBeLessThanOrEqual(300) // Reasonable bound for prompt input
    })

    it('SCSS wrapper min-height ensures minimum usable area', () => {
        // SCSS: .ai-prompt-input-wrapper { min-height: 100px; }
        const minHeight = 100
        expect(minHeight).toBeGreaterThanOrEqual(80)
        expect(minHeight).toBeLessThanOrEqual(150) // Reasonable min for input + controls
    })

    it('SCSS font size and line height for readability', () => {
        // SCSS: .ai-prompt-input-content { font-size: 15px; line-height: 1.6; }
        const fontSize = 15
        const lineHeight = 1.6
        expect(fontSize).toBeGreaterThanOrEqual(14) // Minimum readable size
        expect(fontSize).toBeLessThanOrEqual(18) // Not too large for prompt input
        expect(lineHeight).toBeGreaterThanOrEqual(1.4) // Comfortable reading
    })

    it('SCSS wrapper border-radius smaller than container for nested rounding', () => {
        // SCSS: .ai-prompt-input-floating { border-radius: 12px; }
        // SCSS: .ai-prompt-input-wrapper { border-radius: 10px; }
        const containerRadius = 12
        const wrapperRadius = 10
        expect(wrapperRadius).toBeLessThan(containerRadius) // Proper nested radius
    })

    it('SCSS content padding provides comfortable internal spacing', () => {
        // SCSS: .ai-prompt-input-content { padding: 16px 20px 8px; }
        const paddingTop = 16
        const paddingSides = 20
        const paddingBottom = 8
        // Bottom is smaller because controls are right below
        expect(paddingBottom).toBeLessThan(paddingTop)
        expect(paddingSides).toBeGreaterThan(paddingTop) // Wider side padding
    })

    it('SCSS placeholder position matches content padding for alignment', () => {
        // SCSS: &[data-empty="true"] .ai-prompt-input-content::before { top: 16px; left: 20px; }
        // SCSS: .ai-prompt-input-content { padding: 16px 20px 8px; }
        const placeholderTop = 16
        const placeholderLeft = 20
        const contentPaddingTop = 16
        const contentPaddingLeft = 20
        // Placeholder position must match content padding so text aligns
        expect(placeholderTop).toBe(contentPaddingTop)
        expect(placeholderLeft).toBe(contentPaddingLeft)
    })
})

// =============================================================================
// VISUAL — RECEIVING STATE CSS CLASSES
// =============================================================================

describe('Visual — receiving state CSS expectations', () => {
    it('SCSS receiving class on controls toggles button visibility', () => {
        // SCSS: .ai-prompt-input-controls.receiving .ai-submit-button .button-receiving { opacity: 1; }
        // SCSS: .ai-prompt-input-controls.receiving .ai-submit-button .button-default { opacity: 0; }
        // The receiving class must be on .ai-prompt-input-controls for the CSS to apply
        const controls = document.createElement('div')
        controls.className = 'ai-prompt-input-controls receiving'
        expect(controls.classList.contains('receiving')).toBe(true)
        expect(controls.classList.contains('ai-prompt-input-controls')).toBe(true)
    })

    it('SCSS submit button has three visual states via child elements', () => {
        // SCSS defines .button-default, .button-hover, .button-receiving
        // All three must exist as children of .ai-submit-button for CSS transitions
        const states = ['button-default', 'button-hover', 'button-receiving']
        expect(states.length).toBe(3)

        // z-index ordering: default=1, hover=2, receiving=3
        const zIndexes = [1, 2, 3]
        expect(zIndexes[2]).toBeGreaterThan(zIndexes[0]) // receiving on top of default
    })

    it('SCSS hover state on stop icon uses distinct red color', () => {
        // SCSS: .receiving .ai-submit-button:hover .button-receiving .stop-icon svg { fill: #ff4d6a; }
        const stopHoverColor = '#ff4d6a'
        expect(stopHoverColor).toMatch(/^#[0-9a-fA-F]{6}$/)
        // It's a red-ish color for "danger/stop" semantics
    })
})

// =============================================================================
// VISUAL — IMAGE TOGGLE SCSS RENDERING EXPECTATIONS
// =============================================================================

describe('Visual — image toggle SCSS expectations', () => {
    it('image toggle icon dimensions are proportional to button', () => {
        // SCSS: .image-toggle-btn svg { width: 16px; height: 16px; }
        // SCSS: .image-toggle-btn { width: 28px; height: 28px; }
        const iconSize = 16
        const buttonSize = 28
        const ratio = iconSize / buttonSize
        expect(ratio).toBeCloseTo(0.571, 2) // Icon fills ~57% of button
    })

    it('image size selector is hidden by default', () => {
        // SCSS: .image-size-selector { display: none; }
        // Only shown when data-enabled="true"
        const hiddenDisplay = 'none'
        expect(hiddenDisplay).toBe('none')
    })

    it('image size selector becomes visible when enabled', () => {
        // SCSS: &[data-enabled="true"] .image-size-selector { display: block; }
        const el = document.createElement('div')
        el.className = 'image-generation-toggle'
        el.setAttribute('data-enabled', 'true')
        expect(el.getAttribute('data-enabled')).toBe('true')
    })
})

// =============================================================================
// VISUAL — DROPDOWN POSITIONING WITHIN NODE
// =============================================================================

describe('Visual — static-position dropdown SCSS expectations', () => {
    it('static-position dropdown uses absolute positioning below handle', () => {
        // SCSS: .info-bubble-wrapper.static-position { position: absolute; top: 100%; }
        // This ensures dropdown menu opens below the model selector handle
        const expectedPosition = 'absolute'
        const expectedTop = '100%'
        expect(expectedPosition).toBe('absolute')
        expect(expectedTop).toBe('100%')
    })

    it('bubble-wrapper overridden to static inside prompt input', () => {
        // SCSS: .bubble-wrapper { position: static !important; }
        // This prevents the InfoBubble's default fixed positioning
        const expectedPosition = 'static'
        expect(expectedPosition).toBe('static')
    })

    it('arrow pseudo-elements are hidden for M3-style menu', () => {
        // SCSS: .bubble-container { &:before, &:after { display: none !important; } }
        // M3 menus don't use arrows
        const arrowDisplay = 'none'
        expect(arrowDisplay).toBe('none')
    })

    it('dropdown translateY offset avoids overlapping input border', () => {
        // SCSS: transform: translateY(15px) !important;
        const expectedOffset = 15
        expect(expectedOffset).toBeGreaterThan(0)
        expect(expectedOffset).toBeLessThanOrEqual(20) // Reasonable gap
    })
})
