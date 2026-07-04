import { Graphics, type Container } from 'pixi.js'

import type { CanvasNode, CanvasState, AudioCanvasNode } from '@lixpi/constants'

import AuthService from '$src/services/auth-service.ts'
import { settings } from '$src/settings.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'
import { resolveAuthenticatedMediaUrl } from '$src/utils/workspaceFileUrls.ts'

import type { MediaNodeHandler } from '$src/infographics/workspace/rendering/mediaNodeRegistry.ts'
import type { WorldPosition } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'

// PIXI handler for AudioCanvasNode. Audio has no still frame, so PIXI owns only a
// rounded placeholder rect for node geometry; playback runs on a DOM <audio>
// element kept in a hidden host (the audio analogue of the video handler's DOM
// <video> surface). WorkspaceCanvas wires the play/pause control chrome to the
// element via getAudioElement, exactly as it does for video.

type AudioEntry = {
    colorRect: Graphics
    audioElement: HTMLAudioElement
    sourceKey: string
    worldRect: { x: number; y: number; width: number; height: number }
    isPlaying: boolean
    removeEventListeners: () => void
}

export type AudioNodeHandlerOptions = {
    audioLayer: Container
    onRender?: () => void
    onAudioElementReady?: (nodeId: string) => void
}

export type AudioNodeHandlerControl = MediaNodeHandler<AudioCanvasNode> & {
    play: (nodeId: string) => Promise<void>
    pause: (nodeId: string) => void
    toggle: (nodeId: string) => Promise<void>
    isPlaying: (nodeId: string) => boolean
    hasEntry: (nodeId: string) => boolean
    getAudioElement: (nodeId: string) => HTMLAudioElement | null
}

export function createAudioNodeHandler(options: AudioNodeHandlerOptions): AudioNodeHandlerControl {
    const { audioLayer, onRender, onAudioElementReady } = options
    const entries = new Map<string, AudioEntry>()
    let destroyed = false
    let hiddenAudioHost: HTMLDivElement | null = null

    const canHandle = (node: CanvasNode): node is AudioCanvasNode => node.type === 'audio'

    const ensureHiddenAudioHost = (): HTMLDivElement => {
        if (hiddenAudioHost?.isConnected) return hiddenAudioHost
        const hiddenAudioHostStyle = {
            position: 'fixed' as const,
            left: '0',
            top: '0',
            width: '1px',
            height: '1px',
            overflow: 'hidden' as const,
            pointerEvents: 'none' as const,
            zIndex: '-1',
        }
        hiddenAudioHost = html`<div className="workspace-hidden-audio-host" style=${hiddenAudioHostStyle}></div>` as HTMLDivElement
        document.body.appendChild(hiddenAudioHost)
        return hiddenAudioHost
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

    const drawColorRect = (g: Graphics, x: number, y: number, w: number, h: number): void => {
        g.clear()
        g.roundRect(0, 0, w, h, getBorderRadius(w, h))
        g.fill({ color: 0x1f2a30, alpha: 1 })
        g.position.set(x, y)
    }

    const updateSource = async (entry: AudioEntry, node: AudioCanvasNode): Promise<void> => {
        if (!node.src) return
        try {
            const audioSrc = await buildAuthenticatedUrl(node.src)
            if (destroyed) return
            if (entry.audioElement.src !== audioSrc) {
                entry.audioElement.src = audioSrc
                entry.audioElement.load()
            }
            onAudioElementReady?.(node.nodeId)
        } catch (e) {
            console.warn('[audioNodeHandler] audio src apply failed', e)
        }
    }

    const upsert = (node: AudioCanvasNode, worldPosition: WorldPosition, _canvasState: CanvasState): void => {
        if (destroyed) return

        const x = worldPosition.x
        const y = worldPosition.y
        const w = node.dimensions.width
        const h = node.dimensions.height

        let entry = entries.get(node.nodeId)
        if (!entry) {
            const colorRect = new Graphics()
            colorRect.label = `pixi-audio-rect-${node.nodeId}`
            colorRect.eventMode = 'none'
            audioLayer.addChild(colorRect)

            const audioElement = html`<audio preload="metadata" crossorigin="anonymous"></audio>` as HTMLAudioElement
            const audioElementStyle = { width: '1px', height: '1px', display: 'block' }
            applyStyle(audioElement, audioElementStyle)
            audioElement.preload = 'metadata'
            audioElement.crossOrigin = 'anonymous'
            ensureHiddenAudioHost().appendChild(audioElement)

            let entryRef: AudioEntry
            const handlePlay = () => { entryRef.isPlaying = true }
            const handlePause = () => { entryRef.isPlaying = false }
            audioElement.addEventListener('play', handlePlay)
            audioElement.addEventListener('pause', handlePause)
            audioElement.addEventListener('ended', handlePause)

            entry = {
                colorRect,
                audioElement,
                sourceKey: '',
                worldRect: { x, y, width: w, height: h },
                isPlaying: false,
                removeEventListeners: () => {
                    audioElement.removeEventListener('play', handlePlay)
                    audioElement.removeEventListener('pause', handlePause)
                    audioElement.removeEventListener('ended', handlePause)
                },
            }
            entryRef = entry
            entries.set(node.nodeId, entry)
        }

        drawColorRect(entry.colorRect, x, y, w, h)
        entry.colorRect.visible = true
        entry.worldRect = { x, y, width: w, height: h }

        const sourceKey = `${node.workspaceId}|${node.fileId}|${node.src}`
        if (sourceKey !== entry.sourceKey) {
            entry.sourceKey = sourceKey
            updateSource(entry, node).catch(() => {})
        }

        onRender?.()
    }

    const remove = (nodeId: string): void => {
        const entry = entries.get(nodeId)
        if (!entry) return

        try {
            entry.audioElement.pause()
            entry.audioElement.removeAttribute('src')
            entry.audioElement.load()
        } catch {
            // Best-effort teardown.
        }
        entry.removeEventListeners()
        entry.audioElement.remove()

        audioLayer.removeChild(entry.colorRect)
        entry.colorRect.destroy()
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
        drawColorRect(entry.colorRect, worldPosition.x, worldPosition.y, dimensions.width, dimensions.height)
        entry.worldRect = { x: worldPosition.x, y: worldPosition.y, width: dimensions.width, height: dimensions.height }
        onRender?.()
    }

    const destroy = (): void => {
        destroyed = true
        for (const nodeId of Array.from(entries.keys())) {
            remove(nodeId)
        }
        entries.clear()
        hiddenAudioHost?.remove()
        hiddenAudioHost = null
    }

    const play = async (nodeId: string): Promise<void> => {
        const entry = entries.get(nodeId)
        if (!entry || destroyed || entry.isPlaying) return
        try {
            await entry.audioElement.play()
            entry.isPlaying = !entry.audioElement.paused
        } catch (e) {
            console.warn('[audioNodeHandler] play failed', e)
        }
    }

    const pause = (nodeId: string): void => {
        const entry = entries.get(nodeId)
        if (!entry) return
        try { entry.audioElement.pause() } catch { /* noop */ }
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
        getAudioElement: (nodeId: string) => entries.get(nodeId)?.audioElement ?? null,
    }
}
