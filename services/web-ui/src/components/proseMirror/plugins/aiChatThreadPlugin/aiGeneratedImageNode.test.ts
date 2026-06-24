'use strict'

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { testSchema as schema } from '$src/components/proseMirror/plugins/testUtils/testSchema.ts'
import {
    aiGeneratedImageNodeSpec,
    aiGeneratedImageNodeView,
    getAiGeneratedImageCallbacks,
    setAiGeneratedImageCallbacks,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts'
import AuthService from '$src/services/auth-service.ts'

vi.mock('$src/services/auth-service.ts', () => ({
    default: {
        getTokenSilently: vi.fn(),
    },
}))

beforeEach(() => {
    vi.mocked(AuthService.getTokenSilently).mockReset().mockResolvedValue('token-1')
})

const createImageNode = (overrides: Record<string, unknown> = {}) => {
    return schema.nodes.aiGeneratedImage.create({
        imageData: 'data:image/png;base64,AAA',
        fileId: 'image-file',
        workspaceId: 'workspace-id',
        revisedPrompt: 'A reference',
        responseId: 'response-id',
        aiModel: 'Google:gemini-2.5-flash-image',
        isPartial: false,
        partialIndex: 0,
        width: '112px',
        alignment: 'right',
        textWrap: 'none',
        generationRequestId: 'req-id',
        reasoningRunId: 'reasoning-run',
        mediaRunId: 'media-run',
        reasoningModelId: 'reasoning-model',
        mediaModelId: 'media-model',
        mediaType: 'image',
        variantIndex: null,
        ...overrides,
    })
}

const createNodeView = (overrides: Record<string, unknown> = {}, getPos: () => number | undefined = () => 0) => {
    const node = createImageNode(overrides)
    const doc = schema.nodes.doc.create(null, [node])
    const state = EditorState.create({ doc, schema })

    const dispatch = vi.fn()
    const focus = vi.fn()

    const view = {
        state,
        dispatch,
        focus,
        editable: true,
    }

    const nodeView = aiGeneratedImageNodeView(node as any, view as any, getPos)
    return { nodeView, node, dispatch, focus, state, doc, view: view as any }
}

// =============================================================================
// aiGeneratedImageNodeSpec
// =============================================================================

describe('aiGeneratedImageNodeSpec', () => {
    it('serializes and parses media metadata attrs', () => {
        const node = createImageNode({
            imageData: '/api/images/workspace-1/file',
            fileId: 'img-1',
            workspaceId: 'workspace-1',
            responseId: 'resp-1',
            variantIndex: 3,
            mediaType: 'image',
        })

        const domSpec = aiGeneratedImageNodeSpec.toDOM(node) as any[]

        expect(domSpec[0]).toBe('div')
        expect(domSpec[1].class).toBe('ai-generated-image')
        expect(domSpec[1]['data-image-data']).toBe('/api/images/workspace-1/file')
        expect(domSpec[1]['data-file-id']).toBe('img-1')
        expect(domSpec[1]['data-workspace-id']).toBe('workspace-1')
        expect(domSpec[1]['data-revised-prompt']).toBe('A reference')
        expect(domSpec[1]['data-response-id']).toBe('resp-1')
        expect(domSpec[1]['data-variant-index']).toBe('3')

        const parseRule = aiGeneratedImageNodeSpec.parseDOM[0]
        const parsedNode = parseRule.getAttrs!(createFakeNodeElement('/api/images/workspace-1/file', '3')) as Record<string, any>

        expect(parsedNode.variantIndex).toBe(3)
        expect(parsedNode.imageData).toBe('/api/images/workspace-1/file')
        expect(parsedNode.mediaType).toBe('image')
    })

    it('parses invalid variant indexes to null', () => {
        const parseRule = aiGeneratedImageNodeSpec.parseDOM![0]
        const parsedNode = parseRule.getAttrs!(createFakeNodeElement('data', 'bad')) as Record<string, any>

        expect(parsedNode.variantIndex).toBeNull()
    })
})

function createFakeNodeElement(imageData: string, variantIndex: string): HTMLElement {
    const node = document.createElement('div')
    node.className = 'ai-generated-image'
    node.dataset.imageData = imageData
    node.dataset.fileId = 'img-1'
    node.dataset.workspaceId = 'workspace-1'
    node.dataset.revisedPrompt = 'A reference'
    node.dataset.responseId = 'resp-1'
    node.dataset.aiModel = 'Google:gemini'
    node.dataset.isPartial = 'false'
    node.dataset.partialIndex = '0'
    node.dataset.generationRequestId = 'gen-1'
    node.dataset.reasoningRunId = 'reason-run'
    node.dataset.mediaRunId = 'media-run'
    node.dataset.reasoningModelId = 'reason-model'
    node.dataset.mediaModelId = 'media-model'
    node.dataset.mediaType = 'image'
    node.dataset.variantIndex = variantIndex
    return node
}

// =============================================================================
// callback registry
// =============================================================================

describe('aiGeneratedImageNode callback registry', () => {
    it('stores callbacks in a shared module registry', () => {
        const callbacks = { onImageErrorToCanvas: vi.fn() }

        setAiGeneratedImageCallbacks(callbacks)

        expect(getAiGeneratedImageCallbacks()).toBe(callbacks)
    })
})

// =============================================================================
// aiGeneratedImageNodeView
// =============================================================================

describe('aiGeneratedImageNodeView', () => {
    it('shows spinner while image data is not yet available', async () => {
        const { nodeView } = createNodeView({
            imageData: '',
            isPartial: true,
        })

        await Promise.resolve()

        const spinner = nodeView.dom.querySelector('.ai-generated-image-spinner') as HTMLElement
        const image = nodeView.dom.querySelector('.ai-generated-image-content') as HTMLImageElement

        expect(spinner.classList.contains('is-active')).toBe(true)
        expect(image.classList.contains('is-visible')).toBe(false)
    })

    it('builds authenticated API image URLs for /api imageData', async () => {
        const { nodeView } = createNodeView({
            imageData: '/api/images/workspace-images/final-file',
            isPartial: false,
        })
        const image = nodeView.dom.querySelector('.ai-generated-image-content') as HTMLImageElement

        await Promise.resolve()

        expect(AuthService.getTokenSilently).toHaveBeenCalledTimes(1)
        expect(image.src).toContain('/api/images/workspace-images/final-file?token=token-1')
    })

    it('replaces stale tokenized image URLs with a refreshed token', async () => {
        vi.mocked(AuthService.getTokenSilently).mockResolvedValue('fresh-token')

        const { nodeView } = createNodeView({
            imageData: 'https://cdn.example.com/api/images/workspace-images/final-file?token=stale',
            isPartial: false,
        })
        const image = nodeView.dom.querySelector('.ai-generated-image-content') as HTMLImageElement

        await Promise.resolve()

        expect(image.src).not.toContain('token=stale')
        expect(image.src).toContain('token=fresh-token')
    })

    it('falls back to inline base64 URL construction for legacy payloads', async () => {
        const { nodeView } = createNodeView({
            imageData: 'legacy-base64-string',
            isPartial: false,
        })
        const image = nodeView.dom.querySelector('.ai-generated-image-content') as HTMLImageElement

        await Promise.resolve()

        expect(image.src).toBe('data:image/png;base64,legacy-base64-string')
    })

    it('renders media metadata pills and updates them on node changes', async () => {
        const { nodeView } = createNodeView({
            mediaModelId: 'Google:gemini-flash-image',
            variantIndex: 0,
            isPartial: true,
        })
        const meta = nodeView.dom.querySelector('.ai-generated-media-run-meta') as HTMLElement

        await Promise.resolve()

        expect(meta.hidden).toBe(false)
        expect(meta.textContent).toContain('gemini-flash-image')
        expect(meta.textContent).toContain('Google')

        const updatedNode = createImageNode({
            mediaModelId: 'OpenAI:gpt-4.1',
            variantIndex: 2,
            isPartial: false,
            imageData: '/api/images/workspace-images/updated',
        })

        const updated = nodeView.update(updatedNode)

        expect(updated).toBe(true)
        expect(meta.textContent).toContain('gpt-4.1')
        expect(meta.textContent).toContain('OpenAI')
    })

    it('transitions from pending to complete image state and applies authenticated /api URL', async () => {
        const { nodeView } = createNodeView({
            imageData: '',
            isPartial: true,
        })
        const spinner = nodeView.dom.querySelector('.ai-generated-image-spinner') as HTMLElement
        const image = nodeView.dom.querySelector('.ai-generated-image-content') as HTMLImageElement

        await Promise.resolve()
        expect(spinner.classList.contains('is-active')).toBe(true)
        expect(image.classList.contains('is-visible')).toBe(false)

        const updatedNode = createImageNode({
            imageData: '/api/images/workspace-images/new-file',
            isPartial: false,
        })
        const updated = nodeView.update(updatedNode)

        await Promise.resolve()
        expect(updated).toBe(true)
        expect(spinner.classList.contains('is-active')).toBe(false)
        expect(image.classList.contains('is-visible')).toBe(true)
        expect(image.src).toContain('/api/images/workspace-images/new-file?token=token-1')
    })

    it('adds an inline error placeholder only once when image fails to load', async () => {
        const { nodeView } = createNodeView()
        const image = nodeView.dom.querySelector('.ai-generated-image-content') as HTMLImageElement

        await Promise.resolve()
        image.dispatchEvent(new Event('error'))

        const placeholder = nodeView.dom.querySelector('.image-error-placeholder')
        expect(placeholder).toBeDefined()
        expect(image.style.display).toBe('none')

        image.dispatchEvent(new Event('error'))
        expect(nodeView.dom.querySelectorAll('.image-error-placeholder')).toHaveLength(1)
    })

    it('selects the image node and focuses the editor on click', async () => {
        const node = createImageNode()
        const doc = schema.nodes.doc.create(null, [node])
        const dispatch = vi.fn()
        const focus = vi.fn()
        const state = EditorState.create({ doc, schema })
        const getPos = () => 0
        const nodeView = aiGeneratedImageNodeView(node as any, { state, dispatch, focus, editable: true } as any, getPos)

        nodeView.dom.dispatchEvent(new MouseEvent('click'))

        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(focus).toHaveBeenCalledTimes(1)
        const tr = dispatch.mock.calls[0]![0]
        expect(tr.selection.toJSON()).toMatchObject({ type: 'node', anchor: 0 })
        const selection = tr.selection
        expect(selection.from).toBe(0)
    })

    it('returns false when a different node type is passed to update()', () => {
        const { nodeView } = createNodeView()
        const wrongNode = schema.nodes.doc.create()

        expect(nodeView.update(wrongNode as any)).toBe(false)
    })

    it('does not intercept all DOM events via stopEvent', () => {
        const { nodeView } = createNodeView()

        expect(nodeView.stopEvent!({ target: nodeView.dom as HTMLElement } as Event)).toBe(false)
    })

    it('removes click handler on destroy', () => {
        const { nodeView } = createNodeView()
        const removeSpy = vi.spyOn(nodeView.dom, 'removeEventListener')

        nodeView.destroy()

        expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function))
    })
})
