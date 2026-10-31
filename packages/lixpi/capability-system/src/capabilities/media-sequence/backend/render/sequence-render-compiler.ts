import {
    type MediaSequence,
    type SequenceClip,
    type SequenceExportDefaults,
    type SequenceKeyframe,
    type SequenceSourceBinding,
} from '../../shared/media-sequence.ts'
import {
    assertMediaSequence,
    assertSequenceSource,
} from '../../shared/sequence-validation.ts'
import {
    convertTicks,
    ticksToSeconds,
} from '../../shared/sequence-time.ts'
import {
    type MediaRenderCompilerPort,
    type MediaRenderLimits,
    type MediaRenderPlan,
} from './render-contract.ts'

const fonts = {
    sans: '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    serif: '/usr/share/fonts/dejavu/DejaVuSerif.ttf',
    mono: '/usr/share/fonts/dejavu/DejaVuSansMono.ttf',
}

const decimal = (value: number): string => {
    if (!Number.isFinite(value))
        throw new Error('MEDIA_RENDER_INVALID_NUMBER')

    return value.toFixed(9).replace(/\.?0+$/, '') || '0'
}

const atempo = (rate: number): string[] => {
    const filters: string[] = []

    while (rate > 2) {
        filters.push('atempo=2')
        rate /= 2
    }

    while (rate < 0.5) {
        filters.push('atempo=0.5')
        rate *= 2
    }

    filters.push(`atempo=${decimal(rate)}`)

    return filters
}

const validatePreset = (value: unknown): SequenceExportDefaults => {
    const preset = value as SequenceExportDefaults

    if (
        !preset
        || !['mp4-h264-aac', 'wav-pcm', 'mp3'].includes(preset.presetId)
        || !['draft', 'standard', 'high'].includes(preset.quality)
    )
        throw new Error('MEDIA_RENDER_INVALID_PRESET')

    for (const [name, maximum] of [
        ['videoBitrateKbps', 100000],
        ['audioBitrateKbps', 320],
    ] as const) {
        const bitrate = preset[name]

        if (
            bitrate !== undefined
            && (!Number.isSafeInteger(bitrate) || bitrate < 32 || bitrate > maximum)
        )
            throw new Error('MEDIA_RENDER_INVALID_BITRATE')
    }

    return {
        presetId: preset.presetId,
        quality: preset.quality,
        ...(preset.videoBitrateKbps !== undefined ? { videoBitrateKbps: preset.videoBitrateKbps } : {}),
        ...(preset.audioBitrateKbps !== undefined ? { audioBitrateKbps: preset.audioBitrateKbps } : {}),
    }
}

export class MediaSequenceRenderCompiler implements MediaRenderCompilerPort {
    validateSource(source: unknown): SequenceSourceBinding {
        assertSequenceSource(source as SequenceSourceBinding)

        return structuredClone(source) as SequenceSourceBinding
    }

    compile(
        value: unknown,
        requestedPreset: unknown,
        limits: MediaRenderLimits,
    ): MediaRenderPlan {
        assertMediaSequence(value)
        const sequence = value as MediaSequence
        const preset = validatePreset(requestedPreset ?? sequence.exportDefaults)
        const duration = ticksToSeconds(sequence.duration, sequence.timeBase)
        const fps = sequence.frameRate.numerator / sequence.frameRate.denominator

        if (
            duration <= 0
            || duration > limits.maxDurationSeconds
            || sequence.width * sequence.height > limits.maxPixels
            || fps > limits.maxFps
            || sequence.clips.length > 1024
            || sequence.tracks.length > 64
            || sequence.sources.length > 256
            || sequence.clips.some(clip => (clip.text?.content.length ?? 0) > 65536 || clip.keyframes.length > 256)
        )
            throw new Error('MEDIA_RENDER_RESOURCE_LIMIT')

        if (
            preset.presetId === 'mp4-h264-aac'
            && (sequence.width % 2 !== 0 || sequence.height % 2 !== 0)
        )
            throw new Error('MEDIA_RENDER_H264_REQUIRES_EVEN_DIMENSIONS')

        const video = preset.presetId === 'mp4-h264-aac'
        const videoBitrate = preset.videoBitrateKbps ?? {
            draft: 8000,
            standard: 20000,
            high: 40000,
        }[preset.quality]
        const solo = sequence.tracks.some(track => track.solo)
        const clips = sequence.tracks.flatMap(
            track => sequence.clips.filter(clip => clip.trackId === track.trackId && (!solo || track.solo))
                .sort((left, right) => left.start - right.start).map(
                clip => ({
                    clip,
                    track,
                }),
            ),
        )
        const usedSources = new Set(
            clips.filter(
                ({
                    clip,
                    track,
                }) => clip.sourceId && ((video && track.visible && track.kind === 'video') || (!track.muted && !clip.audio.muted)),
            ).map(({ clip }) => clip.sourceId),
        )
        const inputs = sequence.sources.filter(source => usedSources.has(source.sourceId)).map(
            (source, index) => ({
                ...source,
                filename: `input-${index}`,
            }),
        )
        const resources: MediaRenderPlan['resources'] = []
        const args = ['-hide_banner', '-nostdin', '-y', '-max_alloc', '268435456', '-threads', '1', '-filter_complex_threads', '1']

        for (const source of inputs) {
            args.push(
                '-protocol_whitelist',
                'file,pipe',
                '-format_whitelist',
                'mov,matroska,webm,avi,mp3,wav,flac,ogg,aac,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,tiff_pipe,gif,image2',
            )

            if (source.kind === 'image')
                args.push(
                    '-loop',
                    '1',
                    '-framerate',
                    `${sequence.frameRate.numerator}/${sequence.frameRate.denominator}`,
                )

            args.push('-i', source.filename)
        }

        const graph: string[] = []
        const rate = `${sequence.frameRate.numerator}/${sequence.frameRate.denominator}`
        const seconds = decimal(duration)

        if (video)
            graph.push(`color=c=black:s=${sequence.width}x${sequence.height}:r=${rate}:d=${seconds},format=rgba[base0]`)

        graph.push(`anullsrc=r=${sequence.audioSampleRate}:cl=stereo,atrim=duration=${seconds}[silence]`)
        const audioLabels = ['[silence]']
        let visualCount = 0

        for (const [index, {
            clip,
            track,
        }] of clips.entries()) {
            const sourceIndex = inputs.findIndex(source => source.sourceId === clip.sourceId)
            const source = inputs[sourceIndex]
            const start = ticksToSeconds(clip.start, sequence.timeBase)
            const length = ticksToSeconds(clip.duration, sequence.timeBase)
            const speed = clip.rate.numerator / clip.rate.denominator
            const sourceIn = source ? ticksToSeconds(clip.sourceIn, source.timeBase) : 0
            const sourceOut = source
                && source.kind !== 'image'
                ? ticksToSeconds(clip.sourceOut, source.timeBase)
                : length * speed
            const expression = (
                property: SequenceKeyframe['property'],
                initial: number,
                time = 't',
            ): string => this.expression(
                sequence,
                clip,
                property,
                initial,
                time,
            )

            if (
                video
                && track.visible
                && track.kind !== 'audio'
            ) {
                let input: string

                if (
                    track.kind === 'text'
                    && clip.text
                ) {
                    if (/\0/u.test(clip.text.content))
                        throw new Error('MEDIA_RENDER_INVALID_TEXT')

                    const alignment = {
                        left: '0',
                        center: '(w-text_w)/2',
                        right: 'w-text_w',
                    }[clip.text.align]
                    const lines = clip.text.content.split('\n').map((line, lineIndex) => {
                        const filename = `text-${index}-${lineIndex}.txt`
                        resources.push({
                            filename,
                            content: line,
                        })

                        return `drawtext=fontfile='${fonts[clip.text!.fontFamily]}':textfile='${filename}':expansion=none:fontcolor=${clip.text!.color}:fontsize=${clip.text!.fontSize}:x=${alignment}:y=${decimal(
                            lineIndex * clip.text!.fontSize * 1.2,
                        )}:y_align=font`
                    })
                    input = `color=c=black@0:s=${sequence.width}x${sequence.height}:r=${rate}:d=${decimal(length)},format=rgba,${lines.join(',')}`
                } else if (
                    source
                    && source.kind !== 'audio'
                )
                    input = `[${sourceIndex}:v]trim=start=${decimal(sourceIn)}:end=${decimal(sourceOut)},setpts=(PTS-STARTPTS)/${decimal(speed)},fps=${rate},setsar=1,format=rgba`
                else
                    throw new Error('MEDIA_RENDER_MISSING_VISUAL_SOURCE')

                const crop = clip.transform.crop
                const cropWidth = (source?.width ?? sequence.width) - crop.left - crop.right
                const cropHeight = (source?.height ?? sequence.height) - crop.top - crop.bottom

                if (
                    cropWidth <= 0
                    || cropHeight <= 0
                )
                    throw new Error('MEDIA_RENDER_INVALID_CROP')

                const maxScaleX = Math.max(
                    clip.transform.scaleX,
                    ...clip.keyframes.filter(frame => frame.property === 'scaleX').map(frame => frame.value),
                )
                const maxScaleY = Math.max(
                    clip.transform.scaleY,
                    ...clip.keyframes.filter(frame => frame.property === 'scaleY').map(frame => frame.value),
                )

                if (
                    cropWidth * maxScaleX * cropHeight * maxScaleY > limits.maxPixels
                    || (source?.width ?? 0) * (source?.height ?? 0) > limits.maxPixels
                    || clip.keyframes.some(frame => Math.abs(frame.value) > 1000000)
                    || [clip.transform.x, clip.transform.y, clip.transform.rotation].some(value => Math.abs(value) > 1000000)
                )
                    throw new Error('MEDIA_RENDER_RESOURCE_LIMIT')

                const opacity = expression(
                    'opacity',
                    clip.transform.opacity,
                    'T',
                )
                const transition = this.transitionEnvelope(
                    sequence,
                    clip,
                    'T',
                    false,
                )
                const rotation = expression('rotation', clip.transform.rotation)
                const rotates = clip.transform.rotation !== 0 || clip.keyframes.some(frame => frame.property === 'rotation')
                const rotate = rotates ? `,rotate=angle='(${rotation})*PI/180':ow='hypot(iw,ih)':oh='hypot(iw,ih)':c=none` : ''
                const transformed = `${input},crop=${decimal(cropWidth)}:${decimal(cropHeight)}:${decimal(crop.left)}:${decimal(crop.top)},scale=w='max(1,round(${decimal(cropWidth)}*(${expression(
                    'scaleX',
                    clip.transform.scaleX,
                )})))':h='max(1,round(${decimal(cropHeight)}*(${expression('scaleY', clip.transform.scaleY)})))':eval=frame${rotate},geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${opacity})*(${transition})',setpts=PTS-STARTPTS+${decimal(start)}/TB[v${index}]`
                graph.push(transformed)
                const localTime = `(t-${decimal(start)})`
                const x = `${expression(
                    'x',
                    clip.transform.x,
                    localTime,
                )}${rotates ? `+(${decimal(cropWidth)}*(${expression(
                    'scaleX',
                    clip.transform.scaleX,
                    localTime,
                )})-overlay_w)/2` : ''}`
                const y = `${expression(
                    'y',
                    clip.transform.y,
                    localTime,
                )}${rotates ? `+(${decimal(cropHeight)}*(${expression(
                    'scaleY',
                    clip.transform.scaleY,
                    localTime,
                )})-overlay_h)/2` : ''}`
                graph.push(
                    `[base${visualCount}][v${index}]overlay=x='${x}':y='${y}':eof_action=pass:repeatlast=0:enable='gte(t,${decimal(start)})*lt(t,${decimal(
                        start + length,
                    )})':format=auto[base${visualCount + 1}]`,
                )
                visualCount++
            }

            if (
                source
                && !track.muted
                && !clip.audio.muted
                && (source.kind === 'audio' || source.hasAudio)
            ) {
                const gain = expression('gain', clip.audio.gain)
                const pan = expression('pan', clip.audio.pan)
                const envelope = this.transitionEnvelope(
                    sequence,
                    clip,
                    't',
                    true,
                )
                const left = `val(0)*(${gain})*sqrt(1-max(0,${pan}))*(${envelope})`
                const right = `val(1)*(${gain})*sqrt(1+min(0,${pan}))*(${envelope})`
                const channels = source.channels === 1 ? 'pan=stereo|c0=c0|c1=c0,' : ''
                const delay = convertTicks(
                    clip.start,
                    sequence.timeBase,
                    {
                        numerator: 1,
                        denominator: sequence.audioSampleRate,
                    },
                    'nearest',
                )
                graph.push(
                    `[${sourceIndex}:a]atrim=start=${decimal(sourceIn)}:end=${decimal(sourceOut)},asetpts=PTS-STARTPTS,${atempo(speed).join(',')},${channels}aformat=sample_fmts=fltp:sample_rates=${sequence.audioSampleRate}:channel_layouts=stereo,atrim=duration=${decimal(length)},aeval=exprs='${left}|${right}':c=stereo,adelay=${delay}S:all=1[a${index}]`,
                )
                audioLabels.push(`[a${index}]`)
            }
        }

        graph.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,atrim=duration=${seconds}[aout]`)

        if (video)
            graph.push(`[base${visualCount}]format=yuv420p[vout]`)

        args.push(
            '-filter_complex',
            graph.join(';'),
        )
        let outputFilename: string
        let mimeType: MediaRenderPlan['mimeType']

        if (video) {
            outputFilename = 'output.mp4'
            mimeType = 'video/mp4'
            args.push(
                '-map',
                '[vout]',
                '-map',
                '[aout]',
                '-c:v',
                'libx264',
                '-preset',
                'fast',
                '-crf',
                {
                    draft: '28',
                    standard: '23',
                    high: '18',
                }[preset.quality],
                '-pix_fmt',
                'yuv420p',
                '-c:a',
                'aac',
                '-b:a',
                `${preset.audioBitrateKbps ?? 192}k`,
                '-movflags',
                '+faststart',
            )
            args.push(
                '-maxrate',
                `${videoBitrate}k`,
                '-bufsize',
                `${videoBitrate * 2}k`,
            )
        } else if (preset.presetId === 'wav-pcm') {
            outputFilename = 'output.wav'
            mimeType = 'audio/wav'
            args.push(
                '-map',
                '[aout]',
                '-c:a',
                'pcm_s16le',
            )
        } else {
            outputFilename = 'output.mp3'
            mimeType = 'audio/mpeg'
            args.push(
                '-map',
                '[aout]',
                '-c:a',
                'libmp3lame',
                '-b:a',
                `${preset.audioBitrateKbps ?? 192}k`,
            )
        }

        args.push(
            '-threads',
            '1',
            '-ar',
            String(sequence.audioSampleRate),
            '-ac',
            '2',
            '-t',
            seconds,
            '-progress',
            'pipe:1',
            '-nostats',
            outputFilename,
        )
        const outputAllowance = video
            ? duration * (videoBitrate + 320) * 125
            : duration * sequence.audioSampleRate * 4
        const estimatedDiskBytes = Math.ceil(inputs.reduce((sum, source) => sum + source.byteSize, 0) + outputAllowance + 32 * 1024 * 1024)

        if (
            inputs.some(source => source.byteSize > limits.maxBufferedBytes)
            || outputAllowance > limits.maxBufferedBytes
        )
            throw new Error('MEDIA_RENDER_BUFFER_LIMIT')

        if (
            !Number.isSafeInteger(estimatedDiskBytes)
            || estimatedDiskBytes > limits.tempLimitBytes
        )
            throw new Error('MEDIA_RENDER_DISK_LIMIT')

        return {
            sequenceId: sequence.sequenceId,
            sequenceRevision: sequence.revision,
            preset,
            inputs,
            resources,
            arguments: args,
            outputFilename,
            mimeType,
            durationSeconds: duration,
            ...(video ? {
                width: sequence.width,
                height: sequence.height,
                frameRate: { ...sequence.frameRate },
            } : {}),
            sampleRate: sequence.audioSampleRate,
            estimatedDiskBytes,
        }
    }

    private expression(
        sequence: MediaSequence,
        clip: SequenceClip,
        property: SequenceKeyframe['property'],
        initial: number,
        time: string,
    ): string {
        const points = clip.keyframes.filter(frame => frame.property === property).sort((left, right) => left.time - right.time)

        if (points.length === 0)
            return decimal(initial)

        const first = points[0]

        if (first.time !== 0)
            points.unshift({
                ...first,
                time: 0,
                value: initial,
                interpolation: 'linear',
            })

        let result = decimal(points.at(-1)!.value)

        for (let index = points.length - 2; index >= 0; index--) {
            const current = points[index]
            const next = points[index + 1]
            const start = ticksToSeconds(current.time, sequence.timeBase)
            const end = ticksToSeconds(next.time, sequence.timeBase)
            const segment = current.interpolation === 'hold' ? decimal(current.value)
                : `(${decimal(current.value)}+(${decimal(next.value - current.value)})*(${time}-${decimal(start)})/${decimal(end - start)})`
            result = `if(lt(${time},${decimal(end)}),${segment},${result})`
        }

        return result
    }

    private transitionEnvelope(
        sequence: MediaSequence,
        clip: SequenceClip,
        time: string,
        audio: boolean,
    ): string {
        const length = ticksToSeconds(clip.duration, sequence.timeBase)
        const factors = sequence.transitions.flatMap(transition => {
            const duration = ticksToSeconds(transition.duration, sequence.timeBase)

            if (
                (transition.kind === 'fade-in' && transition.clipId === clip.clipId)
                || (transition.kind === 'cross-dissolve' && transition.otherClipId === clip.clipId)
            )
                return [`min(1,max(0,${time}/${decimal(duration)}))`]

            if (
                transition.clipId === clip.clipId
                && (transition.kind === 'fade-out' || (audio && transition.kind === 'cross-dissolve'))
            )
                return [`min(1,max(0,(${decimal(length)}-${time})/${decimal(duration)}))`]

            return []
        })

        return factors.length ? factors.join('*') : '1'
    }
}
