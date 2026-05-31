import { describe, it, expect, beforeEach, vi } from 'vitest'
import { select } from 'd3-selection'
import { createVideoControls } from '$src/components/videoControls/videoControls.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

type MockVideo = HTMLVideoElement & {
    _setCurrentTime: (value: number) => void
}

function createMockVideo(): MockVideo {
    const video = document.createElement('video') as MockVideo
    let currentTime = 0
    let duration = 120
    let paused = true
    let volume = 1
    let muted = false
    let playbackRate = 1

    Object.defineProperty(video, 'currentTime', {
        get: () => currentTime,
        set: (value: number) => { currentTime = value },
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
    video._setCurrentTime = (value: number) => { currentTime = value }

    return video
}

function mount(width = 520) {
    const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement
    document.body.appendChild(svg)
    const video = createMockVideo()
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
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX }))
}

function mockRect(element: Element, width: number): void {
    element.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: width,
        bottom: 44,
        width,
        height: 44,
        toJSON: () => ({}),
    })
}

describe('createVideoControls', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
    })

    it('appends an SVG control group with core controls', () => {
        const { svg } = mount()

        expect(svg.querySelector('.video-controls-group')).not.toBeNull()
        expect(svg.querySelector('.video-controls-play')).not.toBeNull()
        expect(svg.querySelector('.video-controls-seek-hit')).not.toBeNull()
        expect(svg.querySelector('.video-controls-speed')).not.toBeNull()
        expect(svg.querySelector('.video-controls-volume-hit')).not.toBeNull()
    })

    it('toggles play and pause through the supplied video element', async () => {
        const { svg, video } = mount()
        const playButton = svg.querySelector('.video-controls-play')!

        click(playButton)
        await Promise.resolve()

        expect(video.play).toHaveBeenCalledTimes(1)
        expect(video.paused).toBe(false)

        click(playButton)

        expect(video.pause).toHaveBeenCalledTimes(1)
        expect(video.paused).toBe(true)
    })

    it('skips relative to current time without leaving video bounds', () => {
        const { svg, video } = mount()
        video._setCurrentTime(20)

        click(svg.querySelector('.video-controls-skip-forward')!)
        expect(video.currentTime).toBe(30)

        click(svg.querySelector('.video-controls-skip-back')!)
        click(svg.querySelector('.video-controls-skip-back')!)
        click(svg.querySelector('.video-controls-skip-back')!)
        expect(video.currentTime).toBe(0)
    })

    it('scrubs the video by writing currentTime from pointer position', () => {
        const { svg, video } = mount()
        const seekHit = svg.querySelector('.video-controls-seek-hit')!
        mockRect(seekHit, 100)

        pointerDown(seekHit, 25)

        expect(video.currentTime).toBe(30)
    })

    it('sets playback rate from the speed menu', () => {
        const { svg, video } = mount()

        click(svg.querySelector('.video-controls-speed')!)
        click(svg.querySelector('.video-controls-rate-option-hit[data-rate="1.5"]')!)

        expect(video.playbackRate).toBe(1.5)
        expect(svg.querySelector('.video-controls-speed-text')?.textContent).toBe('1.5x')
    })

    it('writes volume and mute state from the volume slider and button', () => {
        const { svg, video } = mount()
        const volumeHit = svg.querySelector('.video-controls-volume-hit')!
        mockRect(volumeHit, 100)

        pointerDown(volumeHit, 45)
        expect(video.volume).toBe(0.45)
        expect(video.muted).toBe(false)

        click(svg.querySelector('.video-controls-volume-button')!)
        expect(video.muted).toBe(true)
    })

    it('removes media listeners and DOM on destroy', () => {
        const video = createMockVideo()
        const removeSpy = vi.spyOn(video, 'removeEventListener')
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
        expect(removeSpy).toHaveBeenCalledWith('timeupdate', expect.any(Function))
        expect(removeSpy).toHaveBeenCalledWith('play', expect.any(Function))
    })
})
