import { Sprite, Texture, Graphics, type Container } from 'pixi.js'

import type { CanvasNode, CanvasState, DocumentMediaCanvasNode } from '@lixpi/constants'

import AuthService from '$src/services/auth-service.ts'
import { settings } from '$src/settings.ts'
import { decodeImageInWorker } from '$src/infographics/workspace/pixiImageDecoder.ts'
import { buildAssetRenditionPath, resolveAuthenticatedMediaUrl } from '$src/utils/mediaUrls.ts'

import type { MediaNodeHandler } from '$src/infographics/workspace/rendering/mediaNodeRegistry.ts'
import type { WorldPosition } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'

// PIXI handler for DocumentMediaCanvasNode (uploaded PDFs / office docs). Mirrors
// the video handler's poster path — PIXI owns a first-page poster sprite behind a
// rounded mask — but a document has no playback surface, so there is no DOM
// element and no play/pause control. The full document opens through the file
// route on demand; on the canvas it is a static first-page thumbnail.

type DocumentEntry = {
    sprite: Sprite
    spriteMask: Graphics
    colorRect: Graphics
    posterTexture: Texture | null
    sourceKey: string
    worldRect: { x: number; y: number; width: number; height: number }
}

export type DocumentNodeHandlerOptions = {
    documentLayer: Container
    onRender?: () => void
}

export function createDocumentNodeHandler(options: DocumentNodeHandlerOptions): MediaNodeHandler<DocumentMediaCanvasNode> {
    const { documentLayer, onRender } = options
    const entries = new Map<string, DocumentEntry>()
    let destroyed = false

    const canHandle = (node: CanvasNode): node is DocumentMediaCanvasNode => node.type === 'mediaDocument'

    const buildAuthenticatedUrl = async (url: string): Promise<string> => {
        return resolveAuthenticatedMediaUrl(url, {
            apiBaseUrl: import.meta.env.VITE_API_URL || '',
            getAuthToken: () => AuthService.getTokenSilently(),
        })
    }

    const getBorderRadius = (w: number, h: number): number => {
        const borderRadius = settings.mediaNode.styles.borderRadius
        if (!Number.isFinite(borderRadius) || borderRadius <= 0) return 0
        return Math.min(borderRadius, w / 2, h / 2)
    }

    const drawColorRect = (g: Graphics, w: number, h: number): void => {
        g.clear()
        g.roundRect(0, 0, w, h, getBorderRadius(w, h))
        g.fill({ color: 0x2b2b2b, alpha: 1 })
    }

    const updatePoster = async (entry: DocumentEntry, node: DocumentMediaCanvasNode): Promise<void> => {
        if (!node.assetId) return
        try {
            const posterSrc = await buildAuthenticatedUrl(buildAssetRenditionPath(node.assetId, 'poster'))
            const bitmap = await decodeImageInWorker(posterSrc)
            if (destroyed) return
            const posterTexture = Texture.from(bitmap)
            if (entry.posterTexture && entry.posterTexture !== posterTexture) {
                entry.posterTexture.destroy()
            }
            entry.posterTexture = posterTexture
            entry.sprite.texture = posterTexture
            entry.sprite.visible = true
            onRender?.()
        } catch (e) {
            console.warn('[documentNodeHandler] poster load failed', e)
        }
    }

    const applyTransform = (entry: DocumentEntry, x: number, y: number, w: number, h: number): void => {
        entry.sprite.position.set(x, y)
        entry.sprite.width = w
        entry.sprite.height = h

        entry.spriteMask.clear()
        entry.spriteMask.roundRect(0, 0, w, h, getBorderRadius(w, h))
        entry.spriteMask.fill({ color: 0xffffff, alpha: 1 })
        entry.spriteMask.position.set(x, y)

        if (w !== entry.worldRect.width || h !== entry.worldRect.height || entry.worldRect.width === 0) {
            drawColorRect(entry.colorRect, w, h)
        }
        entry.colorRect.position.set(x, y)
        entry.worldRect = { x, y, width: w, height: h }
    }

    const upsert = (node: DocumentMediaCanvasNode, worldPosition: WorldPosition, _canvasState: CanvasState): void => {
        if (destroyed) return

        const x = worldPosition.x
        const y = worldPosition.y
        const w = node.dimensions.width
        const h = node.dimensions.height

        let entry = entries.get(node.nodeId)
        if (!entry) {
            const sprite = new Sprite(Texture.EMPTY)
            sprite.label = `pixi-document-${node.nodeId}`
            sprite.eventMode = 'none'
            sprite.visible = false

            const spriteMask = new Graphics()
            spriteMask.label = `pixi-document-mask-${node.nodeId}`
            spriteMask.eventMode = 'none'
            sprite.mask = spriteMask

            const colorRect = new Graphics()
            colorRect.label = `pixi-document-rect-${node.nodeId}`
            colorRect.eventMode = 'none'

            documentLayer.addChild(colorRect)
            documentLayer.addChild(spriteMask)
            documentLayer.addChild(sprite)

            entry = {
                sprite,
                spriteMask,
                colorRect,
                posterTexture: null,
                sourceKey: '',
                worldRect: { x, y, width: w, height: h },
            }
            entries.set(node.nodeId, entry)
        }

        applyTransform(entry, x, y, w, h)
        entry.colorRect.visible = true

        const sourceKey = node.assetId
        if (sourceKey !== entry.sourceKey) {
            entry.sourceKey = sourceKey
            updatePoster(entry, node).catch(() => {})
        }

        onRender?.()
    }

    const remove = (nodeId: string): void => {
        const entry = entries.get(nodeId)
        if (!entry) return

        documentLayer.removeChild(entry.sprite)
        documentLayer.removeChild(entry.spriteMask)
        documentLayer.removeChild(entry.colorRect)
        entry.sprite.mask = null
        entry.sprite.destroy()
        entry.spriteMask.destroy()
        entry.colorRect.destroy()
        if (entry.posterTexture) entry.posterTexture.destroy()
        entries.delete(nodeId)
        onRender?.()
    }

    const setLiveTransform = (
        nodeId: string,
        worldPosition: WorldPosition,
        dimensions: { width: number; height: number }
    ): void => {
        const entry = entries.get(nodeId)
        if (!entry) return
        applyTransform(entry, worldPosition.x, worldPosition.y, dimensions.width, dimensions.height)
        onRender?.()
    }

    const destroy = (): void => {
        destroyed = true
        for (const nodeId of Array.from(entries.keys())) {
            remove(nodeId)
        }
        entries.clear()
    }

    return { canHandle, upsert, remove, setLiveTransform, destroy }
}
