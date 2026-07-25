'use strict'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createDocumentNodeHandler } from './documentNodeHandler.ts'
import { type DocumentMediaCanvasNode, type CanvasState } from '@lixpi/constants'

const { FakeContainer, FakeGraphics, FakeSprite, FakeTexture } = vi.hoisted(() => {
    class FakeTexture {
        public static empty = new FakeTexture(0, 0, 'empty')

        public constructor(
            public width = 0,
            public height = 0,
            private readonly id = 'texture'
        ) {}

        public destroy = vi.fn()

        public source = { autoGenerateMipmaps: false }

        public static get EMPTY(): FakeTexture {
            return FakeTexture.empty
        }

        public static from(bitmap: { width: number; height: number } | undefined): FakeTexture {
            return new FakeTexture(bitmap?.width ?? 0, bitmap?.height ?? 0)
        }
    }

    class FakeContainer {
        public children: Array<unknown> = []

        public addChild(child: unknown): unknown {
            this.children.push(child)
            return child
        }

        public removeChild(child: unknown): void {
            this.children = this.children.filter((candidate) => candidate !== child)
        }
    }

    class FakeGraphics {
        public positionX = 0
        public positionY = 0
        public position = {
            set: (x: number, y: number) => {
                this.positionX = x
                this.positionY = y
            },
        }

        public clear = vi.fn()
        public roundRect = vi.fn()
        public fill = vi.fn()
        public destroy = vi.fn()
    }

    class FakeSprite {
        public texture: FakeTexture = FakeTexture.EMPTY
        public visible = false
        public width = 0
        public height = 0
        public mask: unknown = null
        public eventMode = ''
        public positionX = 0
        public positionY = 0
        public position = {
            set: (x: number, y: number) => {
                this.positionX = x
                this.positionY = y
            },
        }

        public destroy = vi.fn()
    }

    return { FakeContainer, FakeGraphics, FakeSprite, FakeTexture }
})

vi.mock('pixi.js', () => ({
    Container: FakeContainer,
    Graphics: FakeGraphics,
    Sprite: FakeSprite,
    Texture: FakeTexture,
}))

vi.mock('$src/services/auth-service.ts', () => ({
    default: {
        getTokenSilently: vi.fn(async () => 'token'),
    },
}))

vi.mock('$src/settings.ts', () => ({
    settings: {
        mediaNode: {
            styles: {
                borderRadius: 8,
            },
        },
    },
}))

vi.mock('$src/infographics/workspace/pixiImageDecoder.ts', () => ({
    decodeImageInWorker: vi.fn(async () => ({ width: 10, height: 20 })),
}))

function makeDocumentNode(overrides: Partial<DocumentMediaCanvasNode> = {}): DocumentMediaCanvasNode {
    return {
        nodeId: 'doc-1',
        type: 'mediaDocument',
        assetId: 'doc-asset-1',
        dimensions: { width: 640, height: 320 },
        position: { x: 10, y: 20 },
        ...overrides,
    }
}

function makeCanvasState(node: DocumentMediaCanvasNode): CanvasState {
    return {
        sourceContext: {},
        nodes: [node],
        edges: [],
    } as CanvasState
}

// =============================================================================
// documentNodeHandler behavior
// =============================================================================

describe('documentNodeHandler', () => {
    let documentLayer: FakeContainer
    let onRender: ReturnType<typeof vi.fn>

    beforeEach(() => {
        documentLayer = new FakeContainer()
        onRender = vi.fn()
        vi.clearAllMocks()
        FakeTexture.empty = new FakeTexture(0, 0, 'empty')
        document.body.innerHTML = ''
    })

    afterEach(() => {
        vi.restoreAllMocks()
        document.body.innerHTML = ''
    })

    it('can handle only mediaDocument nodes', () => {
        const handler = createDocumentNodeHandler({ documentLayer, onRender })

        const doc = makeDocumentNode()
        const image = { type: 'image' } as unknown as DocumentMediaCanvasNode

        expect(handler.canHandle(doc)).toBe(true)
        expect(handler.canHandle(image)).toBe(false)
    })

    it('creates and registers PIXI entries on first upsert', () => {
        const handler = createDocumentNodeHandler({ documentLayer, onRender })
        const doc = makeDocumentNode()

        handler.upsert(doc, { x: 10, y: 20 }, makeCanvasState(doc))

        expect(documentLayer.children).toHaveLength(3)
        const sprite = documentLayer.children[2] as FakeSprite
        expect(sprite).toBeInstanceOf(FakeSprite)
    })

    it('loads poster and updates sprite texture for authenticated poster URLs', async () => {
        const handler = createDocumentNodeHandler({ documentLayer, onRender })
        const doc = makeDocumentNode()

        handler.upsert(doc, { x: 10, y: 20 }, makeCanvasState(doc))

        const entrySprite = documentLayer.children[2] as FakeSprite
        await vi.waitFor(() => expect(entrySprite.texture).not.toBe(FakeTexture.EMPTY))

        const sprite = entrySprite as FakeSprite
        expect(sprite.visible).toBe(true)
    })

    it('does not load poster for document nodes without an assetId yet', async () => {
        const handler = createDocumentNodeHandler({ documentLayer, onRender })
        const doc = makeDocumentNode({ assetId: '' })

        handler.upsert(doc, { x: 10, y: 20 }, makeCanvasState(doc))

        const sprite = documentLayer.children[2] as FakeSprite

        expect(sprite.texture).toBe(FakeTexture.EMPTY)
        expect(sprite.visible).toBe(false)
    })

    it('refreshes poster texture when source key changes', async () => {
        const handler = createDocumentNodeHandler({ documentLayer, onRender })
        const first = makeDocumentNode()
        const second = makeDocumentNode({ assetId: 'doc-asset-2' })

        handler.upsert(first, { x: 10, y: 20 }, makeCanvasState(first))
        await vi.waitFor(() => expect(onRender).toHaveBeenCalledTimes(2))
        const sprite = documentLayer.children[2] as FakeSprite
        const firstTexture = sprite.texture

        handler.upsert(second, { x: 10, y: 20 }, makeCanvasState(second))
        await vi.waitFor(() => expect(sprite.texture).not.toBe(firstTexture))

        expect(sprite.texture).not.toBe(firstTexture)
        expect((firstTexture as FakeTexture).destroy).toHaveBeenCalled()
    })

    it('updates live transforms and redraws geometry when dimensions change', () => {
        const handler = createDocumentNodeHandler({ documentLayer, onRender })
        const doc = makeDocumentNode({ dimensions: { width: 300, height: 200 } })

        handler.upsert(doc, { x: 10, y: 20 }, makeCanvasState(doc))
        const sprite = documentLayer.children[2] as FakeSprite
        const spriteMask = documentLayer.children[1] as FakeGraphics
        const colorRect = documentLayer.children[0] as FakeGraphics
        const initialColorClearCalls = colorRect.clear.mock.calls.length
        const initialSpriteMaskClearCalls = spriteMask.clear.mock.calls.length

        handler.setLiveTransform(doc.nodeId, { x: 120, y: 220 }, { width: 480, height: 260 })

        expect(sprite.positionX).toBe(120)
        expect(sprite.positionY).toBe(220)
        expect(sprite.width).toBe(480)
        expect(sprite.height).toBe(260)
        expect(colorRect.clear).toHaveBeenCalledTimes(initialColorClearCalls + 1)
        expect(spriteMask.clear).toHaveBeenCalledTimes(initialSpriteMaskClearCalls + 1)
    })

    it('removes node artifacts and clears map on remove', () => {
        const handler = createDocumentNodeHandler({ documentLayer, onRender })
        const doc = makeDocumentNode()

        handler.upsert(doc, { x: 10, y: 20 }, makeCanvasState(doc))
        expect(documentLayer.children).toHaveLength(3)

        handler.remove(doc.nodeId)

        expect(documentLayer.children).toHaveLength(0)
        expect(onRender).toHaveBeenCalledTimes(2)
    })

    it('destroys all entries and releases textures on teardown', () => {
        const handler = createDocumentNodeHandler({ documentLayer, onRender })
        const first = makeDocumentNode()
        const second = makeDocumentNode({ nodeId: 'doc-2', assetId: 'doc-asset-2' })

        handler.upsert(first, { x: 10, y: 20 }, makeCanvasState(first))
        handler.upsert(second, { x: 30, y: 40 }, makeCanvasState(second))
        const sprites = documentLayer.children.filter((entry) => entry instanceof FakeSprite)
        expect(sprites).toHaveLength(2)

        handler.destroy()

        expect(documentLayer.children).toHaveLength(0)
        for (const sprite of sprites) {
            expect((sprite as FakeSprite).destroy).toHaveBeenCalled()
        }
        expect(onRender).toHaveBeenCalled()
    })
})
