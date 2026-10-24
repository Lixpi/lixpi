// Demo media for components that need real image, video or audio sources. The
// files are generated in the browser from the UI-primitives gradient renderers,
// so the design system ships no binary fixtures and needs no media service.
// Every generated object URL belongs to the instance and is revoked on destroy.

import { html } from '@lixpi/ui-primitives/dom'
import {
    FreeformGradientRenderer,
    ShiftingGradientRenderer,
    type FreeformGradientHexColorSet,
} from '@lixpi/ui-primitives/gradients'

export type DemoImageConfig = {
    colors: FreeformGradientHexColorSet
    height: number
    phase?: number
    width: number
}

export const DEMO_PALETTES = {
    dawn: ['#f6c7b3', '#c3dedd', '#dcece9', '#82b2c0'],
    dusk: ['#42494f', '#5d656d', '#a55324', '#f5f3f3'],
    sage: ['#dfe7dc', '#b9c9b4', '#8fa58b', '#f4f1ea'],
    violet: ['#6d4fb2', '#c3b1f0', '#3d649c', '#f3e4f2'],
} as const satisfies Record<string, FreeformGradientHexColorSet>

const VIDEO_DURATION_MS = 4000
const VIDEO_PHASE_INTERVAL_MS = 600
const AUDIO_SAMPLE_RATE = 22050
const AUDIO_DURATION_SECONDS = 2

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise(
    (resolve, reject) => canvas.toBlob(
        blob => blob ? resolve(blob) : reject(
            new Error('Canvas could not be encoded'),
        ),
        'image/png',
    ),
)

// A 16-bit mono WAV file with a short two-note tone.
const encodeToneWav = (): Blob => {
    const sampleCount = AUDIO_SAMPLE_RATE * AUDIO_DURATION_SECONDS
    const buffer = new ArrayBuffer(44 + sampleCount * 2)
    const view = new DataView(buffer)
    const writeText = (
        offset: number,
        text: string,
    ): void => {
        for (let index = 0; index < text.length; index++)
            view.setUint8(
                offset + index,
                text.charCodeAt(index),
            )
    }

    writeText(0, 'RIFF')
    view.setUint32(
        4,
        36 + sampleCount * 2,
        true,
    )
    writeText(8, 'WAVE')
    writeText(12, 'fmt ')
    view.setUint32(
        16,
        16,
        true,
    )
    view.setUint16(
        20,
        1,
        true,
    )
    view.setUint16(
        22,
        1,
        true,
    )
    view.setUint32(
        24,
        AUDIO_SAMPLE_RATE,
        true,
    )
    view.setUint32(
        28,
        AUDIO_SAMPLE_RATE * 2,
        true,
    )
    view.setUint16(
        32,
        2,
        true,
    )
    view.setUint16(
        34,
        16,
        true,
    )
    writeText(36, 'data')
    view.setUint32(
        40,
        sampleCount * 2,
        true,
    )

    for (let index = 0; index < sampleCount; index++) {
        const time = index / AUDIO_SAMPLE_RATE
        const frequency = time < AUDIO_DURATION_SECONDS / 2 ? 440 : 660
        const envelope = Math.min(
            1,
            time * 8,
            (AUDIO_DURATION_SECONDS - time) * 8,
        )
        const sample = Math.sin(2 * Math.PI * frequency * time) * envelope * 0.3
        view.setInt16(
            44 + index * 2,
            sample * 0x7fff,
            true,
        )
    }

    return new Blob([buffer], { type: 'audio/wav' })
}

export class DemoMedia {
    private readonly urls = new Set<string>()
    private video: Promise<string> | null = null
    private destroyed = false

    // Paints a freeform gradient bitmap at one of its phase positions.
    createImageCanvas(config: DemoImageConfig): HTMLCanvasElement {
        const bitmap = html`
            <canvas
                width=${FreeformGradientRenderer.bitmapSize.width}
                height=${FreeformGradientRenderer.bitmapSize.height}
            ></canvas>
        ` as HTMLCanvasElement
        FreeformGradientRenderer.drawBitmap(
            bitmap.getContext('2d')!,
            FreeformGradientRenderer.bitmapSize,
            FreeformGradientRenderer.parseHexColors(config.colors),
            FreeformGradientRenderer.getPhasePositions(config.phase ?? FreeformGradientRenderer.initialPhase),
        )
        const canvas = html`
            <canvas
                width=${config.width}
                height=${config.height}
            ></canvas>
        ` as HTMLCanvasElement
        const context = canvas.getContext('2d')!
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.drawImage(
            bitmap,
            0,
            0,
            config.width,
            config.height,
        )

        return canvas
    }

    async image(config: DemoImageConfig): Promise<string> {
        return this.own(
            await toBlob(
                this.createImageCanvas(config),
            ),
        )
    }

    // Records the shifting gradient advancing through its phases.
    videoUrl(): Promise<string> {
        this.video ??= this.recordVideo()

        return this.video
    }

    audioUrl(): string {
        return this.own(
            encodeToneWav(),
        )
    }

    // Product mockups and illustrations ship as SVG markup.
    svgUrl(markup: string): string {
        return `data:image/svg+xml,${encodeURIComponent(markup)}`
    }

    destroy(): void {
        this.destroyed = true

        for (const url of this.urls)
            URL.revokeObjectURL(url)

        this.urls.clear()
    }

    private own(blob: Blob): string {
        const url = URL.createObjectURL(blob)

        if (this.destroyed)
            URL.revokeObjectURL(url)
        else
            this.urls.add(url)

        return url
    }

    private async recordVideo(): Promise<string> {
        const canvas = html`
            <canvas
                width="640"
                height="360"
            ></canvas>
        ` as HTMLCanvasElement
        const renderer = new ShiftingGradientRenderer([...DEMO_PALETTES.violet])
        renderer.subscribe(canvas)
        const mimeType = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type)) ?? ''
        const recorder = new MediaRecorder(
            canvas.captureStream(30),
            mimeType ? { mimeType } : undefined,
        )
        const chunks: Blob[] = []
        recorder.addEventListener('dataavailable', event => chunks.push(event.data))
        const stopped = new Promise<void>(resolve => recorder.addEventListener('stop', () => resolve()))
        const phaseTimer = setInterval(() => renderer.nextPhase(), VIDEO_PHASE_INTERVAL_MS)
        recorder.start()
        await new Promise(resolve => setTimeout(resolve, VIDEO_DURATION_MS))
        recorder.stop()
        await stopped
        clearInterval(phaseTimer)
        renderer.destroy()

        return this.own(
            new Blob(chunks, { type: recorder.mimeType || 'video/webm' }),
        )
    }
}

// MediaRecorder output carries no duration, so each element that plays the
// recorded clip reports an infinite one until it has read to the end once.
// Seeking past the end makes the element measure it, then playback returns to
// the start. Hosts call this for every element they give the clip to.
export const settleRecordedVideoDuration = (video: HTMLVideoElement): void => {
    const settle = (): void => {
        if (Number.isFinite(video.duration))
            return

        video.addEventListener(
            'durationchange',
            () => void (video.currentTime = 0),
            { once: true },
        )
        video.currentTime = Number.MAX_SAFE_INTEGER
    }

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA)
        settle()
    else
        video.addEventListener(
            'loadedmetadata',
            settle,
            { once: true },
        )
}
