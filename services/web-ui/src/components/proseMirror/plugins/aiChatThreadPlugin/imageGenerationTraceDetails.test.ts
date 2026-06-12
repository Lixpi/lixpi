'use strict'

import { describe, it, expect, vi } from 'vitest'

import { createImageGenerationTraceDetails } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/imageGenerationTraceDetails.ts'
import type { ImageGenerationTrace, ImageGenerationTraceReference } from '@lixpi/constants'

vi.mock('$src/services/auth-service.ts', () => ({
    default: {
        getTokenSilently: vi.fn(async () => 'token-1'),
    },
}))

function makeReference(overrides: Partial<ImageGenerationTraceReference> = {}): ImageGenerationTraceReference {
    return {
        id: 'branch:person',
        imageUrl: 'nats-obj://workspace-workspace-1-files/person-file',
        source: 'branch-candidate',
        label: 'painted portrait of the man',
        role: 'target',
        nodeId: 'person',
        fileId: 'person-file',
        workspaceId: 'workspace-1',
        ...overrides,
    }
}

function makeTrace(referenceImages: ImageGenerationTraceReference[]): ImageGenerationTrace {
    return {
        traceVersion: 'image-generation-trace-v1',
        chatModelProvider: 'Anthropic',
        chatModelId: 'claude-sonnet-4-6',
        imageModelProvider: 'Google',
        imageModelId: 'gemini-2.5-flash-image',
        imageSize: '1:1',
        toolPrompt: 'Paint the man.',
        finalPrompt: 'Paint the man.',
        promptWasChanged: false,
        referenceImages,
        excludedReferences: [],
    }
}

type RenderOptions = Parameters<typeof createImageGenerationTraceDetails>[0]

function renderTiles(referenceImages: ImageGenerationTraceReference[], options: RenderOptions = {}) {
    const details = createImageGenerationTraceDetails(options)
    details.renderReferenceGrid(makeTrace(referenceImages))
    const tiles = Array.from(details.dom.querySelectorAll('.ai-image-generation-reference')) as HTMLElement[]
    const image = details.dom.querySelector('.ai-image-generation-reference-image') as HTMLImageElement
    const unavailable = details.dom.querySelector('.ai-image-generation-reference-unavailable') as HTMLSpanElement
    return { details, tiles, image, unavailable }
}

// =============================================================================
// REFERENCE TILE — LOAD/VISIBILITY CONTRACT
// The tile starts hidden and reveals itself in `onload`. That makes the load
// strategy load-bearing: a hidden image is `display:none`, so `loading="lazy"`
// would never enter the viewport, never load, never fire `onload`, and the
// thumbnail would stay blank forever. These tests pin that contract.
// =============================================================================

describe('createImageGenerationTraceDetails — reference tile load contract', () => {
    it('never marks the reference image loading="lazy" (a hidden lazy image never loads)', () => {
        const { image } = renderTiles([makeReference()])
        expect(image.getAttribute('loading')).not.toBe('lazy')
    })

    it('starts the image and the unavailable hint hidden', () => {
        const { image, unavailable } = renderTiles([makeReference()])
        expect(image.hidden).toBe(true)
        expect(unavailable.hidden).toBe(true)
    })

    it('reveals the image once it loads', () => {
        const { tiles, image, unavailable } = renderTiles([makeReference()])
        image.dispatchEvent(new Event('load'))
        expect(image.hidden).toBe(false)
        expect(unavailable.hidden).toBe(true)
        expect(tiles[0].classList.contains('is-unavailable')).toBe(false)
    })

    it('shows the unavailable hint when every source errors', async () => {
        const { tiles, image, unavailable } = renderTiles([makeReference()])
        await vi.waitFor(() => expect(image.src).not.toBe(''))
        image.dispatchEvent(new Event('error'))
        await vi.waitFor(() => expect(unavailable.hidden).toBe(false))
        expect(image.hidden).toBe(true)
        expect(tiles[0].classList.contains('is-unavailable')).toBe(true)
    })
})

// =============================================================================
// REFERENCE TILE — SOURCE RESOLUTION
// =============================================================================

describe('createImageGenerationTraceDetails — reference source resolution', () => {
    it('resolves a nats-obj:// reference to an authenticated /api/images URL', async () => {
        const { image } = renderTiles([makeReference({ imageUrl: 'nats-obj://workspace-workspace-1-files/person-file' })])
        await vi.waitFor(() => expect(image.src).toContain('/api/images/workspace-1/person-file'))
        expect(image.src).toContain('token=token-1')
    })

    it('falls back to fileId/workspaceId when imageUrl is empty', async () => {
        const { image } = renderTiles([makeReference({ imageUrl: '' })])
        await vi.waitFor(() => expect(image.src).toContain('/api/images/workspace-1/person-file'))
    })

    it('retries the next source (e.g. the canvas in-memory image) when the primary errors', async () => {
        const { image } = renderTiles(
            [makeReference({ imageUrl: 'http://example.com/primary.png', fileId: undefined, workspaceId: undefined })],
            { getAdditionalReferenceImageSources: () => ['blob:canvas-fallback'] },
        )
        await vi.waitFor(() => expect(image.src).toContain('http://example.com/primary.png'))
        image.dispatchEvent(new Event('error'))
        await vi.waitFor(() => expect(image.src).toContain('blob:canvas-fallback'))
    })
})

// =============================================================================
// REFERENCE GRID
// =============================================================================

describe('createImageGenerationTraceDetails — reference grid', () => {
    it('renders one tile per reference with the formatted role', () => {
        const { tiles } = renderTiles([
            makeReference({ id: 'a', role: 'target' }),
            makeReference({ id: 'b', role: 'style-reference' }),
        ])
        expect(tiles).toHaveLength(2)
        expect(tiles[0].querySelector('.ai-image-generation-reference-role')?.textContent).toBe('Target')
        expect(tiles[1].querySelector('.ai-image-generation-reference-role')?.textContent).toBe('Style Reference')
    })

    it('shows an empty-state message when there are no references', () => {
        const { details, tiles } = renderTiles([])
        expect(tiles).toHaveLength(0)
        expect(details.dom.querySelector('.ai-image-generation-empty-references')?.textContent).toContain('No reference images were sent')
    })
})
