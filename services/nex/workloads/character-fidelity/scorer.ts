'use strict'

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import * as ort from 'onnxruntime-web'
import sharp from 'sharp'

import type {
    CharacterFaceDetection,
    CharacterFidelityAssessmentRequest,
    CharacterFidelityAssessmentResponse,
    CharacterFidelityObjectCoordinate,
} from '@lixpi/constants'
import type NatsService from '@lixpi/nats-service'

import { CHARACTER_FIDELITY_MODEL_MANIFEST } from './model-manifest.ts'

const MAX_OBJECT_BYTES = 32 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 8_192
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024
const MODEL_DIRECTORY = fileURLToPath(new URL('./models/', import.meta.url))

type RuntimeModels = {
    detector: ort.InferenceSession
    recognizer: ort.InferenceSession
}

type DetectedFace = CharacterFaceDetection & {
    landmarks: Array<{ x: number; y: number }>
}

let modelsPromise: Promise<RuntimeModels> | undefined

export async function assessCharacterFidelity(
    request: CharacterFidelityAssessmentRequest,
    storage: NatsService,
    signal?: AbortSignal,
): Promise<CharacterFidelityAssessmentResponse> {
    validateRequest(request)
    const responseBase = {
        jobId: request.jobId,
        panelId: request.panelId,
        attemptId: request.attemptId,
        detector: artifactIdentity('detector'),
        recognizer: artifactIdentity('recognizer'),
    }
    if (request.sourceMedium !== 'photograph') {
        return unavailable(responseBase, 'non-photographic')
    }
    if (request.expectedFaceVisibility !== 'required') {
        return unavailable(responseBase, 'face-not-required')
    }
    assertNotAborted(signal)
    const sourceBytes = await Promise.all(request.sources.map(coordinate => readCoordinate(storage, coordinate, request.organizationId)))
    const candidateBytes = await readCoordinate(storage, request.candidate, request.organizationId)
    assertNotAborted(signal)
    const runtime = await loadCharacterFidelityModels()
    const sourceFaceGroups = await Promise.all(sourceBytes.map(bytes => detectFaces(bytes, runtime.detector)))
    const sourceFaces = sourceFaceGroups.flat()
    const candidateFaces = await detectFaces(candidateBytes, runtime.detector)
    if (sourceFaces.length === 0) return unavailable(responseBase, 'source-face-not-found', sourceFaces, candidateFaces)
    if (sourceFaceGroups.some(faces => faces.length > 1)) {
        return unavailable(responseBase, 'ambiguous-source-face', sourceFaces, candidateFaces)
    }
    if (candidateFaces.length === 0) return unavailable(responseBase, 'candidate-face-not-found', sourceFaces, candidateFaces)
    if (candidateFaces.length > 1) return unavailable(responseBase, 'ambiguous-candidate-face', sourceFaces, candidateFaces)
    assertNotAborted(signal)
    const sourceEmbeddings = await Promise.all(sourceBytes.map((bytes, index) => embedFace(
        bytes,
        sourceFaceGroups[index]![0]!,
        runtime.recognizer,
    )))
    const candidateEmbedding = await embedFace(candidateBytes, candidateFaces[0]!, runtime.recognizer)
    const similarity = Math.max(...sourceEmbeddings.map(embedding => cosineSimilarity(embedding, candidateEmbedding)))
    return {
        ...responseBase,
        metric: { available: true, cosineSimilarity: similarity },
        sourceDetections: sourceFaces,
        candidateDetections: candidateFaces,
    }
}

export async function loadCharacterFidelityModels(): Promise<RuntimeModels> {
    modelsPromise ??= (async () => {
        ort.env.wasm.numThreads = 1
        ort.env.wasm.simd = true
        const detectorBytes = await readAndVerifyArtifact('detector')
        const recognizerBytes = await readAndVerifyArtifact('recognizer')
        return {
            detector: await ort.InferenceSession.create(detectorBytes, { executionProviders: ['wasm'] }),
            recognizer: await ort.InferenceSession.create(recognizerBytes, { executionProviders: ['wasm'] }),
        }
    })()
    return await modelsPromise
}

export async function verifyCharacterFidelityArtifacts(): Promise<void> {
    await Promise.all([readAndVerifyArtifact('detector'), readAndVerifyArtifact('recognizer')])
}

const detectFaces = async (bytes: Uint8Array, session: ort.InferenceSession): Promise<DetectedFace[]> => {
    const metadata = await sharp(bytes).metadata()
    const sourceWidth = metadata.width ?? 0
    const sourceHeight = metadata.height ?? 0
    if (sourceWidth < 1 || sourceHeight < 1) throw new Error('CHARACTER_FIDELITY_IMAGE_DIMENSIONS_INVALID')
    const { tensor } = await imageTensor(bytes, 640, 640, 'detector')
    const outputs = await session.run({ [session.inputNames[0]!]: tensor })
    const detections = [8, 16, 32].flatMap(stride => decodeYuNetStride(outputs, stride))
    return nonMaximumSuppression(detections, 0.3).map(face => ({
        ...face,
        x: face.x * sourceWidth / 640,
        y: face.y * sourceHeight / 640,
        width: face.width * sourceWidth / 640,
        height: face.height * sourceHeight / 640,
        landmarks: face.landmarks.map(point => ({
            x: point.x * sourceWidth / 640,
            y: point.y * sourceHeight / 640,
        })),
    }))
}

const embedFace = async (
    bytes: Uint8Array,
    face: DetectedFace,
    session: ort.InferenceSession,
): Promise<Float32Array> => {
    const metadata = await sharp(bytes).metadata()
    const sourceWidth = metadata.width ?? 0
    const sourceHeight = metadata.height ?? 0
    const paddingX = face.width * 0.2
    const paddingY = face.height * 0.2
    const left = Math.max(0, Math.floor(face.x - paddingX))
    const top = Math.max(0, Math.floor(face.y - paddingY))
    const width = Math.max(1, Math.min(sourceWidth - left, Math.ceil(face.width + paddingX * 2)))
    const height = Math.max(1, Math.min(sourceHeight - top, Math.ceil(face.height + paddingY * 2)))
    const crop = await sharp(bytes).extract({ left, top, width, height }).toBuffer()
    const { tensor } = await imageTensor(crop, 112, 112, 'recognizer')
    const outputs = await session.run({ [session.inputNames[0]!]: tensor })
    const output = outputs[session.outputNames[0]!]
    if (!output || !(output.data instanceof Float32Array)) throw new Error('CHARACTER_FIDELITY_RECOGNIZER_OUTPUT_INVALID')
    return normalize(output.data)
}

const decodeYuNetStride = (outputs: ort.InferenceSession.OnnxValueMapType, stride: number): DetectedFace[] => {
    const classScores = getFloatOutput(outputs, `cls_${stride}`)
    const objectScores = getFloatOutput(outputs, `obj_${stride}`)
    const boxes = getFloatOutput(outputs, `bbox_${stride}`)
    const landmarks = getFloatOutput(outputs, `kps_${stride}`)
    const gridWidth = 640 / stride
    const detections: DetectedFace[] = []
    for (let index = 0; index < classScores.length; index += 1) {
        const confidence = Math.sqrt(Math.max(0, classScores[index]!) * Math.max(0, objectScores[index]!))
        if (confidence < 0.7) continue
        const centerX = (index % gridWidth) * stride
        const centerY = Math.floor(index / gridWidth) * stride
        const boxOffset = index * 4
        const left = centerX - boxes[boxOffset]! * stride
        const top = centerY - boxes[boxOffset + 1]! * stride
        const right = centerX + boxes[boxOffset + 2]! * stride
        const bottom = centerY + boxes[boxOffset + 3]! * stride
        const landmarkOffset = index * 10
        detections.push({
            x: Math.max(0, left),
            y: Math.max(0, top),
            width: Math.max(1, Math.min(640, right) - Math.max(0, left)),
            height: Math.max(1, Math.min(640, bottom) - Math.max(0, top)),
            confidence,
            landmarks: Array.from({ length: 5 }, (_value, landmarkIndex) => ({
                x: centerX + landmarks[landmarkOffset + landmarkIndex * 2]! * stride,
                y: centerY + landmarks[landmarkOffset + landmarkIndex * 2 + 1]! * stride,
            })),
        })
    }
    return detections
}

const getFloatOutput = (
    outputs: ort.InferenceSession.OnnxValueMapType,
    name: string,
): Float32Array => {
    const output = outputs[name]
    if (!output || !(output.data instanceof Float32Array)) {
        throw new Error(`CHARACTER_FIDELITY_DETECTOR_OUTPUT_INVALID:${name}`)
    }
    return output.data
}

const nonMaximumSuppression = (detections: DetectedFace[], overlapThreshold: number): DetectedFace[] => {
    const selected: DetectedFace[] = []
    for (const candidate of detections.sort((left, right) => right.confidence - left.confidence)) {
        if (selected.every(existing => intersectionOverUnion(candidate, existing) <= overlapThreshold)) {
            selected.push(candidate)
        }
    }
    return selected
}

const intersectionOverUnion = (left: DetectedFace, right: DetectedFace): number => {
    const intersectionWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x))
    const intersectionHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y))
    const intersection = intersectionWidth * intersectionHeight
    const union = left.width * left.height + right.width * right.height - intersection
    return union > 0 ? intersection / union : 0
}

const imageTensor = async (
    bytes: Uint8Array,
    width: number,
    height: number,
    kind: 'detector' | 'recognizer',
): Promise<{ tensor: ort.Tensor; variance: number }> => {
    const { data, info } = await sharp(bytes)
        .rotate()
        .resize({ width, height, fit: 'cover', position: 'centre' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
    if (info.channels !== 3) throw new Error('CHARACTER_FIDELITY_IMAGE_CHANNELS_INVALID')
    const plane = width * height
    const values = new Float32Array(plane * 3)
    let sum = 0
    let squared = 0
    for (let pixel = 0; pixel < plane; pixel += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
            const raw = data[pixel * 3 + channel]!
            sum += raw
            squared += raw * raw
            const providerChannel = 2 - channel
            values[providerChannel * plane + pixel] = kind === 'recognizer' ? (raw - 127.5) / 128 : raw
        }
    }
    const sampleCount = plane * 3
    const mean = sum / sampleCount
    return {
        tensor: new ort.Tensor('float32', values, [1, 3, height, width]),
        variance: squared / sampleCount - mean * mean,
    }
}

const normalize = (vector: Float32Array): Float32Array => {
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    if (magnitude === 0) throw new Error('CHARACTER_FIDELITY_EMBEDDING_EMPTY')
    return Float32Array.from(vector, value => value / magnitude)
}

const cosineSimilarity = (left: Float32Array, right: Float32Array): number => {
    if (left.length !== right.length) throw new Error('CHARACTER_FIDELITY_EMBEDDING_SIZE_MISMATCH')
    let score = 0
    for (let index = 0; index < left.length; index += 1) score += left[index]! * right[index]!
    return Math.max(-1, Math.min(1, score))
}

const readCoordinate = async (
    storage: NatsService,
    coordinate: CharacterFidelityObjectCoordinate,
    organizationId: string,
): Promise<Uint8Array> => {
    validateCoordinate(coordinate, organizationId)
    const bytes = await storage.getObject(coordinate.bucketName, coordinate.objectKey)
    if (!bytes) throw new Error('CHARACTER_FIDELITY_OBJECT_NOT_FOUND')
    if (bytes.byteLength !== coordinate.byteLength || bytes.byteLength > MAX_OBJECT_BYTES) {
        throw new Error('CHARACTER_FIDELITY_OBJECT_SIZE_INVALID')
    }
    const metadata = await sharp(bytes).metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    const expectedFormat = coordinate.mimeType === 'image/jpeg' ? 'jpeg' : coordinate.mimeType.slice('image/'.length)
    if (metadata.format !== expectedFormat) throw new Error('CHARACTER_FIDELITY_OBJECT_MEDIA_TYPE_INVALID')
    if (width < 1 || height < 1
        || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
        || width * height > MAX_IMAGE_PIXELS) {
        throw new Error('CHARACTER_FIDELITY_IMAGE_DIMENSIONS_INVALID')
    }
    return bytes
}

const validateRequest = (request: CharacterFidelityAssessmentRequest): void => {
    if (!request.jobId || !request.organizationId || !request.panelId || !request.attemptId) {
        throw new Error('CHARACTER_FIDELITY_REQUEST_INVALID')
    }
    if (request.sources.length === 0 || request.sources.length > 5) throw new Error('CHARACTER_FIDELITY_SOURCE_COUNT_INVALID')
    request.sources.forEach(coordinate => validateCoordinate(coordinate, request.organizationId))
    validateCoordinate(request.candidate, request.organizationId)
}

const validateCoordinate = (coordinate: CharacterFidelityObjectCoordinate, organizationId: string): void => {
    const extensionByMimeType: Record<string, string | undefined> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
    }
    const extension = extensionByMimeType[coordinate.mimeType]
    if (coordinate.organizationId !== organizationId
        || coordinate.bucketName !== `transient-media-${organizationId}-files`
        || !extension || !new RegExp(`^partial-[a-f0-9]{64}\\.${extension}$`, 'u').test(coordinate.objectKey)
        || coordinate.byteLength <= 0 || coordinate.byteLength > MAX_OBJECT_BYTES
    ) {
        throw new Error('CHARACTER_FIDELITY_OBJECT_COORDINATE_INVALID')
    }
}

const readAndVerifyArtifact = async (kind: 'detector' | 'recognizer'): Promise<Uint8Array> => {
    const artifact = CHARACTER_FIDELITY_MODEL_MANIFEST[kind]
    const bytes = await readFile(`${MODEL_DIRECTORY}${artifact.fileName}`)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== artifact.sha256) throw new Error(`CHARACTER_FIDELITY_ARTIFACT_CHECKSUM_INVALID:${artifact.artifactId}`)
    return bytes
}

const artifactIdentity = (kind: 'detector' | 'recognizer') => ({
    artifactId: CHARACTER_FIDELITY_MODEL_MANIFEST[kind].artifactId,
    sha256: CHARACTER_FIDELITY_MODEL_MANIFEST[kind].sha256,
})

const unavailable = (
    base: Pick<CharacterFidelityAssessmentResponse, 'jobId' | 'panelId' | 'attemptId' | 'detector' | 'recognizer'>,
    unavailableReason: NonNullable<CharacterFidelityAssessmentResponse['metric']['unavailableReason']>,
    sourceDetections: CharacterFaceDetection[] = [],
    candidateDetections: CharacterFaceDetection[] = [],
): CharacterFidelityAssessmentResponse => ({
    ...base,
    metric: { available: false, unavailableReason },
    sourceDetections,
    candidateDetections,
})

const assertNotAborted = (signal?: AbortSignal): void => {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}
