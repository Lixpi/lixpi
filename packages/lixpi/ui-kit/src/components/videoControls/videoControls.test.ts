import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { select } from 'd3-selection'
import { uiKitSettings } from '../../runtime-settings.ts'
import { applyVideoControlsHostStyleProperties, createVideoControls } from './videoControls.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

type MockVideo = HTMLVideoElement & {
    _setCurrentTime: (value: number) => void
    _currentTimeWrites: number[]
}

function createMockVideo(overrides: {
    duration?: number
    currentTime?: number
    volume?: number
    playbackRate?: number
    paused?: boolean
} = {}): MockVideo {
    const video = document.createElement('video') as MockVideo
    let currentTime = overrides.currentTime ?? 0
    let duration = overrides.duration ?? 120
    let paused = overrides.paused ?? true
    let volume = overrides.volume ?? 1
    let playbackRate = overrides.playbackRate ?? 1
    let muted = false

    Object.defineProperty(video, 'currentTime', {
        get: () => currentTime,
        set: (value: number) => {
            currentTime = value
            if (video._currentTimeWrites) video._currentTimeWrites.push(value)
            video.dispatchEvent(new Event('seeked'))
        },
        configurable: true,
    })
    Object.defineProperty(video, 'duration', {
        get: () => duration,
        set: (value: number) => { duration = value },
        configurable: true,
    })
    Object.defineProperty(video, 'paused', {
        get: () => paused,
        configurable: true,
    })
    Object.defineProperty(video, 'volume', {
        get: () => volume,
        set: (value: number) => { volume = value },
        configurable: true,
    })
    Object.defineProperty(video, 'muted', {
        get: () => muted,
        set: (value: boolean) => { muted = value },
        configurable: true,
    })
    Object.defineProperty(video, 'playbackRate', {
        get: () => playbackRate,
        set: (value: number) => { playbackRate = value },
        configurable: true,
    })
    Object.defineProperty(video, 'buffered', {
        get: () => ({
            length: 1,
            start: () => 0,
            end: () => 60,
        }),
        configurable: true,
    })

    video.play = vi.fn(async () => {
        paused = false
        video.dispatchEvent(new Event('play'))
    })
    video.pause = vi.fn(() => {
        paused = true
        video.dispatchEvent(new Event('pause'))
    })
    video.requestFullscreen = vi.fn(async () => {})

    video._currentTimeWrites = []
    video._setCurrentTime = (value: number) => { currentTime = value }

    return video
}

function mount(width = 520, video = createMockVideo()) {
    const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
    document.body.appendChild(svg)
    const controls = createVideoControls(select(svg), {
        id: 'video-1',
        x: 0,
        y: 0,
        width,
        videoEl: video,
    })

    return { svg, video, controls }
}

function click(element: Element): void {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function pointerDown(element: Element, clientX: number): void {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX }))
}

function pointerMove(clientX: number): void {
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX }))
}

function pointerUp(): void {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }))
}

function mockRect(element: Element, width: number): void {
    element.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: width,
        bottom: 52,
        width,
        height: 52,
        toJSON: () => ({}),
    } as DOMRect)
}

describe('createVideoControls', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('appends an SVG control group with core controls', () => {
        const { svg } = mount()

        expect(svg.querySelector('.video-controls-group')).not.toBeNull()
        expect(svg.querySelector('.video-controls-play')).not.toBeNull()
        expect(svg.querySelector('.video-controls-seek-hit')).not.toBeNull()
        expect(svg.querySelector('.video-controls-speed')).not.toBeNull()
        expect(svg.querySelector('.video-controls-volume-hit')).not.toBeNull()
        expect(svg.querySelector('.video-controls-volume-button')).not.toBeNull()
        expect(svg.querySelector('.video-controls-fullscreen')).not.toBeNull()
        expect(svg.querySelector('.video-controls-fullscreen-hit')).not.toBeNull()
    })

    it('toggles play and pause through the supplied video element', async () => {
        const { svg, video } = mount()
        const playHit = svg.querySelector('.video-controls-play-hit')!

        click(playHit)
        await Promise.resolve()

        expect(video.play).toHaveBeenCalledTimes(1)
        expect(video.paused).toBe(false)

        click(playHit)
        await Promise.resolve()

        expect(video.pause).toHaveBeenCalledTimes(1)
        expect(video.paused).toBe(true)
    })

    it('toggles playback rate with keyboard and resets speed on double click', async () => {
        const { svg, video } = mount()
        const speed = svg.querySelector('.video-controls-speed')!

        speed.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        expect(video.playbackRate).toBeCloseTo(1.05, 2)

        speed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
        expect(video.playbackRate).toBe(uiKitSettings.videoControls.speed.minRate)

        speed.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
        expect(video.playbackRate).toBe(uiKitSettings.videoControls.speed.maxRate)

        speed.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        expect(video.playbackRate).toBe(uiKitSettings.videoControls.speed.defaultRate)
    })

    it('seeks by dragging on the seek rail', () => {
        const { svg, video } = mount()
        const seekHit = svg.querySelector('.video-controls-seek-hit')!
        mockRect(seekHit, 100)

        pointerDown(seekHit, 25)
        pointerMove(75)
        pointerUp()

        expect(video.currentTime).toBe(90)
    })

    it('pauses while dragging and resumes playback only if video was playing before drag', async () => {
        const { svg, video } = mount()
        const seekHit = svg.querySelector('.video-controls-seek-hit')!
        mockRect(seekHit, 100)

        await video.play()
        vi.mocked(video.play).mockClear()
        vi.mocked(video.pause).mockClear()

        pointerDown(seekHit, 25)
        expect(video.pause).toHaveBeenCalledTimes(1)
        expect(video.paused).toBe(true)
        expect(video.currentTime).toBe(30)

        pointerMove(75)
        vi.runOnlyPendingTimers()
        expect(video.currentTime).toBe(90)

        pointerUp()
        await Promise.resolve()

        expect(video.play).toHaveBeenCalledTimes(1)
        expect(video.paused).toBe(false)
    })

    it('batches scrub updates while pointer remains down and applies latest target at release', async () => {
        const video = createMockVideo()
        const { svg } = mount(520, video)
        const seekHit = svg.querySelector('.video-controls-seek-hit')!
        mockRect(seekHit, 100)

        pointerDown(seekHit, 25)
        expect(video._currentTimeWrites).toEqual([30])

        pointerMove(50)
        expect(video._currentTimeWrites).toEqual([30])

        pointerMove(75)
        expect(video.currentTime).toBe(30)

        vi.runOnlyPendingTimers()

        expect(video._currentTimeWrites).toEqual([30, 90])
        expect(video.currentTime).toBe(90)

        pointerUp()
        await Promise.resolve()

        expect(video.playbackRate).toBe(1)
    })

    it('updates volume from slider drag and toggles mute via button', () => {
        const { svg, video } = mount()
        const volumeHit = svg.querySelector('.video-controls-volume-hit')!
        const volumeButtonHit = svg.querySelector('.video-controls-volume-button-hit')!

        mockRect(volumeHit, 100)

        pointerDown(volumeHit, 40)
        expect(video.volume).toBe(0.4)
        expect(video.muted).toBe(false)

        pointerDown(volumeHit, 0)
        expect(video.volume).toBe(0)
        expect(video.muted).toBe(true)

        click(volumeButtonHit)
        expect(video.muted).toBe(false)
        expect(video.volume).toBe(0.5)
    })

    it('requests fullscreen when supported and toggles back to exit when fullscreen is active', async () => {
        const video = createMockVideo()
        const originalRequestFullscreen = document.exitFullscreen
        const originalFullscreenElement = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
        const originalExitFullscreen = Object.getOwnPropertyDescriptor(document, 'exitFullscreen')

        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            writable: true,
            value: vi.fn(async () => {}),
        })

        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            writable: true,
            value: null,
        })

        const { svg } = mount(520, video)
        const fullscreenHit = svg.querySelector('.video-controls-fullscreen-hit')!

        click(fullscreenHit)
        expect(video.requestFullscreen).toHaveBeenCalledTimes(1)

        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            writable: true,
            value: video,
        })

        await Promise.resolve()
        click(fullscreenHit)
        expect(document.exitFullscreen).toHaveBeenCalledTimes(1)

        if (originalFullscreenElement) {
            Object.defineProperty(document, 'fullscreenElement', originalFullscreenElement)
        } else {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            delete (document as any).fullscreenElement
        }

        if (originalExitFullscreen) {
            Object.defineProperty(document, 'exitFullscreen', originalExitFullscreen)
        } else {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            Object.defineProperty(document, 'exitFullscreen', {
                value: originalRequestFullscreen,
                writable: true,
                configurable: true,
            })
        }
    })

    it('applies host styling variables', () => {
        const host = document.createElement('div')
        applyVideoControlsHostStyleProperties(host)

        expect(host.style.getPropertyValue('--video-controls-host-border-radius')).toBe(uiKitSettings.videoControls.styles.hostBorderRadius)
        expect(host.style.getPropertyValue('--video-controls-host-drop-shadow')).toBe(uiKitSettings.videoControls.styles.hostDropShadow)
        expect(host.style.getPropertyValue('--video-controls-host-backdrop-filter')).toBe(uiKitSettings.videoControls.styles.hostBackdropFilter)
        expect(host.style.getPropertyValue('--video-controls-host-reduced-transparency-background')).toBe(uiKitSettings.videoControls.styles.hostReducedTransparencyBackground)
    })

    it('removes media listeners and DOM on destroy', () => {
        const video = createMockVideo()
        const removeSpy = vi.spyOn(video, 'removeEventListener')
        const removeDocumentSpy = vi.spyOn(document, 'removeEventListener')
        const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
        document.body.appendChild(svg)

        const controls = createVideoControls(select(svg), {
            id: 'video-1',
            x: 0,
            y: 0,
            width: 520,
            videoEl: video,
        })

        controls.destroy()

        expect(svg.querySelector('.video-controls-group')).toBeNull()
        expect(removeSpy).toHaveBeenCalledWith('loadedmetadata', expect.any(Function))
        expect(removeDocumentSpy).toHaveBeenCalledWith('fullscreenchange', expect.any(Function))
    })
})
