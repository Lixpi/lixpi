import { Sprite, Texture, Graphics, type Container } from 'pixi.js'

import type { CanvasNode, CanvasState, VideoCanvasNode } from '@lixpi/constants'

import AuthService from '$src/services/auth-service.ts'
import { settings } from '$src/settings.ts'
import { decodeImageInWorker } from '$src/infographics/workspace/pixiImageDecoder.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'

import type { MediaNodeHandler } from '$src/infographics/workspace/rendering/mediaNodeRegistry.ts'
import type { WorldPosition } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'

// PIXI handler for VideoCanvasNode entries, registered via mediaNodeRegistry
// and dispatched from pixiMediaLayer's sync. The visible surface is owned by
// PIXI (sprite + mask + colorRect placeholder); the DOM only hosts interaction
// chrome (the existing image DOM shell pattern from CANVAS-ENGINE.md).
//
// Phase 5 v1 keeps this small: the sprite shows the ffmpeg-extracted poster
// image until the user clicks the node, at which point we swap to a PIXI
// VideoSource texture and start playback. Pause reverts to the poster. The
// off-screen visibility, prefetch, and concurrent-player cap that the image
// media layer exposes for image LoD are deliberately not duplicated here in
// v1 — VEO clips are short (max 8s) and single-user playback is the common
// case. The handler is structured so those refinements can land later without
// changing the registry contract.

type VideoEntry = {
    sprite: Sprite
    spriteMask: Graphics
    colorRect: Graphics
    videoElement: HTMLVideoElement
    videoTexture: Texture | null
    posterTexture: Texture | null
    sourceKey: string
    worldRect: { x: number; y: number; width: number; height: number }
    isPlaying: boolean
    isActive: boolean
    frameLoopRunning: boolean
    removeEventListeners: () => void
}

export type VideoNodeHandlerOptions = {
    videoLayer: Container
    onIntrinsicSize?: (info: { nodeId: string; width: number; height: number }) => void
    onRender?: () => void
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
    const { videoLayer, onIntrinsicSize, onRender } = options
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
        if (!url) return ''
        if (url.startsWith('data:') || url.startsWith('blob:')) return url
        if (url.startsWith('/api/')) {
            const token = await AuthService.getTokenSilently()
            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            return `${API_BASE_URL}${url}${token ? `?token=${token}` : ''}`
        }
        if (url.startsWith('http')) {
            const stripped = url.replace(/[?&]token=[^&]+/, '')
            if (stripped.includes('/api/videos/') || stripped.includes('/api/images/')) {
                const token = await AuthService.getTokenSilently()
                return `${stripped}${token ? `?token=${token}` : ''}`
            }
            return url
        }
        return url
    }

    const getBorderRadius = (w: number, h: number): number => {
        const borderRadius = (settings as any).imageNode?.borderRadius ?? 12
        if (!Number.isFinite(borderRadius) || borderRadius <= 0) return 0
        return Math.min(borderRadius, w / 2, h / 2)
    }

    const drawColorRect = (g: Graphics, w: number, h: number): void => {
        g.clear()
        const radius = getBorderRadius(w, h)
        g.roundRect(0, 0, w, h, radius)
        g.fill({ color: 0x222222, alpha: 1 })
    }

    const scheduleVideoFrameLoop = (entry: VideoEntry): void => {
        if (entry.frameLoopRunning) return
        entry.frameLoopRunning = true
        // Pump the texture from requestAnimationFrame, NOT requestVideoFrameCallback.
        // The canvas <video> lives in an off-screen host, and the browser does not
        // fire rVFC for a video it isn't compositing — so an rVFC-driven loop (and
        // PIXI's own rVFC-based VideoSource auto-update) never pushes frames and the
        // sprite stays stuck on its initial blank frame. rAF always fires; calling
        // source.update() each tick re-uploads the current decoded frame while the
        // muted clip plays.
        const tick = () => {
            if (!entry.isPlaying || destroyed) {
                entry.frameLoopRunning = false
                return
            }
            updateVideoTextureSource(entry)
            onRender?.()
            requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
    }

    const updateVideoTextureSource = (entry: VideoEntry): void => {
        const videoSource = entry.videoTexture?.source as { update?: () => void } | undefined
        videoSource?.update?.()
    }

    const repaintVideoFrame = (entry: VideoEntry): void => {
        if (!entry.videoTexture) return
        // Re-read the current frame now, then again across the next few animation
        // frames. A seek/pause decodes asynchronously, and (as above) rVFC is
        // unreliable for the off-screen element — so a short rAF burst guarantees
        // the freshly-decoded frame reaches the texture even while paused.
        let ticks = 0
        const pump = () => {
            if (destroyed || !entry.videoTexture) return
            updateVideoTextureSource(entry)
            onRender?.()
            ticks += 1
            if (ticks < 4) requestAnimationFrame(pump)
        }
        pump()
    }

    const activateVideoTexture = (entry: VideoEntry): void => {
        if (!entry.videoTexture) {
            entry.videoTexture = Texture.from(entry.videoElement as unknown as HTMLVideoElement)
        }
        entry.sprite.texture = entry.videoTexture
        entry.isActive = true
        repaintVideoFrame(entry)
    }

    const updateMediaSources = async (entry: VideoEntry, node: VideoCanvasNode): Promise<void> => {
        // Load poster as the default texture so the node is visible immediately
        // without paying the cost of decoding the MP4 just to extract frame 0.
        if (node.posterSrc) {
            try {
                const posterSrc = await buildAuthenticatedUrl(node.posterSrc)
                // The element is shown directly on the canvas node (see
                // createVideoControlsChrome) — a hidden element sampled only as a
                // PIXI texture renders blank because the browser throttles frames
                // for a video it isn't compositing. Give it a native poster so the
                // at-rest frame shows before playback.
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
                activateVideoTexture(entryRef)
                entryRef.isPlaying = true
                scheduleVideoFrameLoop(entryRef)
            }
            const handlePause = () => {
                entryRef.isPlaying = false
                repaintVideoFrame(entryRef)
            }
            const handleSeeking = () => {
                activateVideoTexture(entryRef)
                repaintVideoFrame(entryRef)
            }
            const handleSeeked = () => {
                activateVideoTexture(entryRef)
                repaintVideoFrame(entryRef)
            }

            videoElement.addEventListener('loadedmetadata', handleLoadedMetadata)
            videoElement.addEventListener('play', handlePlay)
            videoElement.addEventListener('pause', handlePause)
            videoElement.addEventListener('ended', handlePause)
            videoElement.addEventListener('seeking', handleSeeking)
            videoElement.addEventListener('seeked', handleSeeked)

            entry = {
                sprite,
                spriteMask,
                colorRect,
                videoElement,
                videoTexture: null,
                posterTexture: null,
                sourceKey: '',
                worldRect: { x, y, width: w, height: h },
                isPlaying: false,
                isActive: false,
                frameLoopRunning: false,
                removeEventListeners: () => {
                    videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata)
                    videoElement.removeEventListener('play', handlePlay)
                    videoElement.removeEventListener('pause', handlePause)
                    videoElement.removeEventListener('ended', handlePause)
                    videoElement.removeEventListener('seeking', handleSeeking)
                    videoElement.removeEventListener('seeked', handleSeeked)
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
        if (entry.videoTexture) entry.videoTexture.destroy()
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
            activateVideoTexture(entry)
            entry.isPlaying = !entry.videoElement.paused
            if (entry.isPlaying) scheduleVideoFrameLoop(entry)
        } catch (e) {
            console.warn('[videoNodeHandler] play failed', e)
        }
    }

    const pause = (nodeId: string): void => {
        const entry = entries.get(nodeId)
        if (!entry) return
        try { entry.videoElement.pause() } catch { /* noop */ }
        entry.isPlaying = false
        if (entry.isActive) repaintVideoFrame(entry)
        onRender?.()
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
