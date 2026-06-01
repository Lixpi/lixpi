// SVG video control bar, built as a framework-agnostic d3 primitive like
// slidingSwitch and toggleSwitch. The component renders controls only; the host
// owns video pixels and supplies the HTMLVideoElement as the single source of truth.

// @ts-ignore - runtime import
import { select } from 'd3-selection'
import {
    videoFullscreenEnterGlyphIcon,
    videoFullscreenExitGlyphIcon,
    videoPauseGlyphIcon,
    videoPictureInPictureGlyphIcon,
    videoPlayGlyphIcon,
    videoSkipBack10GlyphIcon,
    videoSkipForward10GlyphIcon,
    videoVolumeHighGlyphIcon,
    videoVolumeMutedGlyphIcon,
} from '$src/svgIcons/index.ts'

export type VideoControlsConfig = {
    id: string
    x: number
    y: number
    width: number
    height?: number
    videoEl: HTMLVideoElement
    skipSeconds?: number
    playbackRates?: number[]
    className?: string
}

export type VideoControlsInstance = {
    render: () => void
    resize: (x: number, y: number, width: number) => void
    destroy: () => void
}

type ButtonControl = {
    group: any
    hit: any
    icon: any
}

const DEFAULT_HEIGHT = 44
const DEFAULT_SKIP_SECONDS = 10
const DEFAULT_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const PADDING = 6
const GAP = 4
const BUTTON_SIZE = 30
const ICON_SIZE = 18
const BAR_RADIUS = 10
const SCRUBBER_HEIGHT = 5
const SCRUBBER_HANDLE_RADIUS = 5
const TIME_WIDTH = 42
const SPEED_WIDTH = 44
const VOLUME_SLIDER_WIDTH = 54

const COLORS = {
    background: 'rgba(14, 18, 24, 0.82)',
    backgroundStroke: 'rgba(255, 255, 255, 0.14)',
    buttonHover: 'rgba(255, 255, 255, 0.12)',
    icon: 'rgba(255, 255, 255, 0.92)',
    iconMuted: 'rgba(255, 255, 255, 0.58)',
    text: 'rgba(255, 255, 255, 0.88)',
    textSubtle: 'rgba(255, 255, 255, 0.62)',
    rail: 'rgba(255, 255, 255, 0.22)',
    buffered: 'rgba(255, 255, 255, 0.32)',
    progress: '#ffffff',
    popup: 'rgba(18, 23, 32, 0.96)',
}

const MEDIA_EVENTS = [
    'loadedmetadata',
    'durationchange',
    'timeupdate',
    'progress',
    'play',
    'pause',
    'ended',
    'ratechange',
    'volumechange',
    'seeking',
    'seeked',
] as const

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

function isFiniteDuration(videoEl: HTMLVideoElement): boolean {
    return Number.isFinite(videoEl.duration) && videoEl.duration > 0
}

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
    const wholeSeconds = Math.floor(seconds)
    const minutes = Math.floor(wholeSeconds / 60)
    const remainingSeconds = wholeSeconds % 60
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

function formatRate(rate: number): string {
    return `${Number.isInteger(rate) ? String(rate) : String(rate).replace(/0$/, '')}x`
}

function extractPathData(svgMarkup: string): string[] {
    const parser = new DOMParser()
    const svgDoc = parser.parseFromString(svgMarkup, 'image/svg+xml')
    return Array.from(svgDoc.querySelectorAll('path'))
        .map((path) => path.getAttribute('d') || '')
        .filter(Boolean)
}

function setIconPaths(iconGroup: any, svgMarkup: string, fill: string = COLORS.icon): void {
    iconGroup.selectAll('*').remove()
    for (const pathData of extractPathData(svgMarkup)) {
        iconGroup.append('path')
            .attr('d', pathData)
            .attr('fill', fill)
    }
}

function setButtonPosition(button: ButtonControl, x: number, y: number, visible = true): void {
    button.group
        .attr('transform', `translate(${x}, ${y})`)
        .attr('display', visible ? null : 'none')
}

function bindButtonAction(button: ButtonControl, action: (event: Event) => void): void {
    const run = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        action(event)
    }

    button.group
        .on('click', run)
        .on('keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            run(event)
        })
        .on('mouseenter', () => button.hit.attr('fill', COLORS.buttonHover))
        .on('mouseleave', () => button.hit.attr('fill', 'transparent'))
}

function bufferedEnd(videoEl: HTMLVideoElement): number {
    if (!isFiniteDuration(videoEl)) return 0
    try {
        if (!videoEl.buffered || videoEl.buffered.length === 0) return 0
        return clamp(videoEl.buffered.end(videoEl.buffered.length - 1), 0, videoEl.duration)
    } catch {
        return 0
    }
}

function supportsPictureInPicture(videoEl: HTMLVideoElement): boolean {
    const doc = document as Document & {
        pictureInPictureEnabled?: boolean
    }
    const videoWithPip = videoEl as HTMLVideoElement & {
        requestPictureInPicture?: () => Promise<unknown>
    }
    return Boolean(doc.pictureInPictureEnabled && typeof videoWithPip.requestPictureInPicture === 'function')
}

function isPictureInPicture(videoEl: HTMLVideoElement): boolean {
    const doc = document as Document & {
        pictureInPictureElement?: Element | null
    }
    return doc.pictureInPictureElement === videoEl
}

function supportsFullscreen(videoEl: HTMLVideoElement): boolean {
    return typeof videoEl.requestFullscreen === 'function' && typeof document.exitFullscreen === 'function'
}

function isFullscreen(videoEl: HTMLVideoElement): boolean {
    return document.fullscreenElement === videoEl
}

class VideoControls implements VideoControlsInstance {
    private readonly id: string
    private readonly height: number
    private readonly videoEl: HTMLVideoElement
    private readonly skipSeconds: number
    private readonly playbackRates: number[]
    private readonly buttonY: number
    private readonly scrubberY: number

    private x: number
    private y: number
    private width: number
    private seekX = PADDING
    private seekWidth: number
    private volumeWidth = VOLUME_SLIDER_WIDTH
    private speedMenuOpen = false
    private destroyed = false
    private activePointerCleanup: (() => void) | null = null

    private readonly group: any
    private readonly background: any
    private readonly playButton: ButtonControl
    private readonly skipBackButton: ButtonControl
    private readonly skipForwardButton: ButtonControl
    private readonly volumeButton: ButtonControl
    private readonly pipButton: ButtonControl
    private readonly fullscreenButton: ButtonControl
    private readonly currentTimeText: any
    private readonly durationText: any
    private readonly seekGroup: any
    private readonly seekRail: any
    private readonly seekBuffered: any
    private readonly seekProgress: any
    private readonly seekHandle: any
    private readonly seekHit: any
    private readonly speedButton: any
    private readonly speedButtonBg: any
    private readonly speedText: any
    private readonly speedMenu: any
    private readonly volumeGroup: any
    private readonly volumeRail: any
    private readonly volumeProgress: any
    private readonly volumeHandle: any
    private readonly volumeHit: any

    constructor(parent: any, config: VideoControlsConfig) {
        const {
            id,
            videoEl,
            skipSeconds = DEFAULT_SKIP_SECONDS,
            playbackRates = DEFAULT_PLAYBACK_RATES,
            className = '',
        } = config

        this.id = id
        this.videoEl = videoEl
        this.skipSeconds = skipSeconds
        this.playbackRates = playbackRates
        this.x = config.x
        this.y = config.y
        this.width = config.width
        this.height = config.height ?? DEFAULT_HEIGHT
        this.buttonY = (this.height - BUTTON_SIZE) / 2
        this.scrubberY = this.height / 2 - SCRUBBER_HEIGHT / 2
        this.seekWidth = Math.max(1, this.width - PADDING * 2)

        this.group = parent.append('g')
            .attr('class', `video-controls-group ${className}`)
            .attr('transform', `translate(${this.x}, ${this.y})`)
            .attr('data-video-controls-id', this.id)
            .style('cursor', 'default')

        this.background = this.group.append('rect')
            .attr('class', 'video-controls-background')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('rx', BAR_RADIUS)
            .attr('ry', BAR_RADIUS)
            .attr('fill', COLORS.background)
            .attr('stroke', COLORS.backgroundStroke)
            .attr('stroke-width', 1)

        this.playButton = this.createButton('video-controls-play', videoPlayGlyphIcon, 'Play video')
        this.skipBackButton = this.createButton('video-controls-skip-back', videoSkipBack10GlyphIcon, `Skip back ${this.skipSeconds} seconds`)
        this.skipForwardButton = this.createButton('video-controls-skip-forward', videoSkipForward10GlyphIcon, `Skip forward ${this.skipSeconds} seconds`)
        this.volumeButton = this.createButton('video-controls-volume-button', videoVolumeHighGlyphIcon, 'Mute video')
        this.pipButton = this.createButton('video-controls-pip', videoPictureInPictureGlyphIcon, 'Picture in picture')
        this.fullscreenButton = this.createButton('video-controls-fullscreen', videoFullscreenEnterGlyphIcon, 'Enter fullscreen')

        this.currentTimeText = this.group.append('text')
            .attr('class', 'video-controls-current-time')
            .attr('y', this.height / 2)
            .attr('dominant-baseline', 'central')
            .attr('font-size', 11)
            .attr('font-weight', 600)
            .attr('fill', COLORS.textSubtle)

        this.durationText = this.group.append('text')
            .attr('class', 'video-controls-duration')
            .attr('y', this.height / 2)
            .attr('dominant-baseline', 'central')
            .attr('font-size', 11)
            .attr('font-weight', 600)
            .attr('fill', COLORS.textSubtle)

        this.seekGroup = this.group.append('g')
            .attr('class', 'video-controls-seek')
            .style('cursor', 'pointer')

        this.seekRail = this.seekGroup.append('rect')
            .attr('class', 'video-controls-seek-rail')
            .attr('y', this.scrubberY)
            .attr('height', SCRUBBER_HEIGHT)
            .attr('rx', SCRUBBER_HEIGHT / 2)
            .attr('ry', SCRUBBER_HEIGHT / 2)
            .attr('fill', COLORS.rail)

        this.seekBuffered = this.seekGroup.append('rect')
            .attr('class', 'video-controls-seek-buffered')
            .attr('y', this.scrubberY)
            .attr('height', SCRUBBER_HEIGHT)
            .attr('rx', SCRUBBER_HEIGHT / 2)
            .attr('ry', SCRUBBER_HEIGHT / 2)
            .attr('fill', COLORS.buffered)

        this.seekProgress = this.seekGroup.append('rect')
            .attr('class', 'video-controls-seek-progress')
            .attr('y', this.scrubberY)
            .attr('height', SCRUBBER_HEIGHT)
            .attr('rx', SCRUBBER_HEIGHT / 2)
            .attr('ry', SCRUBBER_HEIGHT / 2)
            .attr('fill', COLORS.progress)

        this.seekHandle = this.seekGroup.append('circle')
            .attr('class', 'video-controls-seek-handle')
            .attr('cy', this.scrubberY + SCRUBBER_HEIGHT / 2)
            .attr('r', SCRUBBER_HANDLE_RADIUS)
            .attr('fill', COLORS.progress)

        this.seekHit = this.seekGroup.append('rect')
            .attr('class', 'video-controls-seek-hit')
            .attr('y', 0)
            .attr('height', this.height)
            .attr('fill', 'transparent')

        this.speedButton = this.group.append('g')
            .attr('class', 'video-controls-speed')
            .attr('role', 'button')
            .attr('tabindex', 0)
            .attr('aria-label', 'Playback speed')
            .style('cursor', 'pointer')

        this.speedButtonBg = this.speedButton.append('rect')
            .attr('class', 'video-controls-speed-bg')
            .attr('x', 0)
            .attr('y', this.buttonY)
            .attr('width', SPEED_WIDTH)
            .attr('height', BUTTON_SIZE)
            .attr('rx', 7)
            .attr('ry', 7)
            .attr('fill', 'transparent')

        this.speedText = this.speedButton.append('text')
            .attr('class', 'video-controls-speed-text')
            .attr('x', SPEED_WIDTH / 2)
            .attr('y', this.height / 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-size', 11)
            .attr('font-weight', 650)
            .attr('fill', COLORS.text)

        this.speedMenu = this.group.append('g')
            .attr('class', 'video-controls-speed-menu')
            .attr('display', 'none')

        this.volumeGroup = this.group.append('g')
            .attr('class', 'video-controls-volume')
            .style('cursor', 'pointer')

        this.volumeRail = this.volumeGroup.append('rect')
            .attr('class', 'video-controls-volume-rail')
            .attr('y', this.scrubberY)
            .attr('height', SCRUBBER_HEIGHT)
            .attr('rx', SCRUBBER_HEIGHT / 2)
            .attr('ry', SCRUBBER_HEIGHT / 2)
            .attr('fill', COLORS.rail)

        this.volumeProgress = this.volumeGroup.append('rect')
            .attr('class', 'video-controls-volume-progress')
            .attr('y', this.scrubberY)
            .attr('height', SCRUBBER_HEIGHT)
            .attr('rx', SCRUBBER_HEIGHT / 2)
            .attr('ry', SCRUBBER_HEIGHT / 2)
            .attr('fill', COLORS.progress)

        this.volumeHandle = this.volumeGroup.append('circle')
            .attr('class', 'video-controls-volume-handle')
            .attr('cy', this.scrubberY + SCRUBBER_HEIGHT / 2)
            .attr('r', 4)
            .attr('fill', COLORS.progress)

        this.volumeHit = this.volumeGroup.append('rect')
            .attr('class', 'video-controls-volume-hit')
            .attr('y', 0)
            .attr('height', this.height)
            .attr('fill', 'transparent')

        this.bindButtonActions()
        this.bindSpeedButton()
        this.bindPointerDrag(this.seekHit, this.setVideoTimeFromEvent)
        this.bindPointerDrag(this.volumeHit, this.setVolumeFromEvent)
        this.addMediaListeners()
        this.createSpeedMenu()
        this.render()
    }

    render = (): void => {
        if (this.destroyed) return
        this.layout()

        const duration = isFiniteDuration(this.videoEl) ? this.videoEl.duration : 0
        const currentTime = duration > 0 ? clamp(this.videoEl.currentTime, 0, duration) : 0
        const progressRatio = duration > 0 ? currentTime / duration : 0
        const bufferedRatio = duration > 0 ? bufferedEnd(this.videoEl) / duration : 0
        const volume = this.videoEl.muted ? 0 : clamp(this.videoEl.volume, 0, 1)

        this.currentTimeText.text(formatTime(currentTime))
        this.durationText.text(formatTime(duration))

        this.seekBuffered.attr('width', this.seekWidth * bufferedRatio)
        this.seekProgress.attr('width', this.seekWidth * progressRatio)
        this.seekHandle.attr('cx', this.seekX + this.seekWidth * progressRatio)
            .attr('opacity', duration > 0 ? 1 : 0.45)
        this.seekGroup.attr('opacity', duration > 0 ? 1 : 0.45)

        const playIcon = this.videoEl.paused ? videoPlayGlyphIcon : videoPauseGlyphIcon
        setIconPaths(this.playButton.icon, playIcon)
        this.playButton.group.attr('aria-label', this.videoEl.paused ? 'Play video' : 'Pause video')

        const isMuted = this.videoEl.muted || this.videoEl.volume === 0
        const volumeIcon = isMuted ? videoVolumeMutedGlyphIcon : videoVolumeHighGlyphIcon
        setIconPaths(this.volumeButton.icon, volumeIcon, isMuted ? COLORS.iconMuted : COLORS.icon)
        this.volumeButton.group.attr('aria-label', isMuted ? 'Unmute video' : 'Mute video')
        this.volumeProgress.attr('width', this.volumeWidth * volume)
        this.volumeHandle.attr('cx', this.volumeWidth * volume)

        this.speedText.text(formatRate(this.videoEl.playbackRate || 1))
        this.speedMenu.attr('display', this.speedMenuOpen ? null : 'none')

        const fullscreenIcon = isFullscreen(this.videoEl) ? videoFullscreenExitGlyphIcon : videoFullscreenEnterGlyphIcon
        setIconPaths(this.fullscreenButton.icon, fullscreenIcon)
        this.fullscreenButton.group.attr('aria-label', isFullscreen(this.videoEl) ? 'Exit fullscreen' : 'Enter fullscreen')
        this.pipButton.group.attr('aria-pressed', String(isPictureInPicture(this.videoEl)))
    }

    resize = (nextX: number, nextY: number, nextWidth: number): void => {
        this.x = nextX
        this.y = nextY
        this.width = Math.max(120, nextWidth)
        this.group.attr('transform', `translate(${this.x}, ${this.y})`)
        this.render()
    }

    destroy = (): void => {
        if (this.destroyed) return
        this.destroyed = true
        this.activePointerCleanup?.()
        this.activePointerCleanup = null
        for (const eventName of MEDIA_EVENTS) {
            this.videoEl.removeEventListener(eventName, this.onMediaEvent)
        }
        document.removeEventListener('fullscreenchange', this.onMediaEvent)
        this.videoEl.removeEventListener('enterpictureinpicture', this.onMediaEvent)
        this.videoEl.removeEventListener('leavepictureinpicture', this.onMediaEvent)
        window.removeEventListener('pointerdown', this.closeSpeedMenuOnOutsidePointer, true)
        this.group.remove()
    }

    private createButton(className: string, iconMarkup: string, label: string): ButtonControl {
        const buttonGroup = this.group.append('g')
            .attr('class', className)
            .attr('role', 'button')
            .attr('tabindex', 0)
            .attr('aria-label', label)
            .style('cursor', 'pointer')

        const hit = buttonGroup.append('rect')
            .attr('class', `${className}-hit`)
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', BUTTON_SIZE)
            .attr('height', BUTTON_SIZE)
            .attr('rx', 7)
            .attr('ry', 7)
            .attr('fill', 'transparent')

        const icon = buttonGroup.append('g')
            .attr('class', `${className}-icon`)
            .attr('transform', `translate(${(BUTTON_SIZE - ICON_SIZE) / 2}, ${(BUTTON_SIZE - ICON_SIZE) / 2}) scale(${ICON_SIZE / 24})`)

        buttonGroup.append('text')
            .attr('class', `${className}-label`)
            .attr('x', BUTTON_SIZE / 2)
            .attr('y', BUTTON_SIZE / 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-size', 11)
            .attr('font-weight', 650)
            .attr('fill', COLORS.text)
            .attr('display', 'none')

        setIconPaths(icon, iconMarkup)
        return { group: buttonGroup, hit, icon }
    }

    private createSpeedMenu(): void {
        this.speedMenu.selectAll('*').remove()
        const optionHeight = 26
        const menuWidth = SPEED_WIDTH
        const menuHeight = optionHeight * this.playbackRates.length + 6

        this.speedMenu.append('rect')
            .attr('class', 'video-controls-speed-menu-bg')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', menuWidth)
            .attr('height', menuHeight)
            .attr('rx', 8)
            .attr('ry', 8)
            .attr('fill', COLORS.popup)
            .attr('stroke', COLORS.backgroundStroke)
            .attr('stroke-width', 1)

        for (const [index, rate] of this.playbackRates.entries()) {
            const optionY = 3 + index * optionHeight
            const optionGroup = this.speedMenu.append('g')
                .attr('class', 'video-controls-rate-option')
                .attr('transform', `translate(0, ${optionY})`)
                .style('cursor', 'pointer')

            optionGroup.append('rect')
                .attr('class', 'video-controls-rate-option-hit')
                .attr('x', 3)
                .attr('y', 1)
                .attr('width', menuWidth - 6)
                .attr('height', optionHeight - 2)
                .attr('rx', 5)
                .attr('ry', 5)
                .attr('fill', 'transparent')
                .attr('data-rate', String(rate))
                .on('mouseenter', function () { select(this).attr('fill', COLORS.buttonHover) })
                .on('mouseleave', function () { select(this).attr('fill', 'transparent') })
                .on('click', (event: MouseEvent) => {
                    event.preventDefault()
                    event.stopPropagation()
                    this.videoEl.playbackRate = rate
                    this.speedMenuOpen = false
                    this.render()
                })

            optionGroup.append('text')
                .attr('class', 'video-controls-rate-option-label')
                .attr('x', menuWidth / 2)
                .attr('y', optionHeight / 2)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'central')
                .attr('font-size', 11)
                .attr('font-weight', 650)
                .attr('fill', COLORS.text)
                .text(formatRate(rate))
        }
    }

    private layout(): void {
        const showSkip = this.width >= 340
        const showVolumeSlider = this.width >= 440
        const showPip = supportsPictureInPicture(this.videoEl) && this.width >= 380
        const showFullscreen = supportsFullscreen(this.videoEl) && this.width >= 320

        this.background.attr('width', this.width).attr('height', this.height)

        let left = PADDING
        setButtonPosition(this.playButton, left, this.buttonY)
        left += BUTTON_SIZE + GAP

        setButtonPosition(this.skipBackButton, left, this.buttonY, showSkip)
        if (showSkip) left += BUTTON_SIZE + GAP
        setButtonPosition(this.skipForwardButton, left, this.buttonY, showSkip)
        if (showSkip) left += BUTTON_SIZE + GAP

        this.currentTimeText.attr('x', left + 2)
        left += TIME_WIDTH

        let right = this.width - PADDING

        if (showFullscreen) {
            right -= BUTTON_SIZE
            setButtonPosition(this.fullscreenButton, right, this.buttonY, true)
            right -= GAP
        } else {
            setButtonPosition(this.fullscreenButton, right, this.buttonY, false)
        }

        if (showPip) {
            right -= BUTTON_SIZE
            setButtonPosition(this.pipButton, right, this.buttonY, true)
            right -= GAP
        } else {
            setButtonPosition(this.pipButton, right, this.buttonY, false)
        }

        if (showVolumeSlider) {
            right -= VOLUME_SLIDER_WIDTH
            this.volumeWidth = VOLUME_SLIDER_WIDTH
            this.volumeGroup.attr('transform', `translate(${right}, 0)`).attr('display', null)
            right -= GAP
        } else {
            this.volumeGroup.attr('display', 'none')
        }

        right -= BUTTON_SIZE
        setButtonPosition(this.volumeButton, right, this.buttonY)
        right -= GAP

        right -= SPEED_WIDTH
        this.speedButton.attr('transform', `translate(${right}, 0)`)
        this.speedMenu.attr('transform', `translate(${right}, ${this.buttonY - this.playbackRates.length * 26 - 12})`)
        right -= GAP

        right -= TIME_WIDTH
        this.durationText.attr('x', right + 4)
        right -= GAP

        this.seekX = left
        this.seekWidth = Math.max(36, right - left)
        this.seekRail.attr('x', this.seekX).attr('width', this.seekWidth)
        this.seekBuffered.attr('x', this.seekX)
        this.seekProgress.attr('x', this.seekX)
        this.seekHit.attr('x', this.seekX).attr('width', this.seekWidth)
        this.volumeRail.attr('x', 0).attr('width', this.volumeWidth)
        this.volumeProgress.attr('x', 0)
        this.volumeHit.attr('x', 0).attr('width', this.volumeWidth)
    }

    private seekRatioFromEvent(event: PointerEvent | MouseEvent): number {
        const node = this.seekHit.node() as SVGRectElement | null
        const rect = node?.getBoundingClientRect()
        if (!rect || rect.width <= 0) return 0
        return clamp((event.clientX - rect.left) / rect.width, 0, 1)
    }

    private volumeRatioFromEvent(event: PointerEvent | MouseEvent): number {
        const node = this.volumeHit.node() as SVGRectElement | null
        const rect = node?.getBoundingClientRect()
        if (!rect || rect.width <= 0) return 0
        return clamp((event.clientX - rect.left) / rect.width, 0, 1)
    }

    private readonly setVideoTimeFromEvent = (event: PointerEvent | MouseEvent): void => {
        if (!isFiniteDuration(this.videoEl)) return
        this.videoEl.currentTime = this.seekRatioFromEvent(event) * this.videoEl.duration
        this.render()
    }

    private readonly setVolumeFromEvent = (event: PointerEvent | MouseEvent): void => {
        this.videoEl.volume = this.volumeRatioFromEvent(event)
        this.videoEl.muted = this.videoEl.volume === 0
        this.render()
    }

    private bindPointerDrag(hit: any, applyValue: (event: PointerEvent) => void): void {
        hit.on('pointerdown', (event: PointerEvent) => {
            event.preventDefault()
            event.stopPropagation()
            this.activePointerCleanup?.()
            applyValue(event)

            const move = (moveEvent: PointerEvent) => applyValue(moveEvent)
            const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                this.activePointerCleanup = null
            }

            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
            this.activePointerCleanup = up
        })
    }

    private readonly closeSpeedMenuOnOutsidePointer = (event: PointerEvent): void => {
        if (!this.speedMenuOpen) return
        const target = event.target as Node | null
        const speedNode = this.speedButton.node() as Node | null
        const menuNode = this.speedMenu.node() as Node | null
        if ((speedNode && target && speedNode.contains(target)) || (menuNode && target && menuNode.contains(target))) return
        this.speedMenuOpen = false
        this.render()
    }

    private async togglePlay(): Promise<void> {
        try {
            if (this.videoEl.paused) await this.videoEl.play()
            else this.videoEl.pause()
        } catch (error) {
            console.warn('[videoControls] play toggle failed', error)
        }
        this.render()
    }

    private async togglePictureInPicture(): Promise<void> {
        if (!supportsPictureInPicture(this.videoEl)) return
        const doc = document as Document & {
            exitPictureInPicture?: () => Promise<void>
        }
        try {
            if (isPictureInPicture(this.videoEl)) await doc.exitPictureInPicture?.()
            else {
                const videoWithPip = this.videoEl as HTMLVideoElement & {
                    requestPictureInPicture?: () => Promise<unknown>
                }
                await videoWithPip.requestPictureInPicture?.()
            }
        } catch (error) {
            console.warn('[videoControls] picture-in-picture failed', error)
        }
        this.render()
    }

    private async toggleFullscreen(): Promise<void> {
        if (!supportsFullscreen(this.videoEl)) return
        try {
            if (isFullscreen(this.videoEl)) await document.exitFullscreen()
            else await this.videoEl.requestFullscreen()
        } catch (error) {
            console.warn('[videoControls] fullscreen failed', error)
        }
        this.render()
    }

    private bindButtonActions(): void {
        bindButtonAction(this.playButton, () => { void this.togglePlay() })
        bindButtonAction(this.skipBackButton, () => {
            if (!isFiniteDuration(this.videoEl)) return
            this.videoEl.currentTime = clamp(this.videoEl.currentTime - this.skipSeconds, 0, this.videoEl.duration)
            this.render()
        })
        bindButtonAction(this.skipForwardButton, () => {
            if (!isFiniteDuration(this.videoEl)) return
            this.videoEl.currentTime = clamp(this.videoEl.currentTime + this.skipSeconds, 0, this.videoEl.duration)
            this.render()
        })
        bindButtonAction(this.volumeButton, () => {
            this.videoEl.muted = !this.videoEl.muted
            if (!this.videoEl.muted && this.videoEl.volume === 0) this.videoEl.volume = 0.5
            this.render()
        })
        bindButtonAction(this.pipButton, () => { void this.togglePictureInPicture() })
        bindButtonAction(this.fullscreenButton, () => { void this.toggleFullscreen() })
    }

    private bindSpeedButton(): void {
        this.speedButton
            .on('click', (event: MouseEvent) => {
                event.preventDefault()
                event.stopPropagation()
                this.speedMenuOpen = !this.speedMenuOpen
                this.render()
            })
            .on('keydown', (event: KeyboardEvent) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                this.speedMenuOpen = !this.speedMenuOpen
                this.render()
            })
            .on('mouseenter', () => this.speedButtonBg.attr('fill', COLORS.buttonHover))
            .on('mouseleave', () => this.speedButtonBg.attr('fill', 'transparent'))
    }

    private addMediaListeners(): void {
        for (const eventName of MEDIA_EVENTS) {
            this.videoEl.addEventListener(eventName, this.onMediaEvent)
        }
        document.addEventListener('fullscreenchange', this.onMediaEvent)
        this.videoEl.addEventListener('enterpictureinpicture', this.onMediaEvent)
        this.videoEl.addEventListener('leavepictureinpicture', this.onMediaEvent)
        window.addEventListener('pointerdown', this.closeSpeedMenuOnOutsidePointer, true)
    }

    private readonly onMediaEvent = (): void => {
        this.render()
    }
}

export function createVideoControls(parent: any, config: VideoControlsConfig): VideoControlsInstance {
    return new VideoControls(parent, config)
}
