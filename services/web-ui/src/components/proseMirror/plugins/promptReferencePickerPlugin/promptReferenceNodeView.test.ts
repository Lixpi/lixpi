import {
    LEGACY_CAPABILITY_REFERENCE_NODE_TYPE,
    PROMPT_REFERENCE_NODE_TYPE,
} from '@lixpi/prosemirror'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'

import {
    atomIcon,
    documentIcon,
    fileIcon,
    imageIcon,
    promptIcon,
    videoPlayGlyphIcon,
    videoVolumeHighGlyphIcon,
} from '$src/svgIcons/index.ts'
import {
    createStateWithNodeSelection,
    createStateWithTextSelection,
    doc,
    findNodePosition,
    p,
    promptReference,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import { createMockEditorView } from '$src/components/proseMirror/plugins/testUtils/testHelpers.ts'
import {
    createPromptReferenceNodeViewPlugin,
    getPromptReferenceIcon,
    PromptReferenceNodeView,
} from './promptReferenceNodeView.ts'

describe('PromptReferenceNodeView', () => {
    it.each([
        ['media', 'image', imageIcon],
        ['media', 'video', videoPlayGlyphIcon],
        ['media', 'audio', videoVolumeHighGlyphIcon],
        ['media', 'document', documentIcon],
        ['capability-module', '', atomIcon],
        ['tool', '', promptIcon],
        ['skill', '', fileIcon],
    ] as const)('uses an existing SVG for %s %s references', (referenceType, mediaKind, icon) => {
        expect(getPromptReferenceIcon(referenceType, mediaKind)).toBe(icon)
    })

    it('renders only the existing icon and cosmetic name without trigger characters', () => {
        const node = promptReference({
            referenceType: 'media',
            assetId: 'asset-1',
            mediaKind: 'image',
            displayName: 'Character Sheet',
        })
        const nodeView = new PromptReferenceNodeView(node)

        expect(nodeView.dom.querySelector('.prompt-reference-chip-content')?.textContent).toBe('Character Sheet')
        expect(nodeView.dom.classList.contains('prompt-reference-chip-media')).toBe(true)
        expect(nodeView.dom.querySelector('.prompt-reference-chip-icon svg')).not.toBeNull()
        expect(nodeView.dom.textContent?.includes('@')).toBe(false)
        expect(nodeView.dom.textContent?.includes('/')).toBe(false)
    })

    it('keeps identical markup and asks ProseMirror to recreate changed reference markup', () => {
        const mediaNode = promptReference({
            referenceType: 'media',
            assetId: 'asset-1',
            mediaKind: 'image',
            displayName: 'Character Sheet',
        })
        const nodeView = new PromptReferenceNodeView(mediaNode)
        const capabilityNode = promptReference({
            referenceType: 'capability-module',
            assetId: '',
            mediaKind: '',
            moduleId: 'character-creator',
            displayName: 'Character Creator',
        })

        expect(nodeView.update(mediaNode)).toBe(true)
        expect(nodeView.update(capabilityNode)).toBe(false)
        expect(nodeView.update(p('Different node type'))).toBe(false)
    })

    it('uses the shared context-preview card with the inline reference label as its trigger', async () => {
        const node = promptReference({
            referenceType: 'media',
            assetId: 'asset-1',
            mediaKind: 'image',
            displayName: 'Character Sheet',
        })
        const nodeView = new PromptReferenceNodeView(node, {
            getNode: () => ({
                type: 'image',
                nodeId: 'image-node-1',
                assetId: 'asset-1',
                position: { x: 0, y: 0 },
                dimensions: { width: 640, height: 480 },
            }),
            environment: {
                getDocuments: () => [],
                getThreads: () => [],
                getAsset: () => undefined,
                getApiBaseUrl: () => '',
                getAuthToken: async () => '',
            },
        })
        document.body.appendChild(nodeView.dom)

        expect(nodeView.dom.classList.contains('workspace-ai-chat-panel-context-preview-tooltip-inline-label')).toBe(true)
        expect(nodeView.dom.querySelector('.workspace-ai-chat-panel-context-preview-trigger-inline-label')).not.toBeNull()
        expect(nodeView.dom.querySelector('.workspace-ai-chat-panel-context-preview-image-mini')).toBeNull()
        expect(nodeView.dom.querySelector('.prompt-reference-chip-content')?.textContent).toBe('Character Sheet')

        const trigger = nodeView.dom.querySelector('.help-tooltip-trigger') as HTMLElement
        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await Promise.resolve()

        const preview = document.body.querySelector('.help-tooltip-content') as HTMLElement
        expect(preview.querySelector('.workspace-ai-chat-panel-context-preview-image-large')).not.toBeNull()
        expect(preview.querySelector('.workspace-ai-chat-panel-context-preview-popover-title')?.textContent)
            .toBe('Character Sheet')

        nodeView.destroy()
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
    })

    it('registers renderers for current and persisted legacy reference atoms', () => {
        const nodeViews = createPromptReferenceNodeViewPlugin().props.nodeViews

        expect(nodeViews).toHaveProperty(PROMPT_REFERENCE_NODE_TYPE)
        expect(nodeViews).toHaveProperty(LEGACY_CAPABILITY_REFERENCE_NODE_TYPE)
    })

    it.each([
        ['ArrowRight', 'before', 1, 2],
        ['ArrowLeft', 'after', 2, 1],
    ] as const)('moves %s directly from %s the atom to its opposite side', (key, _side, start, expected) => {
        const documentNode = doc(p(promptReference({ displayName: 'Character Sheet' })))
        const state = createStateWithTextSelection(documentNode, start, start)
        const view = createMockEditorView({ state })
        const event = new KeyboardEvent('keydown', { key, cancelable: true })
        const plugin = createPromptReferenceNodeViewPlugin()

        expect(plugin.props.handleKeyDown?.(view, event)).toBe(true)
        expect(event.defaultPrevented).toBe(true)
        expect(view.state.selection).toBeInstanceOf(TextSelection)
        expect(view.state.selection.from).toBe(expected)
        expect(view.state.selection.to).toBe(expected)
    })

    it.each([
        ['ArrowLeft', 1],
        ['ArrowRight', 2],
    ] as const)('converts a prompt-reference NodeSelection into a visible text caret for %s', (key, expected) => {
        const documentNode = doc(p(promptReference({ displayName: 'Character Sheet' })))
        const nodePosition = findNodePosition(documentNode, PROMPT_REFERENCE_NODE_TYPE)
        if (nodePosition === null) throw new Error('Missing prompt reference in test document')
        const state = createStateWithNodeSelection(documentNode, nodePosition)
        expect(state.selection).toBeInstanceOf(NodeSelection)
        const view = createMockEditorView({ state })
        const event = new KeyboardEvent('keydown', { key, cancelable: true })

        expect(createPromptReferenceNodeViewPlugin().props.handleKeyDown?.(view, event)).toBe(true)
        expect(view.state.selection).toBeInstanceOf(TextSelection)
        expect(view.state.selection.from).toBe(expected)
    })

    it('leaves modified arrow-key selection behavior to ProseMirror', () => {
        const documentNode = doc(p(promptReference({ displayName: 'Character Sheet' })))
        const view = createMockEditorView({
            state: createStateWithTextSelection(documentNode, 1, 1),
        })
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            shiftKey: true,
            cancelable: true,
        })

        expect(createPromptReferenceNodeViewPlugin().props.handleKeyDown?.(view, event)).toBe(false)
        expect(event.defaultPrevented).toBe(false)
        expect(view.state.selection.from).toBe(1)
    })
})
