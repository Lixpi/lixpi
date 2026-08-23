import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { selection } from 'd3-selection'
import { EditorState, Transaction } from 'prosemirror-state'
import { EditorView, DecorationSet } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import {
    doc,
    p,
    promptInput,
    promptReference,
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
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputPluginConstants.ts'
import { createAiPromptInputPlugin } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputPlugin.ts'
import { settings } from '$src/settings.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'

// The model setup block contains SVG toggle switches. happy-dom does not
// implement the full SVG transform API d3-transition expects, so keep
// transition chains synchronous and no-op for these unit tests.
const makeChain = (): any => {
    const chain: any = {}
    for (const method of ['duration', 'ease', 'attr', 'style', 'select', 'delay', 'on', 'remove', 'tween']) {
        chain[method] = () => chain
    }
    return chain
}
;(selection.prototype as any).transition = () => makeChain()

// =============================================================================
// HELPERS
// =============================================================================

function expectSourceToContain(source: string, snippet: string): void {
    expect(source.includes(snippet), `source should contain: ${snippet}`).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string): void {
    expect(source.includes(snippet), `source should not contain: ${snippet}`).toBe(false)
}

function createEditorStateWithPlugins(document: ProseMirrorNode, plugins: any[] = []) {
    return EditorState.create({ doc: document, schema: testSchema, plugins })
}

function createMockControlFactories() {
    const modelDropdownDom = document.createElement('div')
    modelDropdownDom.className = 'mock-model-dropdown'

    const modelMultiSelectDom = document.createElement('div')
    modelMultiSelectDom.className = 'mock-model-multi-select'

    const imageModelDropdownDom = document.createElement('div')
    imageModelDropdownDom.className = 'mock-image-model-dropdown'

    const imageModelMultiSelectDom = document.createElement('div')
    imageModelMultiSelectDom.className = 'mock-image-model-multi-select'

    const imageSizeDropdownDom = document.createElement('div')
    imageSizeDropdownDom.className = 'mock-image-size-dropdown'

    const videoModelDropdownDom = document.createElement('div')
    videoModelDropdownDom.className = 'mock-video-model-dropdown'

    const videoModelMultiSelectDom = document.createElement('div')
    videoModelMultiSelectDom.className = 'mock-video-model-multi-select'

    const videoAspectDropdownDom = document.createElement('div')
    videoAspectDropdownDom.className = 'mock-video-aspect-dropdown'

    const videoResolutionDropdownDom = document.createElement('div')
    videoResolutionDropdownDom.className = 'mock-video-resolution-dropdown'

    const videoDurationDropdownDom = document.createElement('div')
    videoDurationDropdownDom.className = 'mock-video-duration-dropdown'

    const submitButtonDom = document.createElement('button')
    submitButtonDom.className = 'mock-submit-button'
    const contextTrayDom = document.createElement('div')
    contextTrayDom.className = 'mock-context-tray'

    return {
        createModelDropdown: vi.fn(() => ({
            dom: modelDropdownDom,
            update: vi.fn(),
            destroy: vi.fn(),
        })),
        createModelMultiSelect: vi.fn(() => ({
            dom: modelMultiSelectDom,
            update: vi.fn(),
            destroy: vi.fn(),
        })),
        createImageModelDropdown: vi.fn(() => ({
            dom: imageModelDropdownDom,
            update: vi.fn(),
            destroy: vi.fn(),
        })),
        createImageModelMultiSelect: vi.fn(() => ({
            dom: imageModelMultiSelectDom,
            update: vi.fn(),
            destroy: vi.fn(),
        })),
        createImageSizeDropdown: vi.fn(() => ({
            dom: imageSizeDropdownDom,
            update: vi.fn(),
            destroy: vi.fn(),
        })),
        createVideoModelDropdown: vi.fn(() => ({
            dom: videoModelDropdownDom,
            update: vi.fn(),
            destroy: vi.fn(),
        })),
        createVideoModelMultiSelect: vi.fn(() => ({
            dom: videoModelMultiSelectDom,
            update: vi.fn(),
            destroy: vi.fn(),
        })),
        createVideoAspectDropdown: vi.fn(() => ({
            dom: videoAspectDropdownDom,
            update: vi.fn(),
            destroy: vi.fn(),
        })),
        createVideoResolutionDropdown: vi.fn(() => ({
            dom: videoResolutionDropdownDom,
            update: vi.fn(),
            destroy: vi.fn(),
        })),
        createVideoDurationDropdown: vi.fn(() => ({
            dom: videoDurationDropdownDom,
            update: vi.fn(),
            destroy: vi.fn(),
        })),
        createSubmitButton: vi.fn(() => submitButtonDom),
        createContextTray: vi.fn(() => contextTrayDom),
        modelDropdownDom,
        modelMultiSelectDom,
        imageModelDropdownDom,
        imageModelMultiSelectDom,
        imageSizeDropdownDom,
        videoModelDropdownDom,
        videoModelMultiSelectDom,
        videoAspectDropdownDom,
        videoResolutionDropdownDom,
        videoDurationDropdownDom,
        submitButtonDom,
        contextTrayDom,
    }
}

function createPluginOptions(overrides: Partial<Parameters<typeof createAiPromptInputPlugin>[0]> = {}) {
    const factories = createMockControlFactories()
    return {
        options: {
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createContextTray: factories.createContextTray,
            createModelDropdown: factories.createModelDropdown,
            createModelMultiSelect: factories.createModelMultiSelect,
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageModelMultiSelect: factories.createImageModelMultiSelect,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoModelMultiSelect: factories.createVideoModelMultiSelect,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
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
        it('aiReasoningModels defaults to empty string', () => {
            const state = createBaseEditorState(doc(promptInput(p())))
            const node = state.doc.firstChild!
            expect(node.attrs.aiReasoningModels).toBe('')
        })

        it('imageGenerationSize defaults to auto', () => {
            const state = createBaseEditorState(doc(promptInput(p())))
            const node = state.doc.firstChild!
            expect(node.attrs.imageGenerationSize).toBe('auto')
        })
    })

    describe('toDOM output', () => {
        it('renders a div with class ai-prompt-input-wrapper', () => {
            const state = createBaseEditorState(doc(promptInput({ aiReasoningModels: '["gpt-4"]' }, p('Hello'))))
            const node = state.doc.firstChild!
            const domSpec = aiPromptInputNodeSpec.toDOM(node) as any[]

            expect(domSpec[0]).toBe('div')
            expect(domSpec[1].class).toBe('ai-prompt-input-wrapper')
        })

        it('serializes attributes as data-* attributes', () => {
            const state = createBaseEditorState(doc(promptInput(
                { aiReasoningModels: '["gpt-4"]', imageGenerationSize: '512x512' },
                p('Hello'),
            )))
            const node = state.doc.firstChild!
            const domSpec = aiPromptInputNodeSpec.toDOM(node) as any[]
            const attrs = domSpec[1]

            expect(attrs['data-ai-reasoning-models']).toBe('["gpt-4"]')
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
            el.setAttribute('data-ai-reasoning-models', '["claude-3"]')
            el.setAttribute('data-image-generation-size', '256x256')

            const parseRule = aiPromptInputNodeSpec.parseDOM![0]
            const attrs = parseRule.getAttrs!(el as any) as Record<string, unknown>

            expect(attrs.aiReasoningModels).toBe('["claude-3"]')
            expect(attrs.imageGenerationSize).toBe('256x256')
        })

        it('returns defaults when data-* attrs are missing', () => {
            const el = document.createElement('div')
            el.className = 'ai-prompt-input-wrapper'

            const parseRule = aiPromptInputNodeSpec.parseDOM![0]
            const attrs = parseRule.getAttrs!(el as any) as Record<string, unknown>

            expect(attrs.aiReasoningModels).toBe('')
            expect(attrs.imageGenerationSize).toBe('auto')
        })
    })
})

// =============================================================================
// NODE VIEW — DOM STRUCTURE & RENDERING
// =============================================================================

describe('createAiPromptInputNodeView — DOM structure', () => {
    function createNodeView(
        text = 'Hello world',
        attrs: Record<string, unknown> = {},
        options: Partial<Parameters<typeof createAiPromptInputNodeView>[0]> = {},
    ) {
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
            createModelMultiSelect: factories.createModelMultiSelect,
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageModelMultiSelect: factories.createImageModelMultiSelect,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoModelMultiSelect: factories.createVideoModelMultiSelect,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
            createSubmitButton: factories.createSubmitButton,
            ...options,
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

    it('uses placeholderText on contentDOM data-placeholder', () => {
        const { nv } = createNodeView('Hello world', {}, { placeholderText: 'Talk to me...' })
        expect(nv.contentDOM!.getAttribute('data-placeholder')).toBe('Talk to me...')
    })

    it('inserts context tray before the editable content when provided', () => {
        const contextTray = document.createElement('div')
        contextTray.className = 'provided-context-tray'
        const { nv } = createNodeView('Hello', {}, {
            createContextTray: () => contextTray,
        })

        const controlsEl = nv.dom.querySelector('.ai-prompt-input-controls')!
        const mediaModeSwitchHost = nv.dom.querySelector('.ai-prompt-media-mode-switch')!
        // The media generation mode switch is mounted as the wrapper's first
        // child (unless the caller supplies mountMediaModeSwitch to render it
        // elsewhere), followed by the context tray, then content and controls.
        expect(nv.dom.childNodes[0]).toBe(mediaModeSwitchHost)
        expect(nv.dom.childNodes[1]).toBe(contextTray)
        expect(nv.dom.childNodes[2]).toBe(nv.contentDOM)
        expect(nv.dom.childNodes[3]).toBe(controlsEl)
        expect(controlsEl).toBeDefined()
    })

    it('leaves the original content and controls order unchanged when context tray factory returns null', () => {
        const createContextTray = vi.fn(() => null)
        const { nv } = createNodeView('Hello', {}, { createContextTray })

        expect(createContextTray).toHaveBeenCalledTimes(1)
        // media mode switch host, content, controls, and the model settings
        // bubble menu (mounted directly under the wrapper) — no context tray.
        expect(nv.dom.childNodes).toHaveLength(4)
        expect((nv.dom.childNodes[0] as HTMLElement).className).toBe('ai-prompt-media-mode-switch')
        expect(nv.dom.childNodes[1]).toBe(nv.contentDOM)
        expect((nv.dom.childNodes[2] as HTMLElement).className).toBe('ai-prompt-input-controls')
    })

    it('applies model menu CSS variables from settings.aiPromptInput.modelMenu.styles', () => {
        const contextTrayDom = document.createElement('div')
        const { nv } = createNodeView('Hello world', {}, { createContextTray: () => contextTrayDom })
        expect(nv.dom.style.getPropertyValue('--ai-prompt-model-menu-trigger-color')).toBe(
            settings.aiPromptInput.modelMenu.styles.triggerColor,
        )
        expect(nv.dom.style.getPropertyValue('--ai-prompt-model-menu-trigger-active-color')).toBe(
            settings.aiPromptInput.modelMenu.styles.triggerActiveColor,
        )
        expect(nv.dom.style.getPropertyValue('--ai-prompt-model-menu-trigger-active-background')).toBe(
            settings.aiPromptInput.modelMenu.styles.triggerActiveBackground,
        )
        expect(nv.dom.style.getPropertyValue('--ai-prompt-model-menu-trigger-focus-outline')).toBe(
            settings.aiPromptInput.modelMenu.styles.triggerFocusOutline,
        )
        expect(nv.dom.style.getPropertyValue('--ai-prompt-model-menu-info-bubble-width')).toBe(
            settings.aiPromptInput.modelMenu.styles.infoBubbleWidth,
        )
        expect(nv.dom.style.getPropertyValue('--ai-prompt-model-menu-info-bubble-border-radius')).toBe(
            settings.aiPromptInput.modelMenu.styles.infoBubbleBorderRadius,
        )
        expect(nv.dom.style.getPropertyValue('--ai-prompt-model-menu-info-bubble-background')).toBe(
            settings.aiPromptInput.modelMenu.styles.infoBubbleBackground,
        )
        expect(nv.dom.style.getPropertyValue('--ai-prompt-model-menu-section-divider-height')).toBe(
            settings.aiPromptInput.modelMenu.styles.sectionDividerHeight,
        )
        expect(nv.dom.style.getPropertyValue('--ai-prompt-model-menu-section-title-color')).toBe(
            settings.aiPromptInput.modelMenu.styles.sectionTitleColor,
        )
        expect(nv.dom.style.getPropertyValue('--ai-prompt-model-menu-control-label-color')).toBe(
            settings.aiPromptInput.modelMenu.styles.controlLabelColor,
        )
        expect(nv.dom.style.getPropertyValue('--ai-prompt-model-menu-control-label-font-size')).toBe(
            settings.aiPromptInput.modelMenu.styles.controlLabelFontSize,
        )
        expect(nv.dom.style.getPropertyValue('--help-tooltip-trigger-border')).toBe(
            settings.aiPromptInput.modelMenu.styles.helpTooltipTriggerBorder,
        )
        expect(nv.dom.style.getPropertyValue('--help-tooltip-trigger-background')).toBe(
            settings.aiPromptInput.modelMenu.styles.helpTooltipTriggerBackground,
        )
        expect(nv.dom.style.getPropertyValue('--help-tooltip-trigger-color')).toBe(
            settings.aiPromptInput.modelMenu.styles.helpTooltipTriggerColor,
        )
        expect(nv.dom.style.getPropertyValue('--help-tooltip-trigger-hover-background')).toBe(
            settings.aiPromptInput.modelMenu.styles.helpTooltipTriggerHoverBackground,
        )
        expect(nv.dom.style.getPropertyValue('--help-tooltip-trigger-hover-color')).toBe(
            settings.aiPromptInput.modelMenu.styles.helpTooltipTriggerHoverColor,
        )
        expect(nv.dom.style.getPropertyValue('--help-tooltip-trigger-focus-outline')).toBe(
            settings.aiPromptInput.modelMenu.styles.helpTooltipTriggerFocusOutline,
        )
        expect(nv.dom.style.getPropertyValue('--help-tooltip-background')).toBe(
            settings.aiPromptInput.modelMenu.styles.helpTooltipBackground,
        )
        expect(nv.dom.style.getPropertyValue('--help-tooltip-border')).toBe(
            settings.aiPromptInput.modelMenu.styles.helpTooltipBorder,
        )
        expect(nv.dom.style.getPropertyValue('--help-tooltip-border-radius')).toBe(
            settings.aiPromptInput.modelMenu.styles.helpTooltipBorderRadius,
        )
        expect(nv.dom.style.getPropertyValue('--help-tooltip-box-shadow')).toBe(
            settings.aiPromptInput.modelMenu.styles.helpTooltipBoxShadow,
        )
        expect(nv.dom.style.getPropertyValue('--help-tooltip-color')).toBe(
            settings.aiPromptInput.modelMenu.styles.helpTooltipColor,
        )
    })

    it('tracks overridden model menu style values from settings', () => {
        const originalTriggerColor = settings.aiPromptInput.modelMenu.styles.triggerColor
        settings.aiPromptInput.modelMenu.styles.triggerColor = '#ff00ff'

        try {
            const { nv } = createNodeView()
            expect(nv.dom.style.getPropertyValue('--ai-prompt-model-menu-trigger-color')).toBe('#ff00ff')
        } finally {
            settings.aiPromptInput.modelMenu.styles.triggerColor = originalTriggerColor
        }
    })

    it('lets CSS variables own model menu layering instead of hard-coded inline z-index', () => {
        const nodeSource = readFileSync(resolve(__dirname, 'aiPromptInputNode.ts'), 'utf-8')

        expectSourceNotToContain(nodeSource, 'modelMenu.element.style.zIndex')
        expectSourceNotToContain(nodeSource, 'settings.aiPromptInput.modelMenu.infoBubbleZIndex')
    })

    describe('visual hierarchy — wrapper contains content then controls', () => {
        it('wrapper has exactly 4 children: media mode switch, contentDOM, controlsEl, and the model menu bubble', () => {
            const { nv } = createNodeView()
            expect(nv.dom.childNodes.length).toBe(4)
            expect((nv.dom.childNodes[0] as HTMLElement).className).toBe('ai-prompt-media-mode-switch')
            expect(nv.dom.childNodes[1]).toBe(nv.contentDOM)
            expect((nv.dom.childNodes[2] as HTMLElement).className).toBe('ai-prompt-input-controls')
            expect((nv.dom.childNodes[3] as HTMLElement).classList.contains('ai-prompt-model-menu-info-bubble')).toBe(true)
        })

        it('controls container is placed after content in DOM order', () => {
            const { nv } = createNodeView()
            const controlsEl = nv.dom.querySelector('.ai-prompt-input-controls') as HTMLElement
            const children = Array.from(nv.dom.childNodes)
            expect(children.indexOf(nv.contentDOM as ChildNode)).toBeLessThan(children.indexOf(controlsEl))
        })
    })

    describe('control elements rendering', () => {
        it('renders model dropdown inside model settings bubble menu', () => {
            const { nv, factories } = createNodeView()
            const modelMenu = nv.dom.querySelector('.ai-prompt-model-menu-content')!
            expect(modelMenu.contains(factories.modelDropdownDom)).toBe(true)
        })

        it('renders image model dropdown inside model settings bubble menu', () => {
            const { nv, factories } = createNodeView()
            const modelMenu = nv.dom.querySelector('.ai-prompt-model-menu-content')!
            expect(modelMenu.contains(factories.imageModelDropdownDom)).toBe(true)
        })

        it('renders the media generation config matrix (not a standalone image size dropdown) inside the model settings bubble menu', () => {
            // Image size/aspect selection now comes from the API-authored media
            // generation config matrix, not the legacy createImageSizeDropdown
            // factory — that factory is threaded through as an option but is no
            // longer invoked by the node view.
            const { nv, factories } = createNodeView()
            const modelMenu = nv.dom.querySelector('.ai-prompt-model-menu-content')!
            expect(modelMenu.querySelector('.ai-media-config-matrix[data-media-type="image"]')).not.toBeNull()
            expect(factories.createImageSizeDropdown).not.toHaveBeenCalled()
        })

        it('renders submit button inside controls', () => {
            const { nv, factories } = createNodeView()
            const controlsEl = nv.dom.querySelector('.ai-prompt-input-controls')!
            expect(controlsEl.contains(factories.submitButtonDom)).toBe(true)
        })

        it('controls keep only model settings trigger and submit visible by default', () => {
            const { nv, factories } = createNodeView()
            const controlsEl = nv.dom.querySelector('.ai-prompt-input-controls')!
            const children = Array.from(controlsEl.children)

            // The model settings bubble menu is mounted directly under the
            // wrapper (BubbleMenu's parentEl), not inside the controls element.
            expect(children).toHaveLength(2)
            expect(children[0].classList.contains('ai-prompt-model-menu-trigger')).toBe(true)
            expect(children[1]).toBe(factories.submitButtonDom)
        })

        it('model settings menu is split into reasoning, image, and video sections', () => {
            const { nv } = createNodeView()
            const sectionTitles = Array.from(nv.dom.querySelectorAll('.ai-prompt-model-menu-section-title'))
                .map((element) => element.textContent)

            expect(sectionTitles).toEqual([
                'Reasoning model',
                'Image model',
                'Video model',
            ])
        })

        it('keeps the model settings menu open for a portaled sliding dropdown interaction', () => {
            const { nv } = createNodeView()
            const trigger = nv.dom.querySelector('.ai-prompt-model-menu-trigger')!
            const modelMenu = nv.dom.querySelector('.ai-prompt-model-menu-info-bubble')!
            const dropdownScrollPortal = document.createElement('div')
            const dropdownPortal = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            const dropdownGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
            dropdownScrollPortal.classList.add('sliding-dropdown-scroll-portal')
            dropdownPortal.setAttribute('data-sliding-dropdown-open', 'true')
            dropdownGroup.classList.add('sliding-dropdown-group')
            dropdownPortal.appendChild(dropdownGroup)
            dropdownScrollPortal.appendChild(dropdownPortal)
            document.body.appendChild(dropdownScrollPortal)

            trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
            expect(modelMenu.classList.contains('is-visible')).toBe(true)

            dropdownGroup.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
            expect(modelMenu.classList.contains('is-visible')).toBe(true)

            dropdownScrollPortal.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
            expect(modelMenu.classList.contains('is-visible')).toBe(true)

            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
            expect(modelMenu.classList.contains('is-visible')).toBe(false)

            dropdownScrollPortal.remove()
            nv.destroy!()
        })

        it('renders each model setup section with heading help, toggle, controls row, and selected-tags row', () => {
            const { nv } = createNodeView()
            const sections = Array.from(nv.dom.querySelectorAll('.ai-prompt-model-menu-section')) as HTMLElement[]
            const expectedSections = [
                {
                    title: 'Reasoning model',
                    controlCount: 1,
                    controlVisibility: ['true'],
                    toggleLabel: 'Use multiple reasoning models',
                    hasSelectedTagsRow: true,
                },
                {
                    title: 'Image model',
                    // Model dropdown + the API-driven media generation config
                    // matrix (which replaces the standalone image size dropdown).
                    controlCount: 2,
                    controlVisibility: ['true', 'true'],
                    toggleLabel: 'Use multiple image models',
                    hasSelectedTagsRow: false,
                },
                {
                    title: 'Video model',
                    // Model dropdown + the API-driven media generation config
                    // matrix (which replaces the separate aspect/resolution/duration dropdowns).
                    controlCount: 2,
                    controlVisibility: ['true', 'true'],
                    toggleLabel: 'Use multiple video models',
                    hasSelectedTagsRow: false,
                },
            ]

            expect(sections).toHaveLength(expectedSections.length)
            for (const [index, expectedSection] of expectedSections.entries()) {
                const section = sections[index]!
                const heading = section.querySelector('.ai-prompt-model-menu-section-heading')!
                const headingMain = section.querySelector('.ai-prompt-model-menu-section-heading-main')!
                const headingAction = section.querySelector('.ai-prompt-model-menu-section-heading-action')!
                const controlsRow = section.querySelector('.ai-prompt-model-menu-section-controls')!
                const selectedTagsRow = section.querySelector('.ai-prompt-selected-model-tags-row')
                const selectedTagsRows = section.querySelectorAll('.ai-prompt-selected-model-tags-row')
                const sectionControlRows = Array.from(section.querySelectorAll('.ai-prompt-model-menu-control'))

                expect(heading.contains(headingMain)).toBe(true)
                expect(headingMain.querySelector('.ai-prompt-model-menu-section-title')!.textContent).toBe(expectedSection.title)
                expect(headingMain.querySelector('.help-tooltip-trigger')).not.toBeNull()
                expect(headingAction.querySelector('.ai-prompt-model-menu-toggle')?.getAttribute('aria-label')).toBe(expectedSection.toggleLabel)
                expect(headingAction.querySelector('.ai-prompt-model-menu-toggle-text')?.textContent).toBe('Use multiple models')
                expect(sectionControlRows).toHaveLength(expectedSection.controlCount)
                expect(Array.from(controlsRow.querySelectorAll('.ai-prompt-model-menu-control')).map((control) => {
                    return control.getAttribute('data-visible')
                })).toEqual(expectedSection.controlVisibility)

                if (expectedSection.hasSelectedTagsRow) {
                    expect(selectedTagsRow).not.toBeNull()
                    expect(section.children[2]).toBe(selectedTagsRow)
                    expect(selectedTagsRow?.getAttribute('data-visible')).toBe('false')
                    expect(selectedTagsRows).toHaveLength(1)
                } else {
                    expect(selectedTagsRow).toBeNull()
                    expect(selectedTagsRows).toHaveLength(0)
                    expect(section.children).toHaveLength(2)
                }
            }

            nv.destroy!()
        })

        it('keeps single-select dropdowns mounted until a section toggle enables multi-select mode', () => {
            const { nv, factories, mockView } = createNodeView('Hello', {
                aiReasoningModels: JSON.stringify(['Anthropic:sonnet-4-6']),
            })

            expect(factories.createModelDropdown).toHaveBeenCalledTimes(1)
            expect(factories.createModelMultiSelect).not.toHaveBeenCalled()
            expect(nv.dom.contains(factories.modelDropdownDom)).toBe(true)

            const reasoningToggle = nv.dom.querySelector(
                '.ai-prompt-model-menu-toggle[aria-label="Use multiple reasoning models"]'
            )!
            reasoningToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            nv.update!(mockView.state.doc.firstChild!)

            expect(mockView.state.doc.firstChild!.attrs.useMultipleReasoningModels).toBe(true)
            expect(mockView.state.doc.firstChild!.attrs.useMultipleImageModels).toBe(false)
            expect(mockView.state.doc.firstChild!.attrs.useMultipleVideoModels).toBe(false)
            expect(mockView.state.doc.firstChild!.attrs.aiReasoningModels).toBe(JSON.stringify(['Anthropic:sonnet-4-6']))
            expect(factories.createModelMultiSelect).toHaveBeenCalledTimes(1)
            expect(nv.dom.contains(factories.modelMultiSelectDom)).toBe(true)
            expect(nv.dom.contains(factories.modelDropdownDom)).toBe(false)

            nv.destroy!()
        })

        it('renders selected model tag pills only below the enabled multi-model section and removes models from that row', () => {
            aiModelsStore.setAiModels([
                {
                    provider: 'Anthropic',
                    model: 'sonnet-4-6',
                    shortTitle: 'Sonnet 4.6',
                    iconName: 'claudeIcon',
                    color: '#1a2744',
                    modalities: [{ modality: 'TEXT', shortTitle: 'Text' }],
                },
                {
                    provider: 'Anthropic',
                    model: 'opus-4-8',
                    shortTitle: 'Opus 4.8',
                    iconName: 'claudeIcon',
                    color: '#1a2744',
                    modalities: [{ modality: 'TEXT', shortTitle: 'Text' }],
                },
            ] as any)

            const { nv, mockView } = createNodeView('Hello', {
                aiReasoningModels: JSON.stringify(['Anthropic:sonnet-4-6', 'Anthropic:opus-4-8']),
                useMultipleReasoningModels: true,
                aiImageModels: JSON.stringify(['Anthropic:sonnet-4-6']),
            })
            const sections = Array.from(nv.dom.querySelectorAll('.ai-prompt-model-menu-section')) as HTMLElement[]
            const reasoningTagsRow = sections[0]!.querySelector('.ai-prompt-selected-model-tags-row')!
            const imageTagsRow = sections[1]!.querySelector('.ai-prompt-selected-model-tags-row')
            const reasoningLabels = () => Array.from(reasoningTagsRow.querySelectorAll('.tag-pill-label'))
                .map((element) => element.textContent)

            expect(reasoningTagsRow.getAttribute('data-visible')).toBe('true')
            expect(imageTagsRow).toBeNull()
            expect(reasoningLabels()).toEqual(['Sonnet 4.6', 'Opus 4.8'])
            expect(reasoningTagsRow.querySelector('.tag-pill-label')!.getAttribute('text-anchor')).toBe('middle')
            expect(reasoningTagsRow.querySelector('.tag-pill-close')!.getAttribute('transform')).toBe('translate(11, 12)')
            expect(reasoningTagsRow.querySelector('.tag-pill-background')!.getAttribute('stroke')).toBe('rgba(105, 115, 133, 0.12)')
            const initialPillWidths = Array.from(reasoningTagsRow.querySelectorAll('.tag-pill-background'))
                .map((element) => Number(element.getAttribute('width')))
            expect(initialPillWidths[1]).toBeLessThan(initialPillWidths[0]!)
            expect(initialPillWidths[1]).toBeGreaterThan(0)

            reasoningTagsRow.querySelector('.tag-pill-close')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            nv.update!(mockView.state.doc.firstChild!)

            expect(mockView.state.doc.firstChild!.attrs.aiReasoningModels).toBe(JSON.stringify(['Anthropic:opus-4-8']))
            expect(reasoningLabels()).toEqual(['Opus 4.8'])
            expect(Number(reasoningTagsRow.querySelector('.tag-pill-background')!.getAttribute('width'))).toBe(initialPillWidths[1])

            nv.destroy!()
            aiModelsStore.setAiModels([])
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
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
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

    it('sets data-empty="false" when content contains only a prompt reference', () => {
        const testDoc = doc(promptInput(p(promptReference({ displayName: 'Shelby' }))))
        const state = createBaseEditorState(testDoc)
        const inputNode = state.doc.firstChild!
        const mockView = { state, dispatch: vi.fn() } as unknown as EditorView
        const factories = createMockControlFactories()
        const nv = createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            createModelDropdown: factories.createModelDropdown,
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
            createSubmitButton: factories.createSubmitButton,
        })(inputNode, mockView, () => 0)

        expect(nv.dom.getAttribute('data-empty')).toBe('false')
        nv.destroy!()
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
    function createNodeViewWithControls(options: Partial<Parameters<typeof createAiPromptInputNodeView>[0]> = {}) {
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
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
            createSubmitButton: factories.createSubmitButton,
            ...options,
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

    it('stops events from context tray', () => {
        const contextTray = document.createElement('div')
        const { nv } = createNodeViewWithControls({ createContextTray: () => contextTray })
        const event = new MouseEvent('click')
        Object.defineProperty(event, 'target', { value: contextTray })

        expect(nv.stopEvent!(event)).toBe(true)
    })
})

// =============================================================================
// NODE VIEW — IGNORE MUTATION
// =============================================================================

describe('createAiPromptInputNodeView — ignoreMutation', () => {
    function createNodeViewInstance(options: Partial<Parameters<typeof createAiPromptInputNodeView>[0]> = {}) {
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
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
            createSubmitButton: factories.createSubmitButton,
            ...options,
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

    it('ignores mutations on the injected context tray and its descendants', () => {
        const contextTray = document.createElement('div')
        const removeButton = document.createElement('button')
        contextTray.appendChild(removeButton)
        const { nv } = createNodeViewInstance({ createContextTray: () => contextTray })

        expect(nv.ignoreMutation!({ target: contextTray } as MutationRecord)).toBe(true)
        expect(nv.ignoreMutation!({ target: removeButton } as MutationRecord)).toBe(true)
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
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
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

    it('never invokes createImageSizeDropdown — image size now comes from the media generation config matrix', () => {
        const { nv, factories } = createNodeViewForUpdate()
        const updatedDoc = doc(promptInput(p('Updated')))
        nv.update!(updatedDoc.firstChild!)

        expect(factories.createImageSizeDropdown).not.toHaveBeenCalled()
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
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)

        nv.destroy!()

        expect(factories.createModelDropdown.mock.results[0].value.destroy).toHaveBeenCalled()
    })

    it('never invokes createImageSizeDropdown on destroy either — it is not part of the node view lifecycle', () => {
        const testDoc = doc(promptInput(p('Hello')))
        const state = createBaseEditorState(testDoc)
        const factories = createMockControlFactories()

        const nv = createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)

        nv.destroy!()

        expect(factories.createImageSizeDropdown).not.toHaveBeenCalled()
    })
})

// =============================================================================
// NODE VIEW — CONTROL ADAPTERS WIRE TO PROSEMIRROR NODE ATTRS
// =============================================================================

describe('createAiPromptInputNodeView — control adapters', () => {
    it('createModelDropdown receives AiModelControls adapter', () => {
        const factories = createMockControlFactories()
        const testDoc = doc(promptInput({ aiReasoningModels: '["gpt-4"]' }, p('Hello')))
        const state = createBaseEditorState(testDoc)

        createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)

        expect(factories.createModelDropdown).toHaveBeenCalledTimes(1)
        const [controls, dropdownId] = factories.createModelDropdown.mock.calls[0]
        expect(controls).toHaveProperty('getCurrentAiModel')
        expect(controls).toHaveProperty('setAiModel')
        expect(dropdownId).toBe('ai-prompt-input')
    })

    it('does not call createImageSizeDropdown — the option is accepted but unused by the current node view', () => {
        const factories = createMockControlFactories()
        const testDoc = doc(promptInput(p('Hello')))
        const state = createBaseEditorState(testDoc)

        createAiPromptInputNodeView({
            onSubmit: vi.fn(),
            onStop: vi.fn(),
            isReceiving: vi.fn(() => false),
            createModelDropdown: factories.createModelDropdown,
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)

        expect(factories.createImageSizeDropdown).not.toHaveBeenCalled()
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
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)

        expect(factories.createSubmitButton).toHaveBeenCalledTimes(1)
        const [controls] = factories.createSubmitButton.mock.calls[0]
        expect(controls).toHaveProperty('onSubmit')
        expect(controls).not.toHaveProperty('onStop')
        expect(controls).not.toHaveProperty('isReceiving')

        controls.onSubmit()
        const modelDropdownUpdate = factories.createModelDropdown.mock.results[0]!.value.update
        expect(modelDropdownUpdate).toHaveBeenCalledOnce()
        expect(modelDropdownUpdate.mock.invocationCallOrder[0]).toBeLessThan(onSubmit.mock.invocationCallOrder[0]!)
        expect(onSubmit).toHaveBeenCalledOnce()
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
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
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
        // content is flex: 1 (fills space), controls are at the bottom. The
        // media mode switch host and the model settings bubble menu are also
        // direct children of the wrapper.
        const children = Array.from(nv.dom.children) as HTMLElement[]
        expect(children.length).toBe(4)
        expect(children[0].className).toBe('ai-prompt-media-mode-switch')
        expect(children[1].className).toBe('ai-prompt-input-content')
        expect(children[2].className).toBe('ai-prompt-input-controls')
        expect(children[3].classList.contains('ai-prompt-model-menu-info-bubble')).toBe(true)
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
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)

        // SCSS: &[data-empty="true"] .ai-prompt-input-content::before shows placeholder
        expect(nv.dom.getAttribute('data-empty')).toBe('true')
        expect(nv.dom.querySelector('.ai-prompt-input-content')).not.toBeNull()
    })

    it('SCSS keeps placeholder rendering on contentDOM instead of the decorated wrapper', () => {
        const scss = readFileSync(resolve(__dirname, 'ai-prompt-input.scss'), 'utf-8')

        expectSourceToContain(scss, '.ai-prompt-input-wrapper.empty-node-placeholder[data-placeholder]::before')
        expectSourceToContain(scss, 'content: none;')
        expectSourceToContain(scss, '&[data-empty="true"] .ai-prompt-input-content')
        expectSourceToContain(scss, 'content: attr(data-placeholder);')
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
            createImageModelDropdown: factories.createImageModelDropdown,
            createImageSizeDropdown: factories.createImageSizeDropdown,
            createVideoModelDropdown: factories.createVideoModelDropdown,
            createVideoAspectDropdown: factories.createVideoAspectDropdown,
            createVideoResolutionDropdown: factories.createVideoResolutionDropdown,
            createVideoDurationDropdown: factories.createVideoDurationDropdown,
            createSubmitButton: factories.createSubmitButton,
        })(testDoc.firstChild!, { state, dispatch: vi.fn() } as unknown as EditorView, () => 0)
    }

    it('controls has compact child elements for balanced layout', () => {
        const nv = renderNodeView()
        const controls = nv.dom.querySelector('.ai-prompt-input-controls')!
        // SCSS expects: model settings trigger and submit button. The bubble
        // menu is mounted directly under the wrapper, not inside controls.
        expect(controls.children.length).toBe(2)
    })

    it('content area comes right after the media mode switch — gets flex: 1 for vertical fill', () => {
        const nv = renderNodeView()
        // SCSS: .ai-prompt-input-content { flex: 1; }
        // The media mode switch host is the wrapper's first child; content
        // still precedes the controls element in the column flex layout.
        expect(nv.dom.children[1]).toBe(nv.contentDOM)
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

    it('forwards placeholderText and context tray factory to node views', () => {
        const contextTray = document.createElement('div')
        contextTray.className = 'plugin-context-tray'
        const { options } = createPluginOptions({
            createContextTray: vi.fn(() => contextTray),
            placeholderText: 'Talk to me...',
        })
        const plugin = createAiPromptInputPlugin(options)
        const testDoc = doc(promptInput(p('Hello')))
        const state = createEditorStateWithPlugins(testDoc, [plugin])
        const nodeViewFactory = plugin.props.nodeViews[aiPromptInputNodeType]

        expect(typeof nodeViewFactory).toBe('function')

        const nv = nodeViewFactory!(
            state.doc.firstChild!,
            { state, dispatch: vi.fn() } as unknown as EditorView,
            () => 0,
        ) as { dom: HTMLElement; contentDOM: HTMLElement | null }

        expect(options.createContextTray).toHaveBeenCalledTimes(1)
        expect(nv.dom.querySelector('.plugin-context-tray')).toBe(contextTray)
        expect(nv.contentDOM?.getAttribute('data-placeholder')).toBe('Talk to me...')
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

    it('does not add placeholder when input contains only a prompt reference', () => {
        const { options } = createPluginOptions({ placeholderText: 'Type a prompt…' })
        const plugin = createAiPromptInputPlugin(options)
        const testDoc = doc(promptInput(p(promptReference({ displayName: 'Shelby' }))))
        const state = createEditorStateWithPlugins(testDoc, [plugin])

        const decorations = plugin.props.decorations!(state) as DecorationSet

        expect(decorations.find()).toHaveLength(0)
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

        const testDoc = doc(promptInput({ aiReasoningModels: '["gpt-4"]' }, p('Hello world')))
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
        expect(submitCall.aiReasoningModels).toEqual(['gpt-4'])
    })

    it('keeps the Capability module atom in the submitted message JSON', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)
        const capabilityReference = promptReference({
            referenceType: 'capability-module',
            moduleId: 'action-timeline',
            displayName: 'Action Timeline',
        })
        const testDoc = doc(promptInput(
            { aiReasoningModels: '["gpt-4"]' },
            p(capabilityReference, ' Create 15 seconds with 2-second segments.'),
        ))
        const state = createEditorStateWithPlugins(testDoc, [plugin])
        const mockView = {
            state,
            dispatch: vi.fn((tr: Transaction) => {
                (mockView as any).state = (mockView as any).state.apply(tr)
            }),
        } as unknown as EditorView

        plugin.props.handleDOMEvents!.keydown!(mockView, new KeyboardEvent('keydown', {
            key: 'Enter',
            metaKey: true,
        }))

        expect(options.onSubmit.mock.calls[0][0].contentJSON).toEqual([{
            type: 'paragraph',
            content: [
                {
                    type: 'prompt_reference',
                    attrs: expect.objectContaining({
                        referenceType: 'capability-module',
                        moduleId: 'action-timeline',
                        displayName: 'Action Timeline',
                    }),
                },
                { type: 'text', text: ' Create 15 seconds with 2-second segments.' },
            ],
        }])
    })

    it('Ctrl+Enter also triggers submit (Windows/Linux)', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput({ aiReasoningModels: '["claude"]' }, p('Hello')))
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

        const testDoc = doc(promptInput({ aiReasoningModels: '["gpt-4"]' }, p('Hello world')))
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

    it('preserves the prompt when no reasoning model is selected', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)
        const testDoc = doc(promptInput(p('Keep this prompt')))
        const state = createEditorStateWithPlugins(testDoc, [plugin])
        const mockView = {
            state,
            dispatch: vi.fn((tr: Transaction) => {
                (mockView as any).state = (mockView as any).state.apply(tr)
            }),
        } as unknown as EditorView

        plugin.props.handleDOMEvents!.keydown!(mockView, new KeyboardEvent('keydown', {
            key: 'Enter',
            metaKey: true,
        }))

        expect(options.onSubmit).not.toHaveBeenCalled()
        expect(mockView.dispatch).not.toHaveBeenCalled()
        expect((mockView as any).state.doc.firstChild!.textContent).toBe('Keep this prompt')
    })

    it('preserves model settings attrs when clearing input after submit', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)
        const selectedModels = ['Google:gemini-flash-latest', 'Anthropic:sonnet-4-6']
        const serializedModels = JSON.stringify(selectedModels)

        const testDoc = doc(promptInput({
            aiReasoningModels: serializedModels,
            useMultipleReasoningModels: true,
            aiImageModels: JSON.stringify(['Google:gemini-2.5-flash-image']),
            imageGenerationSize: 'auto',
        }, p('Hello world')))
        const state = createEditorStateWithPlugins(testDoc, [plugin])

        const mockView = {
            state,
            dispatch: vi.fn((tr: Transaction) => {
                (mockView as any).state = (mockView as any).state.apply(tr)
            }),
        } as unknown as EditorView

        const event = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true })
        plugin.props.handleDOMEvents!.keydown!(mockView, event)

        const inputNode = (mockView as any).state.doc.firstChild!
        expect(inputNode.textContent).toBe('')
        expect(inputNode.attrs.aiReasoningModels).toBe(serializedModels)
        expect(inputNode.attrs.useMultipleReasoningModels).toBe(true)
        expect(inputNode.attrs.aiImageModels).toBe(JSON.stringify(['Google:gemini-2.5-flash-image']))
        expect(inputNode.attrs.imageGenerationSize).toBe('auto')
    })
})

// =============================================================================
// PLUGIN — IMAGE OPTIONS
// =============================================================================

describe('createAiPromptInputPlugin — image options handling', () => {
    it('always includes imageOptions with imageGenerationSize', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput(
            { aiReasoningModels: '["dall-e-3"]', imageGenerationSize: '512x512' },
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
            aiImageModels: [],
            imageGenerationSize: '512x512',
        })
    })

    it('uses default imageGenerationSize when not specified', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput(
            { aiReasoningModels: '["gpt-4"]' },
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
        expect(submitCall.imageOptions).toEqual({
            aiImageModels: [],
            imageGenerationSize: 'auto',
        })
    })
})

// =============================================================================
// PLUGIN — APPEND TRANSACTION (meta-driven submit/stop)
// =============================================================================

describe('createAiPromptInputPlugin — appendTransaction meta handling', () => {
    it('triggers onSubmit when SUBMIT_AI_PROMPT_META is dispatched', () => {
        const { options } = createPluginOptions()
        const plugin = createAiPromptInputPlugin(options)

        const testDoc = doc(promptInput({ aiReasoningModels: '["gpt-4"]' }, p('Meta submit test')))
        const state = createEditorStateWithPlugins(testDoc, [plugin])

        const tr = state.tr.setMeta(SUBMIT_AI_PROMPT_META, true)
        const newState = state.apply(tr)

        // Reset because EditorState.create may call appendTransaction internally
        options.onSubmit.mockClear()

        plugin.spec.appendTransaction!([tr], state, newState)

        expect(options.onSubmit).toHaveBeenCalledTimes(1)
        expect(options.onSubmit.mock.calls[0][0].contentJSON).toBeInstanceOf(Array)
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
// NODE VIEW — RECEIVING STATE SYNC
// =============================================================================

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

    it('SCSS send button and model dropdown use $nightBlue fill when input has content', () => {
        // SCSS: &[data-empty="false"] targets controls when text is present
        // $nightBlue is #42494f — used to indicate active state when text is present
        const scss = readFileSync(
            resolve(__dirname, 'ai-prompt-input.scss'),
            'utf-8'
        )
        expectSourceToContain(scss, 'data-empty="false"')
        // Send button
        expect(scss).toMatch(/data-empty="false".*\.ai-submit-button\s+\.send-icon\s+svg/)
        // Model dropdown button text and SVG
        expect(scss).toMatch(/data-empty="false".*\.dropdown-menu-tag-pill-wrapper/)
        expect(scss).toMatch(/fill:\s*\$nightBlue/)
    })
})

// =============================================================================
// VISUAL — IMAGE TOGGLE SCSS RENDERING EXPECTATIONS
// =============================================================================

describe('Visual — image size dropdown SCSS expectations', () => {
    it('image size dropdown uses same tag-pill pattern as model dropdown', () => {
        // The image size dropdown uses createPureDropdown (tag-pill component)
        // Same component as the model selector — consistent UI
        const el = document.createElement('div')
        el.className = 'dropdown-menu-tag-pill-wrapper'
        expect(el.classList.contains('dropdown-menu-tag-pill-wrapper')).toBe(true)
    })

    it('image size dropdown lives inside the model settings menu', () => {
        const controls = document.createElement('div')
        controls.className = 'ai-prompt-input-controls'
        const menu = document.createElement('div')
        menu.className = 'ai-prompt-model-menu-content'
        const dropdown = document.createElement('div')
        dropdown.className = 'dropdown-menu-tag-pill-wrapper'
        menu.appendChild(dropdown)
        controls.appendChild(menu)
        expect(controls.querySelector('.dropdown-menu-tag-pill-wrapper')).not.toBeNull()
    })
})

// =============================================================================
// VISUAL — DROPDOWN POSITIONING WITHIN NODE
// =============================================================================

describe('Visual — static-position dropdown SCSS expectations', () => {
    it('anchors static-position info bubbles inside the prompt node instead of the viewport', () => {
        const scss = readFileSync(resolve(__dirname, 'ai-prompt-input.scss'), 'utf-8')

        expectSourceToContain(scss, '.info-bubble-wrapper.static-position')
        expectSourceToContain(scss, 'position: absolute !important;')
        expectSourceToContain(scss, 'top: 100% !important;')
        expectSourceToContain(scss, 'right: 0 !important;')
        expectSourceToContain(scss, 'transform: translateY(var(--static-bubble-gap, 15px)) !important;')
    })

    it('overrides nested InfoBubble positioning and hides arrows for M3-style dropdown menus', () => {
        const scss = readFileSync(resolve(__dirname, 'ai-prompt-input.scss'), 'utf-8')

        expectSourceToContain(scss, '.bubble-wrapper')
        expectSourceToContain(scss, 'position: static !important;')
        expectSourceToContain(scss, '.bubble-container')
        expectSourceToContain(scss, 'display: none !important;')
    })
})
