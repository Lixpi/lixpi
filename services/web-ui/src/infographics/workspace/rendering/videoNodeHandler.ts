import { Sprite, Texture, Graphics, type Container } from 'pixi.js'

import type { CanvasNode, CanvasState, VideoCanvasNode } from '@lixpi/constants'

import AuthService from '$src/services/auth-service.ts'
import { settings } from '$src/settings.ts'
import { decodeImageInWorker } from '$src/infographics/workspace/pixiImageDecoder.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'
import { resolveAuthenticatedMediaUrl } from '$src/utils/workspaceFileUrls.ts'

import type { MediaNodeHandler } from '$src/infographics/workspace/rendering/mediaNodeRegistry.ts'
import type { WorldPosition } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'

// PIXI handler for VideoCanvasNode entries, registered via mediaNodeRegistry
// and dispatched from pixiMediaLayer's sync. PIXI owns the poster/placeholder
// sprite and node geometry; completed playback uses the attached DOM <video>
// element that WorkspaceCanvas moves into the chrome layer. Keeping playback on
// the browser-composited element avoids a second PIXI VideoSource render loop
// fighting the connector/edge canvas.

type VideoEntry = {
    sprite: Sprite
    spriteMask: Graphics
    colorRect: Graphics
    videoElement: HTMLVideoElement
    posterTexture: Texture | null
    sourceKey: string
    worldRect: { x: number; y: number; width: number; height: number }
    isPlaying: boolean
    removeEventListeners: () => void
}

export type VideoNodeHandlerOptions = {
    videoLayer: Container
    onIntrinsicSize?: (info: { nodeId: string; width: number; height: number }) => void
    onRender?: () => void
    onVideoElementReady?: (nodeId: string) => void
}

export type VideoNodeHandlerControl = MediaNodeHandler<VideoCanvasNode> & {
    play: (nodeId: string) => Promise<void>
    pause: (nodeId: string) => void
    toggle: (nodeId: string) => Promise<void>
    isPlaying: (nodeId: string) => boolean
    hasEntry: (nodeId: string) => boolean
    getVideoElement: (nodeId: string) => HTMLVideoElement | null
}

export function createVideoNodeHandler(options: VideoNodeHandlerOptions): VideoNodeHandlerControl {
    const { videoLayer, onIntrinsicSize, onRender, onVideoElementReady } = options
    const entries = new Map<string, VideoEntry>()
    let destroyed = false
    let hiddenVideoHost: HTMLDivElement | null = null

    const canHandle = (node: CanvasNode): node is VideoCanvasNode => node.type === 'video'

    const ensureHiddenVideoHost = (): HTMLDivElement => {
        if (hiddenVideoHost?.isConnected) return hiddenVideoHost

        const hiddenVideoHostStyle = {
            position: 'fixed' as const,
            left: '0',
            top: '0',
            width: '1px',
            height: '1px',
            overflow: 'hidden' as const,
            pointerEvents: 'none' as const,
            zIndex: '-1',
        }
        hiddenVideoHost = html`<div className="workspace-hidden-video-host" style=${hiddenVideoHostStyle}></div>` as HTMLDivElement
        document.body.appendChild(hiddenVideoHost)
        return hiddenVideoHost
    }

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
        const radius = getBorderRadius(w, h)
        g.roundRect(0, 0, w, h, radius)
        g.fill({ color: 0x222222, alpha: 1 })
    }

    const updateMediaSources = async (entry: VideoEntry, node: VideoCanvasNode): Promise<void> => {
        // Load poster as the default texture so the node is visible immediately
        // without paying the cost of decoding the MP4 just to extract frame 0.
        if (node.posterSrc) {
            try {
                const posterSrc = await buildAuthenticatedUrl(node.posterSrc)
                // The same element is shown directly on the canvas node by
                // createVideoControlsChrome. Give it a native poster so the DOM
                // surface and PIXI poster agree before playback starts.
                entry.videoElement.poster = posterSrc
                // PIXI v8's Texture.from(urlString) does NOT fetch a remote URL — it
                // only resolves already-loaded sources / cache aliases, so a poster
                // URL renders as an empty texture (the dark colorRect shows through =
                // black rectangle). Decode the bytes in the shared worker pool, the
                // same path the image media layer uses, then build from the bitmap.
                const bitmap = await decodeImageInWorker(posterSrc)
                if (destroyed) return
                const posterTexture = Texture.from(bitmap)
                if (entry.posterTexture && entry.posterTexture !== posterTexture) {
                    entry.posterTexture.destroy()
                }
                entry.posterTexture = posterTexture
                if (!entry.isPlaying) {
                    entry.sprite.texture = posterTexture
                }
                onRender?.()
            } catch (e) {
                console.warn('[videoNodeHandler] poster load failed', e)
            }
        }

        if (node.src) {
            try {
                const videoSrc = await buildAuthenticatedUrl(node.src)
                if (destroyed) return
                if (entry.videoElement.src !== videoSrc) {
                    entry.videoElement.src = videoSrc
                    entry.videoElement.load()
                }
                onVideoElementReady?.(node.nodeId)
            } catch (e) {
                console.warn('[videoNodeHandler] video src apply failed', e)
            }
        }
    }

    const upsert = (node: VideoCanvasNode, worldPosition: WorldPosition, _canvasState: CanvasState): void => {
        if (destroyed) return

        const x = worldPosition.x
        const y = worldPosition.y
        const w = node.dimensions.width
        const h = node.dimensions.height

        let entry = entries.get(node.nodeId)

        if (!entry) {
            const sprite = new Sprite(Texture.EMPTY)
            sprite.label = `pixi-video-${node.nodeId}`
            sprite.eventMode = 'none'
            sprite.visible = false

            const spriteMask = new Graphics()
            spriteMask.label = `pixi-video-mask-${node.nodeId}`
            spriteMask.eventMode = 'none'
            sprite.mask = spriteMask

            const colorRect = new Graphics()
            colorRect.label = `pixi-video-rect-${node.nodeId}`
            colorRect.eventMode = 'none'

            videoLayer.addChild(colorRect)
            videoLayer.addChild(spriteMask)
            videoLayer.addChild(sprite)

            const videoElement = html`<video preload="metadata" playsinline crossorigin="anonymous"></video>` as HTMLVideoElement
            const videoElementStyle = {
                width: '100%',
                height: '100%',
                display: 'block',
                objectFit: 'contain',
            }
            applyStyle(videoElement, videoElementStyle)
            videoElement.muted = true
            videoElement.playsInline = true
            videoElement.preload = 'metadata'
            videoElement.loop = true
            videoElement.crossOrigin = 'anonymous'
            ensureHiddenVideoHost().appendChild(videoElement)

            let entryRef: VideoEntry
            const handleLoadedMetadata = () => {
                const vw = videoElement.videoWidth
                const vh = videoElement.videoHeight
                if (vw > 0 && vh > 0) {
                    onIntrinsicSize?.({ nodeId: node.nodeId, width: vw, height: vh })
                }
            }
            const handlePlay = () => {
                entryRef.isPlaying = true
            }
            const handlePause = () => {
                entryRef.isPlaying = false
            }

            videoElement.addEventListener('loadedmetadata', handleLoadedMetadata)
            videoElement.addEventListener('play', handlePlay)
            videoElement.addEventListener('pause', handlePause)
            videoElement.addEventListener('ended', handlePause)

            entry = {
                sprite,
                spriteMask,
                colorRect,
                videoElement,
                posterTexture: null,
                sourceKey: '',
                worldRect: { x, y, width: w, height: h },
                isPlaying: false,
                removeEventListeners: () => {
                    videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata)
                    videoElement.removeEventListener('play', handlePlay)
                    videoElement.removeEventListener('pause', handlePause)
                    videoElement.removeEventListener('ended', handlePause)
                },
            }
            entryRef = entry
            entries.set(node.nodeId, entry)
        }

        // Transform: sprite + mask + colorRect all positioned identically.
        entry.sprite.position.set(x, y)
        entry.sprite.width = w
        entry.sprite.height = h
        entry.sprite.visible = true

        entry.spriteMask.clear()
        const radius = getBorderRadius(w, h)
        entry.spriteMask.roundRect(0, 0, w, h, radius)
        entry.spriteMask.fill({ color: 0xffffff, alpha: 1 })
        entry.spriteMask.position.set(x, y)

        if (w !== entry.worldRect.width || h !== entry.worldRect.height) {
            drawColorRect(entry.colorRect, w, h)
        } else if (entry.worldRect.width === 0) {
            drawColorRect(entry.colorRect, w, h)
        }
        entry.colorRect.position.set(x, y)
        entry.colorRect.visible = Boolean(node.fileId || node.posterFileId || node.frameFileId || node.src || node.posterSrc)

        entry.worldRect = { x, y, width: w, height: h }

        const sourceKey = `${node.workspaceId}|${node.fileId}|${node.posterFileId}|${node.src}|${node.posterSrc}`
        if (sourceKey !== entry.sourceKey) {
            entry.sourceKey = sourceKey
            updateMediaSources(entry, node).catch(() => {})
        }

        onRender?.()
    }

    const remove = (nodeId: string): void => {
        const entry = entries.get(nodeId)
        if (!entry) return

        try {
            entry.videoElement.pause()
            entry.videoElement.removeAttribute('src')
            entry.videoElement.load()
        } catch {
            // Best-effort teardown.
        }
        entry.removeEventListeners()
        entry.videoElement.remove()

        videoLayer.removeChild(entry.sprite)
        videoLayer.removeChild(entry.spriteMask)
        videoLayer.removeChild(entry.colorRect)
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

        const x = worldPosition.x
        const y = worldPosition.y
        const w = dimensions.width
        const h = dimensions.height

        entry.sprite.position.set(x, y)
        entry.sprite.width = w
        entry.sprite.height = h
        entry.spriteMask.position.set(x, y)
        entry.colorRect.position.set(x, y)

        if (w !== entry.worldRect.width || h !== entry.worldRect.height) {
            entry.spriteMask.clear()
            const radius = getBorderRadius(w, h)
            entry.spriteMask.roundRect(0, 0, w, h, radius)
            entry.spriteMask.fill({ color: 0xffffff, alpha: 1 })
            drawColorRect(entry.colorRect, w, h)
        }

        entry.worldRect = { x, y, width: w, height: h }
        onRender?.()
    }

    const destroy = (): void => {
        destroyed = true
        for (const nodeId of Array.from(entries.keys())) {
            remove(nodeId)
        }
        entries.clear()
        hiddenVideoHost?.remove()
        hiddenVideoHost = null
    }

    const play = async (nodeId: string): Promise<void> => {
        const entry = entries.get(nodeId)
        if (!entry || destroyed) return
        if (entry.isPlaying) return

        try {
            await entry.videoElement.play()
            entry.isPlaying = !entry.videoElement.paused
        } catch (e) {
            console.warn('[videoNodeHandler] play failed', e)
        }
    }

    const pause = (nodeId: string): void => {
        const entry = entries.get(nodeId)
        if (!entry) return
        try { entry.videoElement.pause() } catch { /* noop */ }
        entry.isPlaying = false
    }

    const toggle = async (nodeId: string): Promise<void> => {
        const entry = entries.get(nodeId)
        if (!entry) return
        if (entry.isPlaying) pause(nodeId)
        else await play(nodeId)
    }

    return {
        canHandle,
        upsert,
        remove,
        setLiveTransform,
        destroy,
        play,
        pause,
        toggle,
        isPlaying: (nodeId: string) => entries.get(nodeId)?.isPlaying ?? false,
        hasEntry: (nodeId: string) => entries.has(nodeId),
        getVideoElement: (nodeId: string) => entries.get(nodeId)?.videoElement ?? null,
    }
}
