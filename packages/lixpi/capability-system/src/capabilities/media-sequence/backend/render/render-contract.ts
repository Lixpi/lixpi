import {
    type SequenceExportDefaults,
    type SequenceRational,
    type SequenceSourceBinding,
} from '../../shared/media-sequence.ts'

export type MediaRenderLimits = {
    maxDurationSeconds: number
    maxPixels: number
    maxFps: number
    maxConcurrentJobs: number
    tempLimitBytes: number
    maxBufferedBytes: number
    timeoutSeconds: number
}

export const defaultMediaRenderLimits: Readonly<MediaRenderLimits> = Object.freeze({
    maxDurationSeconds: 1800,
    maxPixels: 8294400,
    maxFps: 60,
    maxConcurrentJobs: 1,
    tempLimitBytes: 8589934592,
    maxBufferedBytes: 536870912,
    timeoutSeconds: 3600,
})

export type MediaRenderPlan = {
    sequenceId: string
    sequenceRevision: number
    preset: SequenceExportDefaults
    inputs: Array<SequenceSourceBinding & { filename: string }>
    resources: Array<{
        filename: string
        content: string
    }>
    arguments: string[]
    outputFilename: string
    mimeType: 'video/mp4' | 'audio/wav' | 'audio/mpeg'
    durationSeconds: number
    width?: number
    height?: number
    frameRate?: SequenceRational
    sampleRate: number
    estimatedDiskBytes: number
}

export type MediaRenderCompilerPort = {
    compile: (
        sequence: unknown,
        preset: unknown,
        limits: MediaRenderLimits,
    ) => MediaRenderPlan
    validateSource: (source: unknown) => SequenceSourceBinding
}

export type MediaSourceProbeRequest = {
    organizationId: string
    source: SequenceSourceBinding
    accountContext?: unknown
}

export type MediaSourceProbeResult = {
    probeVersion: 'media-source-v1'
    blobHash: string
    durationSeconds: number
    width?: number
    height?: number
    channels?: number
    audioSampleRate?: number
    hasAudio: boolean
    peaks: number[]
}

export type MediaRenderRequest = {
    jobId: string
    attempt: number
    organizationId: string
    outputAssetId: string
    sequence: unknown
    preset: unknown
    accountContext?: unknown
}

export type MediaRenderProgress = {
    jobId: string
    attempt: number
    organizationId: string
    phase: 'decode' | 'compose' | 'encode' | 'finalize'
    processedDurationSeconds?: number
    durationSeconds: number
}

export type MediaRenderResult = {
    jobId: string
    attempt: number
    organizationId: string
    outputAssetId: string
    sequenceId: string
    sequenceRevision: number
    presetId: SequenceExportDefaults['presetId']
    blobHash: string
    byteSize: number
    bucketName: string
    objectKey: string
    mimeType: MediaRenderPlan['mimeType']
    durationSeconds: number
    width?: number
    height?: number
    audioSampleRate: number
    channels: number
}

export type MediaRenderReadiness = {
    ready: boolean
    presets: Array<{
        presetId: SequenceExportDefaults['presetId']
        available: boolean
        reason?: string
    }>
    limits: MediaRenderLimits
}
