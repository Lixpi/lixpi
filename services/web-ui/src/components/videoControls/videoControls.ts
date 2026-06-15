// SVG video control bar, built as a framework-agnostic d3 primitive like
// slidingSwitch and toggleSwitch. The component renders controls only; the host
// owns video pixels and supplies the HTMLVideoElement as the single source of truth.

import {
    videoFullscreenEnterGlyphIcon,
    videoFullscreenExitGlyphIcon,
    videoPauseGlyphIcon,
    videoPlayGlyphIcon,
    videoSpeedGlyphIcon,
    videoVolumeHighGlyphIcon,
    videoVolumeMutedGlyphIcon,
} from '$src/svgIcons/index.ts'
import { settings } from '$src/settings.ts'

export type VideoControlsConfig = {
    id: string
    x: number
    y: number
    width: number
    height?: number
    videoEl: HTMLVideoElement
    className?: string
}

export type VideoControlsInstance = {
    render: () => void
    resize: (x: number, y: number, width: number) => void
    destroy: () => void
}

export function applyVideoControlsHostStyleProperties(host: HTMLElement): void {
    const styles = settings.videoControls.styles
    host.style.setProperty('--video-controls-host-border-radius', styles.hostBorderRadius)
    host.style.setProperty('--video-controls-host-drop-shadow', styles.hostDropShadow)
    host.style.setProperty('--video-controls-host-backdrop-filter', styles.hostBackdropFilter)
    host.style.setProperty('--video-controls-host-reduced-transparency-background', styles.hostReducedTransparencyBackground)
}

type ButtonControl = {
    group: any
    hit: any
    icon: any
}

type SpeedGuideTickControl = {
    rate: number
    tick: any
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

function formatRate(rate: number, precision = settings.videoControls.speed.displayPrecision): string {
    const formatted = rate.toFixed(precision).replace(/\.?0+$/, '')
    return `${formatted}x`
}

function roundToStep(value: number, step: number): number {
    if (!Number.isFinite(step) || step <= 0) return value
    const precision = Math.max(0, String(step).split('.')[1]?.length ?? 0)
    return Number((Math.round(value / step) * step).toFixed(precision))
}

function sanitizeSvgId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-') || 'video-controls'
}

function extractPathData(svgMarkup: string): string[] {
    const parser = new DOMParser()
    const svgDoc = parser.parseFromString(svgMarkup, 'image/svg+xml')
    return Array.from(svgDoc.querySelectorAll('path'))
        .map((path) => path.getAttribute('d') || '')
        .filter(Boolean)
}

function getSvgViewBoxTransform(svgMarkup: string): string | null {
    const parser = new DOMParser()
    const svgDoc = parser.parseFromString(svgMarkup, 'image/svg+xml')
    const svgEl = svgDoc.querySelector('svg')
    const viewBox = svgEl?.getAttribute('viewBox')
    if (!viewBox) return null

    const values = viewBox
        .trim()
        .split(/[\s,]+/)
        .map(Number)
    if (values.length !== 4) return null

    const minX = values[0] ?? Number.NaN
    const minY = values[1] ?? Number.NaN
    const width = values[2] ?? Number.NaN
    const height = values[3] ?? Number.NaN
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(width) || !Number.isFinite(height)) return null
    if (width <= 0 || height <= 0) return null

    const scale = Math.min(24 / width, 24 / height)
    const x = (24 - width * scale) / 2 - minX * scale
    const y = (24 - height * scale) / 2 - minY * scale
    return `translate(${x} ${y}) scale(${scale})`
}

function setIconPaths(iconGroup: any, svgMarkup: string, fill: string = settings.videoControls.styles.icon): void {
    iconGroup.selectAll('*').remove()
    const iconPathGroup = iconGroup.append('g')
    const transform = getSvgViewBoxTransform(svgMarkup)
    if (transform) iconPathGroup.attr('transform', transform)
    for (const pathData of extractPathData(svgMarkup)) {
        iconPathGroup.append('path')
            .attr('d', pathData)
            .attr('fill', fill)
    }
}

function setButtonPosition(button: ButtonControl, x: number, y: number, visible = true): void {
    button.group
        .attr('transform', `translate(${x}, ${y})`)
        .attr('display', visible ? null : 'none')
}

function roundedRectRadius(configuredRadius: number, height: number): number {
    return Math.max(0, Math.min(configuredRadius, height / 2))
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
        .on('mouseenter', () => button.hit.attr('fill', settings.videoControls.styles.buttonHover))
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
    private readonly buttonY: number
    private readonly scrubberY: number
    private readonly glassFilterId: string
    private readonly glassClipId: string

    private x: number
    private y: number
    private width: number
    private seekX = settings.videoControls.layout.padding
    private seekWidth: number
    private volumeWidth = settings.videoControls.layout.volumeSliderWidth
    private speedX = 0
    private speedSliderX = 0
    private speedSliderWidth = settings.videoControls.layout.speedSliderWidth
    private destroyed = false
    private activePointerCleanup: (() => void) | null = null
    private scrubPreviewTime: number | null = null
    private scrubDragActive = false
    private scrubResumeOnRelease = false
    private scrubSeekTarget: number | null = null
    private scrubAppliedTime: number | null = null
    private scrubSeekInFlight = false
    private scrubSeekCleanup: (() => void) | null = null

    private readonly group: any
    private readonly defs: any
    private readonly backgroundClip: any
    private readonly background: any
    private readonly backgroundHighlight: any
    private readonly playButton: ButtonControl
    private readonly volumeButton: ButtonControl
    private readonly fullscreenButton: ButtonControl
    private readonly currentTimeText: any
    private readonly durationText: any
    private readonly seekGroup: any
    private readonly seekRail: any
    private readonly seekBuffered: any
    private readonly seekProgress: any
    private readonly seekHandle: any
    private readonly seekHit: any
    private readonly speedGroup: any
    private readonly speedIcon: any
    private readonly speedText: any
    private readonly speedRail: any
    private readonly speedProgress: any
    private readonly speedHandle: any
    private readonly speedHit: any
    private readonly speedScale: any
    private readonly speedGuideTicks: SpeedGuideTickControl[]
    private readonly volumeGroup: any
    private readonly volumeRail: any
    private readonly volumeProgress: any
    private readonly volumeHandle: any
    private readonly volumeHit: any

    constructor(parent: any, config: VideoControlsConfig) {
        const {
            id,
            videoEl,
            className = '',
        } = config
        const { layout, styles, speed, typography } = settings.videoControls

        this.id = id
        this.videoEl = videoEl
        this.x = config.x
        this.y = config.y
        this.width = config.width
        this.height = config.height ?? settings.videoControls.height
        this.buttonY = (this.height - layout.buttonSize) / 2
        this.scrubberY = this.height / 2 - layout.railHeight / 2
        this.seekWidth = Math.max(1, this.width - layout.padding * 2)
        this.glassFilterId = `video-controls-liquid-glass-${sanitizeSvgId(this.id)}`
        this.glassClipId = `video-controls-pill-clip-${sanitizeSvgId(this.id)}`

        this.group = parent.append('g')
            .attr('class', `video-controls-group ${className}`)
            .attr('transform', `translate(${this.x}, ${this.y})`)
            .attr('data-video-controls-id', this.id)
            .style('cursor', 'default')

        this.defs = this.group.append('defs')
        this.createLiquidGlassFilter()

        this.backgroundClip = this.defs.append('clipPath')
            .attr('id', this.glassClipId)
            .append('rect')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('rx', roundedRectRadius(layout.barRadius, this.height))
            .attr('ry', roundedRectRadius(layout.barRadius, this.height))

        this.background = this.group.append('rect')
            .attr('class', 'video-controls-background')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('rx', roundedRectRadius(layout.barRadius, this.height))
            .attr('ry', roundedRectRadius(layout.barRadius, this.height))
            .attr('fill', styles.background)
            .attr('stroke', styles.backgroundStroke)
            .attr('stroke-width', styles.backgroundStrokeWidth)
            .attr('clip-path', `url(#${this.glassClipId})`)
            .attr('filter', styles.liquidGlassFilter.displacementScale > 0 ? `url(#${this.glassFilterId})` : null)

        const highlightHeight = Math.max(0, this.height - layout.backgroundHighlightInset * 2)
        this.backgroundHighlight = this.group.append('rect')
            .attr('class', 'video-controls-background-highlight')
            .attr('x', layout.backgroundHighlightInset)
            .attr('y', layout.backgroundHighlightInset)
            .attr('width', Math.max(0, this.width - layout.backgroundHighlightInset * 2))
            .attr('height', highlightHeight)
            .attr('rx', roundedRectRadius(Math.max(0, layout.barRadius - layout.backgroundHighlightInset), highlightHeight))
            .attr('ry', roundedRectRadius(Math.max(0, layout.barRadius - layout.backgroundHighlightInset), highlightHeight))
            .attr('fill', 'none')
            .attr('stroke', styles.glassHighlight)
            .attr('stroke-width', styles.glassHighlightStrokeWidth)
            .attr('clip-path', `url(#${this.glassClipId})`)
            .attr('pointer-events', 'none')

        this.playButton = this.createButton('video-controls-play', videoPlayGlyphIcon, 'Play video')
        this.volumeButton = this.createButton('video-controls-volume-button', videoVolumeHighGlyphIcon, 'Mute video')
        this.fullscreenButton = this.createButton('video-controls-fullscreen', videoFullscreenEnterGlyphIcon, 'Enter fullscreen')

        this.currentTimeText = this.group.append('text')
            .attr('class', 'video-controls-current-time')
            .attr('y', this.height / 2)
            .attr('dominant-baseline', 'central')
            .attr('font-size', typography.timeFontSize)
            .attr('font-weight', typography.timeFontWeight)
            .attr('fill', styles.textSubtle)

        this.durationText = this.group.append('text')
            .attr('class', 'video-controls-duration')
            .attr('y', this.height / 2)
            .attr('dominant-baseline', 'central')
            .attr('font-size', typography.timeFontSize)
            .attr('font-weight', typography.timeFontWeight)
            .attr('fill', styles.textSubtle)

        this.seekGroup = this.group.append('g')
            .attr('class', 'video-controls-seek')
            .style('cursor', 'pointer')

        this.seekRail = this.seekGroup.append('rect')
            .attr('class', 'video-controls-seek-rail')
            .attr('y', this.scrubberY)
            .attr('height', layout.railHeight)
            .attr('rx', layout.railHeight / 2)
            .attr('ry', layout.railHeight / 2)
            .attr('fill', styles.rail)

        this.seekBuffered = this.seekGroup.append('rect')
            .attr('class', 'video-controls-seek-buffered')
            .attr('y', this.scrubberY)
            .attr('height', layout.railHeight)
            .attr('rx', layout.railHeight / 2)
            .attr('ry', layout.railHeight / 2)
            .attr('fill', styles.buffered)

        this.seekProgress = this.seekGroup.append('rect')
            .attr('class', 'video-controls-seek-progress')
            .attr('y', this.scrubberY)
            .attr('height', layout.railHeight)
            .attr('rx', layout.railHeight / 2)
            .attr('ry', layout.railHeight / 2)
            .attr('fill', styles.progress)

        this.seekHandle = this.seekGroup.append('circle')
            .attr('class', 'video-controls-seek-handle')
            .attr('cy', this.scrubberY + layout.railHeight / 2)
            .attr('r', layout.scrubberHandleRadius)
            .attr('fill', styles.progress)

        this.seekHit = this.seekGroup.append('rect')
            .attr('class', 'video-controls-seek-hit')
            .attr('y', 0)
            .attr('height', this.height)
            .attr('fill', 'transparent')

        this.speedGroup = this.group.append('g')
            .attr('class', 'video-controls-speed')
            .attr('role', 'slider')
            .attr('tabindex', 0)
            .attr('aria-label', 'Playback speed')
            .attr('aria-valuemin', speed.minRate)
            .attr('aria-valuemax', speed.maxRate)
            .style('cursor', 'pointer')

        const speedIconY = this.buttonY + (layout.buttonSize - layout.speedIconSize) / 2
        const speedIconScale = layout.speedIconSize / 24
        const speedIconTransform = `translate(0, ${speedIconY}) scale(${speedIconScale})`
        this.speedIcon = this.speedGroup.append('g')
            .attr('class', 'video-controls-speed-icon')
            .attr('aria-hidden', 'true')
            .attr('pointer-events', 'none')
            .attr('transform', speedIconTransform)
        setIconPaths(this.speedIcon, videoSpeedGlyphIcon)

        this.speedText = this.speedGroup.append('text')
            .attr('class', 'video-controls-speed-text')
            .attr('x', 0)
            .attr('y', this.scrubberY - layout.speedValueLabelOffset)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-size', typography.speedFontSize)
            .attr('font-weight', typography.speedFontWeight)
            .attr('fill', styles.speedValueLabel)
            .attr('pointer-events', 'none')

        this.speedScale = this.speedGroup.append('g')
            .attr('class', 'video-controls-speed-scale')
            .attr('aria-hidden', 'true')

        this.speedGuideTicks = speed.guideRates.map((rate) => ({
            rate,
            tick: this.speedScale.append('line')
                .attr('class', 'video-controls-speed-scale-tick')
                .attr('stroke', styles.speedScaleTick)
                .attr('stroke-width', styles.speedScaleTickWidth)
                .attr('stroke-linecap', 'round'),
        }))

        this.speedRail = this.speedGroup.append('rect')
            .attr('class', 'video-controls-speed-rail')
            .attr('y', this.scrubberY)
            .attr('height', layout.railHeight)
            .attr('rx', layout.railHeight / 2)
            .attr('ry', layout.railHeight / 2)
            .attr('fill', styles.rail)

        this.speedProgress = this.speedGroup.append('rect')
            .attr('class', 'video-controls-speed-progress')
            .attr('y', this.scrubberY)
            .attr('height', layout.railHeight)
            .attr('rx', layout.railHeight / 2)
            .attr('ry', layout.railHeight / 2)
            .attr('fill', styles.progress)

        this.speedHandle = this.speedGroup.append('circle')
            .attr('class', 'video-controls-speed-handle')
            .attr('cy', this.scrubberY + layout.railHeight / 2)
            .attr('r', layout.scrubberHandleRadius)
            .attr('fill', styles.progress)

        this.speedHit = this.speedGroup.append('rect')
            .attr('class', 'video-controls-speed-hit')
            .attr('y', 0)
            .attr('height', this.height)
            .attr('fill', 'transparent')

        this.volumeGroup = this.group.append('g')
            .attr('class', 'video-controls-volume')
            .style('cursor', 'pointer')

        this.volumeRail = this.volumeGroup.append('rect')
            .attr('class', 'video-controls-volume-rail')
            .attr('y', this.scrubberY)
            .attr('height', layout.railHeight)
            .attr('rx', layout.railHeight / 2)
            .attr('ry', layout.railHeight / 2)
            .attr('fill', styles.rail)

        this.volumeProgress = this.volumeGroup.append('rect')
            .attr('class', 'video-controls-volume-progress')
            .attr('y', this.scrubberY)
            .attr('height', layout.railHeight)
            .attr('rx', layout.railHeight / 2)
            .attr('ry', layout.railHeight / 2)
            .attr('fill', styles.progress)

        this.volumeHandle = this.volumeGroup.append('circle')
            .attr('class', 'video-controls-volume-handle')
            .attr('cy', this.scrubberY + layout.railHeight / 2)
            .attr('r', layout.volumeHandleRadius)
            .attr('fill', styles.progress)

        this.volumeHit = this.volumeGroup.append('rect')
            .attr('class', 'video-controls-volume-hit')
            .attr('y', 0)
            .attr('height', this.height)
            .attr('fill', 'transparent')

        this.bindButtonActions()
        this.bindSpeedSlider()
        this.bindSeekDrag()
        this.bindPointerDrag(this.speedHit, this.setSpeedFromEvent)
        this.bindPointerDrag(this.volumeHit, this.setVolumeFromEvent)
        this.addMediaListeners()
        this.render()
    }

    render = (): void => {
        if (this.destroyed) return
        this.layout()

        const duration = isFiniteDuration(this.videoEl) ? this.videoEl.duration : 0
        const currentTime = duration > 0 ? clamp(this.scrubPreviewTime ?? this.videoEl.currentTime, 0, duration) : 0
        const progressRatio = duration > 0 ? currentTime / duration : 0
        const bufferedRatio = duration > 0 ? bufferedEnd(this.videoEl) / duration : 0
        const volume = this.videoEl.muted ? 0 : clamp(this.videoEl.volume, 0, 1)
        const speed = clamp(this.videoEl.playbackRate || 1, settings.videoControls.speed.minRate, settings.videoControls.speed.maxRate)
        const speedRatio = this.speedRatio(speed)

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
        setIconPaths(this.volumeButton.icon, volumeIcon, isMuted ? settings.videoControls.styles.iconMuted : settings.videoControls.styles.icon)
        this.volumeButton.group.attr('aria-label', isMuted ? 'Unmute video' : 'Mute video')
        this.volumeProgress.attr('width', this.volumeWidth * volume)
        this.volumeHandle.attr('cx', this.volumeWidth * volume)

        this.speedText.text(formatRate(speed))
            .attr('x', this.speedSliderX + this.speedSliderWidth * speedRatio)
        this.speedGroup
            .attr('aria-valuenow', speed)
            .attr('aria-valuetext', formatRate(speed))
        this.speedProgress.attr('width', this.speedSliderWidth * speedRatio)
        this.speedHandle.attr('cx', this.speedSliderX + this.speedSliderWidth * speedRatio)

        const fullscreenIcon = isFullscreen(this.videoEl) ? videoFullscreenExitGlyphIcon : videoFullscreenEnterGlyphIcon
        setIconPaths(this.fullscreenButton.icon, fullscreenIcon)
        this.fullscreenButton.group.attr('aria-label', isFullscreen(this.videoEl) ? 'Exit fullscreen' : 'Enter fullscreen')
    }

    resize = (nextX: number, nextY: number, nextWidth: number): void => {
        this.x = nextX
        this.y = nextY
        this.width = Math.max(1, nextWidth)
        this.group.attr('transform', `translate(${this.x}, ${this.y})`)
        this.render()
    }

    destroy = (): void => {
        if (this.destroyed) return
        this.destroyed = true
        this.activePointerCleanup?.()
        this.activePointerCleanup = null
        this.cancelScrubSeek()
        for (const eventName of MEDIA_EVENTS) {
            this.videoEl.removeEventListener(eventName, this.onMediaEvent)
        }
        document.removeEventListener('fullscreenchange', this.onMediaEvent)
        this.group.remove()
    }

    private createLiquidGlassFilter(): void {
        const { liquidGlassFilter } = settings.videoControls.styles
        if (liquidGlassFilter.displacementScale <= 0) return

        const filter = this.defs.append('filter')
            .attr('id', this.glassFilterId)
            .attr('x', '-12%')
            .attr('y', '-30%')
            .attr('width', '124%')
            .attr('height', '160%')
            .attr('color-interpolation-filters', 'sRGB')

        filter.append('feTurbulence')
            .attr('type', 'fractalNoise')
            .attr('baseFrequency', liquidGlassFilter.baseFrequency)
            .attr('numOctaves', liquidGlassFilter.numOctaves)
            .attr('seed', liquidGlassFilter.seed)
            .attr('result', 'glass-noise')

        filter.append('feDisplacementMap')
            .attr('in', 'SourceGraphic')
            .attr('in2', 'glass-noise')
            .attr('scale', liquidGlassFilter.displacementScale)
            .attr('xChannelSelector', 'R')
            .attr('yChannelSelector', 'G')
    }

    private createButton(className: string, iconMarkup: string, label: string): ButtonControl {
        const { layout, styles, typography } = settings.videoControls
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
            .attr('width', layout.buttonSize)
            .attr('height', layout.buttonSize)
            .attr('rx', roundedRectRadius(layout.buttonRadius, layout.buttonSize))
            .attr('ry', roundedRectRadius(layout.buttonRadius, layout.buttonSize))
            .attr('fill', 'transparent')

        const icon = buttonGroup.append('g')
            .attr('class', `${className}-icon`)
            .attr('transform', `translate(${(layout.buttonSize - layout.iconSize) / 2}, ${(layout.buttonSize - layout.iconSize) / 2}) scale(${layout.iconSize / 24})`)

        buttonGroup.append('text')
            .attr('class', `${className}-label`)
            .attr('x', layout.buttonSize / 2)
            .attr('y', layout.buttonSize / 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-size', typography.hiddenButtonLabelFontSize)
            .attr('font-weight', typography.hiddenButtonLabelFontWeight)
            .attr('fill', styles.text)
            .attr('display', 'none')

        setIconPaths(icon, iconMarkup)
        return { group: buttonGroup, hit, icon }
    }

    private layout(): void {
        const { layout, responsive } = settings.videoControls
        const showSpeedSlider = this.width >= responsive.showSpeedSliderMinWidth
        const showVolumeSlider = this.width >= responsive.showVolumeSliderMinWidth
        const showFullscreen = supportsFullscreen(this.videoEl) && this.width >= responsive.showFullscreenMinWidth
        const speedSliderTargetWidth = this.width >= responsive.fullSpeedSliderMinWidth
            ? layout.speedSliderWidth
            : layout.compactSpeedSliderWidth
        const speedSliderWidth = Math.max(layout.speedSliderMinWidth, speedSliderTargetWidth)
        const speedSliderInset = layout.speedIconSize + layout.speedIconSliderGap + layout.speedValueLabelEdgeInset
        const speedControlWidth = speedSliderInset + speedSliderWidth + layout.speedValueLabelEdgeInset

        this.background
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('rx', roundedRectRadius(layout.barRadius, this.height))
            .attr('ry', roundedRectRadius(layout.barRadius, this.height))
        const highlightHeight = Math.max(0, this.height - layout.backgroundHighlightInset * 2)
        this.backgroundClip
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('rx', roundedRectRadius(layout.barRadius, this.height))
            .attr('ry', roundedRectRadius(layout.barRadius, this.height))
        this.backgroundHighlight
            .attr('width', Math.max(0, this.width - layout.backgroundHighlightInset * 2))
            .attr('height', highlightHeight)
            .attr('rx', roundedRectRadius(Math.max(0, layout.barRadius - layout.backgroundHighlightInset), highlightHeight))
            .attr('ry', roundedRectRadius(Math.max(0, layout.barRadius - layout.backgroundHighlightInset), highlightHeight))
        let left = layout.padding
        setButtonPosition(this.playButton, left, this.buttonY)
        left += layout.buttonSize + layout.gap

        this.currentTimeText.attr('x', left + 2)
        left += layout.timeWidth

        let right = this.width - layout.padding

        if (showFullscreen) {
            right -= layout.buttonSize
            setButtonPosition(this.fullscreenButton, right, this.buttonY, true)
            right -= layout.gap
        } else {
            setButtonPosition(this.fullscreenButton, right, this.buttonY, false)
        }

        if (showVolumeSlider) {
            right -= layout.volumeSliderWidth
            this.volumeWidth = layout.volumeSliderWidth
            this.volumeGroup.attr('transform', `translate(${right}, 0)`).attr('display', null)
            right -= layout.gap
        } else {
            this.volumeGroup.attr('display', 'none')
        }

        right -= layout.buttonSize
        setButtonPosition(this.volumeButton, right, this.buttonY)
        right -= layout.gap

        if (showSpeedSlider) {
            right -= speedControlWidth
            this.speedX = right
            this.speedSliderWidth = speedSliderWidth
            this.speedSliderX = speedSliderInset
            this.speedGroup.attr('transform', `translate(${this.speedX}, 0)`).attr('display', null)
            this.speedRail.attr('x', this.speedSliderX).attr('width', this.speedSliderWidth)
            this.speedProgress.attr('x', this.speedSliderX)
            this.speedHit.attr('x', this.speedSliderX).attr('width', this.speedSliderWidth)

            for (const { rate, tick } of this.speedGuideTicks) {
                const guideX = this.speedSliderX + this.speedSliderWidth * this.speedRatio(rate)
                tick.attr('x1', guideX)
                    .attr('x2', guideX)
                    .attr('y1', this.scrubberY - layout.speedScaleTickHeight / 2)
                    .attr('y2', this.scrubberY + layout.railHeight + layout.speedScaleTickHeight / 2)
                    .attr('display', null)
            }
            right -= layout.gap
        } else {
            this.speedGroup.attr('display', 'none')
        }

        right -= layout.timeWidth
        this.durationText.attr('x', right + 4)
        right -= layout.gap

        this.seekX = left
        this.seekWidth = Math.max(layout.minSeekWidth, right - left)
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

    private speedRatio(rate: number): number {
        const { minRate, maxRate } = settings.videoControls.speed
        const guideRate = this.speedGuideRate()
        const safeRate = clamp(rate, minRate, maxRate)
        if (maxRate <= minRate) return 0
        if (guideRate <= minRate || guideRate >= maxRate) return clamp((safeRate - minRate) / (maxRate - minRate), 0, 1)
        if (safeRate <= guideRate) return clamp((safeRate - minRate) / (guideRate - minRate) * 0.5, 0, 0.5)
        return clamp(0.5 + (safeRate - guideRate) / (maxRate - guideRate) * 0.5, 0.5, 1)
    }

    private speedFromRatio(ratio: number, step = settings.videoControls.speed.pointerStep): number {
        const { minRate, maxRate } = settings.videoControls.speed
        const guideRate = this.speedGuideRate()
        const safeRatio = clamp(ratio, 0, 1)
        let rawRate = minRate + safeRatio * (maxRate - minRate)
        if (guideRate > minRate && guideRate < maxRate) {
            rawRate = safeRatio <= 0.5
                ? minRate + safeRatio / 0.5 * (guideRate - minRate)
                : guideRate + (safeRatio - 0.5) / 0.5 * (maxRate - guideRate)
        }
        return clamp(roundToStep(rawRate, step), minRate, maxRate)
    }

    private speedGuideRate(): number {
        const { guideRate, minRate, maxRate } = settings.videoControls.speed
        return clamp(guideRate, minRate, maxRate)
    }

    private speedRatioFromEvent(event: PointerEvent | MouseEvent): number {
        const node = this.speedHit.node() as SVGRectElement | null
        const rect = node?.getBoundingClientRect()
        if (!rect || rect.width <= 0) return this.speedRatio(this.videoEl.playbackRate || 1)
        return clamp((event.clientX - rect.left) / rect.width, 0, 1)
    }

    private readonly setVideoTimeFromEvent = (event: PointerEvent | MouseEvent): void => {
        if (!isFiniteDuration(this.videoEl)) return
        const targetTime = this.seekRatioFromEvent(event) * this.videoEl.duration
        this.scrubPreviewTime = targetTime
        this.queueScrubSeek(targetTime)
        this.render()
    }

    private readonly setVolumeFromEvent = (event: PointerEvent | MouseEvent): void => {
        this.videoEl.volume = this.volumeRatioFromEvent(event)
        this.videoEl.muted = this.videoEl.volume === 0
        this.render()
    }

    private readonly setSpeedFromEvent = (event: PointerEvent | MouseEvent): void => {
        this.videoEl.playbackRate = this.speedFromRatio(this.speedRatioFromEvent(event))
        this.render()
    }

    private resetSpeedToDefault(): void {
        const { defaultRate, guideRate, minRate, maxRate } = settings.videoControls.speed
        const targetRate = Number.isFinite(defaultRate) ? defaultRate : guideRate
        this.videoEl.playbackRate = clamp(targetRate, minRate, maxRate)
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

    private bindSeekDrag(): void {
        this.seekHit.on('pointerdown', (event: PointerEvent) => {
            event.preventDefault()
            event.stopPropagation()
            if (!isFiniteDuration(this.videoEl)) return

            this.activePointerCleanup?.()
            this.scrubDragActive = true
            this.scrubResumeOnRelease = !this.videoEl.paused
            if (this.scrubResumeOnRelease) this.videoEl.pause()
            this.setVideoTimeFromEvent(event)

            const move = (moveEvent: PointerEvent) => {
                moveEvent.preventDefault()
                moveEvent.stopPropagation()
                this.setVideoTimeFromEvent(moveEvent)
            }
            const removeListeners = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                window.removeEventListener('pointercancel', cancel)
                this.activePointerCleanup = null
            }
            const finish = () => {
                removeListeners()
                this.scrubDragActive = false
                this.cancelScrubSeek()
                this.applyScrubSeekTarget()
                this.cancelScrubSeek()
                this.finishScrubAfterSeek()
            }
            const up = () => finish()
            const cancel = () => finish()

            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
            window.addEventListener('pointercancel', cancel)
            this.activePointerCleanup = finish
        })
    }

    private queueScrubSeek(targetTime: number): void {
        if (!isFiniteDuration(this.videoEl)) return
        this.scrubSeekTarget = clamp(targetTime, 0, this.videoEl.duration)
        if (!this.scrubSeekInFlight) this.applyScrubSeekTarget()
    }

    private applyScrubSeekTarget(): void {
        if (this.destroyed || !isFiniteDuration(this.videoEl) || this.scrubSeekTarget === null) return
        const targetTime = this.scrubSeekTarget
        const lastAppliedTime = this.scrubAppliedTime ?? this.videoEl.currentTime
        if (Math.abs(lastAppliedTime - targetTime) < 0.001) return

        this.cancelScrubSeek()
        this.scrubSeekInFlight = true
        let settled = false
        let nextSeekTimerId: number | null = null
        let failSafeTimerId: number | null = null

        const cleanup = () => {
            this.videoEl.removeEventListener('seeked', finishSeek)
            this.videoEl.removeEventListener('loadeddata', finishSeek)
            if (nextSeekTimerId !== null) {
                window.clearTimeout(nextSeekTimerId)
                nextSeekTimerId = null
            }
            if (failSafeTimerId !== null) {
                window.clearTimeout(failSafeTimerId)
                failSafeTimerId = null
            }
            if (this.scrubSeekCleanup === cleanup) this.scrubSeekCleanup = null
        }

        const finishSeek = () => {
            if (settled) return
            settled = true
            cleanup()
            nextSeekTimerId = window.setTimeout(() => {
                nextSeekTimerId = null
                this.scrubSeekInFlight = false
                if (this.destroyed || this.scrubSeekTarget === null) return
                const appliedTime = this.scrubAppliedTime ?? this.videoEl.currentTime
                if (Math.abs(appliedTime - this.scrubSeekTarget) >= 0.001) this.applyScrubSeekTarget()
                else this.render()
            }, 0)
            this.scrubSeekCleanup = cleanup
        }

        this.videoEl.addEventListener('seeked', finishSeek)
        this.videoEl.addEventListener('loadeddata', finishSeek)
        failSafeTimerId = window.setTimeout(finishSeek, 500)
        this.scrubSeekCleanup = cleanup

        try {
            this.videoEl.currentTime = targetTime
            this.scrubAppliedTime = targetTime
        } catch {
            cleanup()
            this.scrubSeekInFlight = false
            this.scrubSeekTarget = null
            this.scrubAppliedTime = null
        }
    }

    private cancelScrubSeek(): void {
        this.scrubSeekCleanup?.()
        this.scrubSeekCleanup = null
        this.scrubSeekInFlight = false
    }

    private finishScrubAfterSeek(): void {
        this.scrubPreviewTime = null
        this.scrubSeekTarget = null
        this.scrubAppliedTime = null
        const shouldResume = this.scrubResumeOnRelease
        this.scrubResumeOnRelease = false
        if (shouldResume && !this.destroyed) {
            this.videoEl.play().catch((error) => {
                console.warn('[videoControls] resume after seek failed', error)
            })
        }
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
        bindButtonAction(this.volumeButton, () => {
            this.videoEl.muted = !this.videoEl.muted
            if (!this.videoEl.muted && this.videoEl.volume === 0) this.videoEl.volume = 0.5
            this.render()
        })
        bindButtonAction(this.fullscreenButton, () => { void this.toggleFullscreen() })
    }

    private bindSpeedSlider(): void {
        this.speedGroup
            .on('dblclick', (event: MouseEvent) => {
                event.preventDefault()
                event.stopPropagation()
                this.resetSpeedToDefault()
            })
            .on('keydown', (event: KeyboardEvent) => {
                const { keyboardStep, minRate, maxRate } = settings.videoControls.speed
                const currentRate = clamp(this.videoEl.playbackRate || 1, minRate, maxRate)
                let nextRate: number | null = null
                if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextRate = currentRate - keyboardStep
                if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextRate = currentRate + keyboardStep
                if (event.key === 'Home') nextRate = minRate
                if (event.key === 'End') nextRate = maxRate
                if (nextRate === null) return

                event.preventDefault()
                event.stopPropagation()
                this.videoEl.playbackRate = clamp(roundToStep(nextRate, keyboardStep), minRate, maxRate)
                this.render()
            })
    }

    private addMediaListeners(): void {
        for (const eventName of MEDIA_EVENTS) {
            this.videoEl.addEventListener(eventName, this.onMediaEvent)
        }
        document.addEventListener('fullscreenchange', this.onMediaEvent)
    }

    private readonly onMediaEvent = (): void => {
        this.render()
    }
}

export function createVideoControls(parent: any, config: VideoControlsConfig): VideoControlsInstance {
    return new VideoControls(parent, config)
}
