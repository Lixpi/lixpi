import sharp from 'sharp'
import {
    warn,
    err,
} from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'

import { parseDataUrl } from '../../../llm/utils/attachments.ts'
import {
    type ProviderState,
} from '../../../llm/graph/state.ts'
import {
    type StyleExtractionDependencies,
    type StyleExtractionState,
    type StyleRecommendedSampleSubject,
    type StyleSampleRef,
    type StageLogger,
} from './types.ts'
import BlobModel from '../../../models/blob.ts'

const ANTI_LEAKAGE_INSTRUCTION = 'Render only the content-neutral probe declared by the style brief, using the transferable visual traits evidenced by the attached source crops. Treat every crop as visual-treatment evidence only. Do not reproduce or infer any subject, identity, pose, layout, composition, setting, or narrative content visible in a crop. Apply the evidenced treatment to the probe itself rather than adding source-derived content or a decorative backdrop.'

// Fetches source-crop bytes from the organization Blob registry for composite
// builders and image-router calls.
const fetchSourceCropBytes = async (
    organizationId: string,
    sample: StyleSampleRef,
): Promise<Buffer | undefined> => {
    if (
        sample.kind !== 'source-crop'
        || !sample.blobHash
    )
        return undefined

    if (sample.imageUrl?.startsWith('data:')) {
        try {
            return Buffer.from(parseDataUrl(sample.imageUrl).base64, 'base64')
        } catch {
            return undefined
        }
    }

    const nats = NATS_Service.getInstance()

    if (!nats)
        return undefined

    try {
        const blob = await BlobModel.get({
            organizationId,
            blobHash: sample.blobHash,
        })

        if (!blob)
            return undefined

        const data = await nats.getObject(blob.bucketName, blob.objectKey)

        return data ? Buffer.from(data) : undefined
    } catch (e) {
        warn(`Failed to fetch source-crop bytes ${sample.blobHash}: ${e instanceof Error ? e.message : String(e)}`)

        return undefined
    }
}

// Deterministic palette board: vertical stack of color swatches with hex labels.
// Used for color-palette styles. Reads parameters.axes.palette.fields.palette[].
const buildPaletteBoard = async (state: StyleExtractionState): Promise<Buffer> => {
    const palette = (state.draft?.parameters as any)?.axes?.palette?.fields?.palette ?? []

    if (
        !Array.isArray(palette)
        || palette.length === 0
    ) {
        // Fallback: 1024x1024 white image with text label
        return await sharp({ create: {
            width: 1024,
            height: 1024,
            channels: 3,
            background: '#ffffff',
        } }).png().toBuffer()
    }

    const width = 1536
    const height = 1024
    const rows = palette.length
    const rowHeight = Math.floor(height / rows)
    const overlays: sharp.OverlayOptions[] = []
    const escapeXml = (s: string) =>
        String(s ?? '').replace(
            /[<>&"]/g,
            c => ({
                '<': '&lt;',
                '>': '&gt;',
                '&': '&amp;',
                '"': '&quot;',
            }[c]!),
        )

    for (let i = 0; i < rows; i++) {
        const entry = palette[i] ?? {}
        const hex = String(entry.hex ?? '#888888').replace(/^#?/, '#')
        const name = escapeXml(entry.name ?? '')
        const role = escapeXml(entry.role ?? '')
        const usage = String(entry.usage ?? '')
        const swatchSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${rowHeight}"><rect width="${width}" height="${rowHeight}" fill="${hex}"/><rect x="40" y="${Math.floor(
            rowHeight * 0.2,
        )}" width="${Math.floor(width * 0.55)}" height="${Math.floor(rowHeight * 0.6)}" fill="${hex}" stroke="#1a2744" stroke-width="2"/><text x="${Math.floor(
            width * 0.62,
        )}" y="${Math.floor(rowHeight * 0.5)}" font-family="sans-serif" font-size="${Math.floor(rowHeight * 0.22)}" fill="#1a2744">${name}  ${hex}  •  ${role}  •  ${usage}%</text></svg>`
        overlays.push({
            input: Buffer.from(swatchSvg),
            top: i * rowHeight,
            left: 0,
        })
    }

    return await sharp({ create: {
        width,
        height,
        channels: 3,
        background: '#ffffff',
    } })
        .composite(overlays)
        .png()
        .toBuffer()
}

// Deterministic texture specimen: 2x2 composite of the first 4 source crops.
// Used for surface-texture-dominant styles.
const buildTextureSpecimen = async (state: StyleExtractionState): Promise<Buffer> => {
    const crops = state.sourceCrops.slice(0, 4)

    if (crops.length < 1)
        return await sharp({ create: {
            width: 1024,
            height: 1024,
            channels: 3,
            background: '#ffffff',
        } })
            .png()
            .toBuffer()

    const cellSize = 512
    const tileBytes: Buffer[] = []

    if (!state.input.organizationId)
        throw new Error('Organization context required for source-crop Blob storage')

    for (const crop of crops) {
        const bytes = await fetchSourceCropBytes(state.input.organizationId, crop)

        if (!bytes)
            continue

        const resized = await sharp(bytes).resize({
            width: cellSize,
            height: cellSize,
            fit: 'cover',
        }).png().toBuffer()
        tileBytes.push(resized)
    }

    // Pad up to 4 cells with neutral grey when fewer crops are available.
    while (tileBytes.length < 4) {
        tileBytes.push(await sharp({ create: {
            width: cellSize,
            height: cellSize,
            channels: 3,
            background: '#cccccc',
        } }).png().toBuffer())
    }

    const composed = await sharp({ create: {
        width: cellSize * 2,
        height: cellSize * 2,
        channels: 3,
        background: '#ffffff',
    } })
        .composite([
            {
                input: tileBytes[0]!,
                top: 0,
                left: 0,
            },
            {
                input: tileBytes[1]!,
                top: 0,
                left: cellSize,
            },
            {
                input: tileBytes[2]!,
                top: cellSize,
                left: 0,
            },
            {
                input: tileBytes[3]!,
                top: cellSize,
                left: cellSize,
            },
        ])
        .png()
        .toBuffer()

    return composed
}

// Calls the image router via deps.runImageRouter with source crops attached as
// visual style references and the strict anti-leakage instruction prefixed.
const renderAppliedMediumProbe = async (args: {
    state: StyleExtractionState
    subject: StyleRecommendedSampleSubject
    deps: StyleExtractionDependencies
}): Promise<Buffer | undefined> => {
    const {
        state,
        subject,
        deps,
    } = args

    if (
        !state.input.imageProvider
        || !state.input.imageModel
    ) {
        warn('Skipping applied-medium-probe — no image model configured on the extraction request')

        return undefined
    }

    const briefText = [
        ANTI_LEAKAGE_INSTRUCTION,
        '',
        'STYLE BRIEF (synthesis output):',
        `Category: ${state.draft?.category ?? ''}`,
        `Name: ${state.draft?.name ?? ''}`,
        `Summary: ${state.draft?.summary ?? ''}`,
        '',
        'Instructions:',
        state.draft?.instructions ?? '',
        '',
        'CONTENT-NEUTRAL PROBE TO RENDER:',
        subject.prompt,
    ].join('\n')

    // Attach source crops as visual references. The image router converts our
    // ChatMessage `input_image` blocks into provider-specific multimodal input.
    const referenceImages: string[] = state.sourceCrops.filter(c => c.kind === 'source-crop' && c.imageUrl)
        .slice(0, 4).map(c => c.imageUrl!)

    const syntheticState: ProviderState = {
        messages: [{
            role: 'user',
            content: briefText,
        }],
        aiModelMetaInfo: state.input.imageModel,
        eventMeta: {
            userId: state.input.userId,
            workspaceId: state.input.workspaceId,
            organizationId: state.input.organizationId,
            aiChatThreadId: state.input.styleExtractionRunId,
        },
        workspaceId: state.input.workspaceId,
        aiChatThreadId: state.input.styleExtractionRunId,
        instanceKey: `${state.input.workspaceId}:${state.input.styleExtractionRunId}:sample`,
        provider: state.input.imageProvider,
        modelVersion: state.input.imageModel.modelVersion,
        temperature: 0.7,
        streamActive: false,
        aiRequestReceivedAt: Date.now(),
        enableImageGeneration: true,
        imageSize: subject.aspectRatio || 'auto',
        imageModelMetaInfo: state.input.imageModel,
        imageModelVersion: state.input.imageModel.modelVersion,
        imageProviderName: state.input.imageProvider,
        imagePromptRetryCount: 0,
        generatedImagePrompt: briefText,
        referenceImages,
    }

    const result = await deps.runImageRouter(syntheticState)
    const dataUrl = result.generatedImages?.[0]

    if (!dataUrl)
        return undefined

    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')

    return Buffer.from(base64, 'base64')
}

const detectExt = (buffer: Buffer): 'png' | 'jpg' => {
    if (
        buffer.length > 8
        && buffer[0] === 0x89
        && buffer[1] === 0x50
    )
        return 'png'

    if (
        buffer.length > 2
        && buffer[0] === 0xff
        && buffer[1] === 0xd8
    )
        return 'jpg'

    return 'png'
}

export const generateSamples = async (
    state: StyleExtractionState,
    logger: StageLogger,
    deps: StyleExtractionDependencies,
): Promise<Partial<StyleExtractionState>> => {
    return await logger.span(
        'samples',
        undefined,
        async () => {
            const subjects = state.draft?.recommendedSampleSubjects ?? []

            if (subjects.length === 0)
                return { samples: [] }

            const results = await Promise.allSettled(
                subjects.map(
                    (subject, idx) =>
                        logger.span(
                            `sample:${idx}`,
                            subject.kind === 'applied-medium-probe' ? (state.input.imageModel?.modelVersion ?? 'image-router') : 'sharp',
                            async () => {
                                let buffer: Buffer | undefined

                                if (subject.kind === 'palette-board')
                                    buffer = await buildPaletteBoard(state)
                                else if (subject.kind === 'texture-specimen')
                                    buffer = await buildTextureSpecimen(state)
                                else if (subject.kind === 'applied-medium-probe')
                                    buffer = await renderAppliedMediumProbe({
                                        state,
                                        subject,
                                        deps,
                                    })
                                else {
                                    warn(`Unknown sample kind: ${subject.kind}`)

                                    return undefined
                                }

                                if (!buffer)
                                    throw new Error(`Sample ${idx} (${subject.kind}) produced no bytes`)

                                const ext = detectExt(buffer)

                                if (!state.input.organizationId)
                                    throw new Error('Organization context required for sample Blob storage')

                                const stored = await BlobModel.store({
                                    organizationId: state.input.organizationId,
                                    bytes: buffer,
                                    mimeType: ext === 'jpg' ? 'image/jpeg' : 'image/png',
                                    description: `style-extraction-${state.input.styleExtractionRunId}-sample-${idx}.${ext}`,
                                })
                                const sample: StyleSampleRef = {
                                    idx,
                                    subject: subject.prompt,
                                    rationale: subject.rationale,
                                    aspectRatio: subject.aspectRatio,
                                    ext,
                                    blobHash: stored.blobHash,
                                    imageUrl: `data:${ext === 'jpg' ? 'image/jpeg' : 'image/png'};base64,${buffer.toString('base64')}`,
                                    kind: subject.kind,
                                }

                                return sample
                            },
                            {
                                inputSummary: `kind=${subject.kind} subject=${subject.prompt.slice(0, 80)}`,
                                outputSummarizer: sample => sample ? `idx=${sample.idx} blobHash=${sample.blobHash}` : 'no sample',
                            },
                        ),
                ),
            )
    
            const samples: StyleSampleRef[] = []
            results.forEach((res, idx) => {
                if (
                    res.status === 'fulfilled'
                    && res.value
                )
                    samples.push(res.value)
                else if (res.status === 'rejected') {
                    const reason = res.reason instanceof Error ? res.reason.message : String(res.reason)
                    err(`Sample ${idx} failed: ${reason}`)
                }
            })

            return { samples }
        },
        {
            inputSummary: `recommended=${state.draft?.recommendedSampleSubjects.length ?? 0} sourceCrops=${state.sourceCrops.length}`,
            outputSummarizer: result => `samples=${result.samples?.length ?? 0}`,
        },
    )
}
