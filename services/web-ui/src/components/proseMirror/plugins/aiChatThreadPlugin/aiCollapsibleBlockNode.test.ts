'use strict'

import { describe, it, expect, vi } from 'vitest'
import {
    schema,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import {
    aiCollapsibleBlockNodeView,
    cacheImageGenerationTrace,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiCollapsibleBlockNode.ts'
import type { ImageGenerationTrace, VideoGenerationTrace } from '@lixpi/constants'

vi.mock('$src/services/auth-service.ts', () => ({
    default: {
        getTokenSilently: vi.fn(async () => 'token-1'),
    },
}))

function createTrace(overrides: Partial<ImageGenerationTrace> = {}): ImageGenerationTrace {
    return {
        traceVersion: 'image-generation-trace-v1',
        chatModelProvider: 'Anthropic',
        chatModelId: 'claude-sonnet-4-6',
        imageModelProvider: 'Google',
        imageModelId: 'gemini-2.5-flash-image',
        imageSize: '1:1',
        toolPrompt: 'Paint the same man in orange monochrome.',
        finalPrompt: 'MANDATORY /use FEATURE TRANSFER\nPaint the same man in orange monochrome.',
        promptWasChanged: true,
        referenceImages: [
            {
                id: 'branch:person-generated',
                source: 'branch-candidate',
                imageUrl: 'nats-obj://workspace-workspace-1-files/person-file',
                label: 'painted portrait of the man',
                role: 'target',
                nodeId: 'person-generated',
                fileId: 'person-file',
                workspaceId: 'workspace-1',
                branchId: 'branch-person',
                reason: 'selected generated portrait branch',
            },
            {
                id: 'branch:landscape-source',
                source: 'branch-candidate',
                imageUrl: '/api/images/workspace-1/landscape-file',
                label: 'landscape painting',
                role: 'style-reference',
                nodeId: 'landscape-source',
                fileId: 'landscape-file',
                workspaceId: 'workspace-1',
                reason: 'style source',
            },
        ],
        excludedReferences: [
            {
                nodeId: 'goat-generated',
                label: 'painted goat',
                role: 'excluded',
                reason: 'different subject branch',
                branchId: 'branch-goat',
            },
        ],
        resolver: {
            resolverKind: 'structured-vlm',
            resolverVersion: 'image-branch-vlm-v1',
            resolverModelProvider: 'Anthropic',
            resolverModelId: 'claude-sonnet-4-6',
            mode: 'edit-active-branch',
            operationKind: 'style_transfer',
            confidence: 0.91,
            rationale: 'Continue the generated portrait branch and exclude the goat branch.',
            targetImageNodeId: 'person-generated',
            parentImageNodeId: 'person-generated',
            branchId: 'branch-person',
        },
        ...overrides,
    }
}

function createCollapsibleNodeView(attrs: Record<string, unknown> = {}) {
    const node = schema.nodes.aiCollapsibleBlock.create(
        { title: 'Image generation prompt', isOpen: false, isStreaming: false, ...attrs },
        schema.nodes.paragraph.create(null, schema.text('Prompt body')),
    )

    const transaction = {
        setNodeMarkup: vi.fn().mockReturnThis(),
    }

    const mockView = {
        state: {
            tr: transaction,
            doc: {
                nodeAt: vi.fn(() => node),
            },
        },
        editable: true,
        dispatch: vi.fn(),
    }

    const getPos = vi.fn(() => 3)
    const nodeView = aiCollapsibleBlockNodeView(node, mockView, getPos)

    return { nodeView, mockView, transaction, getPos }
}

describe('aiCollapsibleBlockNodeView', () => {
    it('toggles open state and syncs it back to the node on summary click', () => {
        const { nodeView, mockView, transaction } = createCollapsibleNodeView()
        const summary = nodeView.dom.querySelector('summary') as HTMLElement

        summary.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        summary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

        expect((nodeView.dom as HTMLDetailsElement).open).toBe(true)
        expect(transaction.setNodeMarkup).toHaveBeenCalledWith(
            3,
            undefined,
            expect.objectContaining({ isOpen: true }),
        )
        expect(mockView.dispatch).toHaveBeenCalledWith(transaction)
    })

    it('stops summary mousedown from bubbling to ancestor DOM handlers', () => {
        const { nodeView } = createCollapsibleNodeView()
        const summary = nodeView.dom.querySelector('summary') as HTMLElement
        const parent = document.createElement('div')
        const ancestorMouseDownHandler = vi.fn()

        parent.addEventListener('mousedown', ancestorMouseDownHandler)
        parent.appendChild(nodeView.dom)

        summary.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

        expect(ancestorMouseDownHandler).not.toHaveBeenCalled()
    })

    it('ignores wrapper open attribute mutations from the manual toggle', () => {
        const { nodeView } = createCollapsibleNodeView()

        const mutation = {
            type: 'attributes',
            attributeName: 'open',
            target: nodeView.dom,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(mutation)).toBe(true)
    })

    it('stopEvent captures summary interactions but not content interactions', () => {
        const { nodeView } = createCollapsibleNodeView()
        const summary = nodeView.dom.querySelector('summary') as HTMLElement
        const content = nodeView.contentDOM as HTMLElement

        const summaryEvent = { target: summary } as unknown as Event
        const contentEvent = { target: content } as unknown as Event

        expect(nodeView.stopEvent!(summaryEvent)).toBe(true)
        expect(nodeView.stopEvent!(contentEvent)).toBe(false)
    })

    it('update syncs the summary label, streaming class, and open state', () => {
        const { nodeView } = createCollapsibleNodeView()
        const updatedNode = schema.nodes.aiCollapsibleBlock.create(
            { title: 'Revised prompt', isOpen: true, isStreaming: true },
            schema.nodes.paragraph.create(null, schema.text('Updated prompt body')),
        )

        const result = nodeView.update!(updatedNode)
        const summary = nodeView.dom.querySelector('summary') as HTMLElement

        expect(result).toBe(true)
        expect(summary.textContent).toBe('Preparing image generation prompt')
        expect(nodeView.dom.classList.contains('is-streaming')).toBe(true)
        expect((nodeView.dom as HTMLDetailsElement).open).toBe(true)
    })

    it('update returns false for a different node type', () => {
        const { nodeView } = createCollapsibleNodeView()
        const wrongNode = schema.nodes.paragraph.create(null, schema.text('Nope'))

        expect(nodeView.update!(wrongNode)).toBe(false)
    })

    it('renders trace summary, final prompt, resolver audit, and exclusions while collapsed', () => {
        const { nodeView } = createCollapsibleNodeView({ imageGenerationTrace: createTrace() })

        expect(nodeView.dom.querySelector('.ai-collapsible-block-summary-title')?.textContent).toBe('Image generation details')
        expect(nodeView.dom.querySelector('.ai-collapsible-block-summary-meta')?.textContent).toBe('2 references')
        expect(nodeView.dom.querySelector('.ai-image-generation-final-prompt-section')?.hasAttribute('hidden')).toBe(false)
        expect(nodeView.dom.querySelector('.ai-image-generation-final-prompt')?.textContent).toContain('MANDATORY /use FEATURE TRANSFER')
        expect(nodeView.dom.querySelector('.ai-image-generation-resolver-summary')?.textContent).toBe('Style Transfer | Edit Active Branch | confidence 91%')
        expect(nodeView.dom.querySelector('.ai-image-generation-resolver-rationale')?.textContent).toContain('exclude the goat branch')
        expect(nodeView.dom.querySelector('.ai-image-generation-excluded-label')?.textContent).toBe('painted goat')
        expect(nodeView.dom.querySelector('.ai-image-generation-excluded-node')?.textContent).toBe('goat-generated')
        expect(nodeView.dom.querySelector('.ai-image-generation-reference-grid')?.childElementCount).toBe(0)
    })

    it('renders reference image tiles only after the details block is opened', () => {
        const { nodeView } = createCollapsibleNodeView({ imageGenerationTrace: createTrace() })
        const summary = nodeView.dom.querySelector('summary') as HTMLElement

        summary.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        summary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

        const tiles = Array.from(nodeView.dom.querySelectorAll('.ai-image-generation-reference'))
        expect(tiles).toHaveLength(2)
        expect(tiles[0].getAttribute('data-source')).toBe('branch-candidate')
        expect(tiles[0].getAttribute('data-role')).toBe('target')
        expect(tiles[0].querySelector('.ai-image-generation-reference-label')?.textContent).toBe('painted portrait of the man')
        expect(tiles[0].querySelector('.ai-image-generation-reference-role')?.textContent).toBe('Target')
        expect(tiles[1].querySelector('.ai-image-generation-reference-role')?.textContent).toBe('Style Reference')
    })

    it('keeps the final prompt section hidden when the image prompt was not changed', () => {
        const trace = createTrace({
            finalPrompt: 'Paint the same man in orange monochrome.',
            promptWasChanged: false,
        })
        const { nodeView } = createCollapsibleNodeView({ imageGenerationTrace: trace })

        expect(nodeView.dom.querySelector('.ai-image-generation-final-prompt-section')?.hasAttribute('hidden')).toBe(true)
        expect(nodeView.dom.querySelector('.ai-image-generation-final-prompt')?.textContent).toBe('')
    })

    it('can render a cached trace by id without needing inline trace attrs', () => {
        cacheImageGenerationTrace('trace-1', createTrace({ referenceImages: [] }))
        const { nodeView } = createCollapsibleNodeView({ imageGenerationTraceId: 'trace-1' })

        expect(nodeView.dom.querySelector('.ai-collapsible-block-summary-title')?.textContent).toBe('Image generation details')
        expect(nodeView.dom.querySelector('.ai-collapsible-block-summary-meta')?.textContent).toBe('0 references')
    })

    it('renders a video generation trace through the same collapsible (parity with images)', () => {
        // The video trace reuses the image trace's reference/excluded/resolver
        // shape, so the same renderer must surface it — only the title differs.
        const videoTrace: VideoGenerationTrace = {
            traceVersion: 'video-generation-trace-v1',
            chatModelProvider: 'Anthropic',
            chatModelId: 'claude-sonnet-4-6',
            videoModelProvider: 'Google',
            videoModelId: 'veo-3.0-generate-001',
            aspectRatio: '16:9',
            resolution: '1080p',
            durationSeconds: 6,
            toolPrompt: 'Animate the seaside village at dawn.',
            finalPrompt: 'Animate the seaside village at dawn.',
            promptWasChanged: false,
            referenceImages: [
                {
                    id: 'branch:video-generated',
                    source: 'branch-candidate',
                    imageUrl: 'nats-obj://workspace-workspace-1-files/video-frame-file',
                    label: 'seaside village still',
                    role: 'target',
                    nodeId: 'video-generated',
                    fileId: 'video-frame-file',
                    workspaceId: 'workspace-1',
                    branchId: 'branch-video',
                    reason: 'continue the seaside clip',
                },
            ],
            excludedReferences: [],
            resolver: {
                resolverKind: 'structured-vlm',
                resolverVersion: 'image-branch-vlm-v1',
                resolverModelProvider: 'Anthropic',
                resolverModelId: 'claude-sonnet-4-6',
                mode: 'edit-active-branch',
                operationKind: 'edit_existing',
                confidence: 0.88,
                rationale: 'Continue the seaside clip branch.',
                targetImageNodeId: 'video-generated',
                parentImageNodeId: 'video-generated',
                branchId: 'branch-video',
            },
        }
        const { nodeView } = createCollapsibleNodeView({ videoGenerationTrace: videoTrace })

        expect(nodeView.dom.querySelector('.ai-collapsible-block-summary-title')?.textContent).toBe('Video generation details')
        expect(nodeView.dom.querySelector('.ai-collapsible-block-summary-meta')?.textContent).toBe('1 reference')
        expect(nodeView.dom.querySelector('.ai-image-generation-resolver-summary')?.textContent).toBe('Edit Existing | Edit Active Branch | confidence 88%')
        expect(nodeView.dom.querySelector('.ai-image-generation-resolver-rationale')?.textContent).toContain('seaside clip branch')
    })

})
