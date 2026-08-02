import { createHash } from 'node:crypto'

import { info } from '@lixpi/debug-tools'
import { type CapabilityJsonValue } from '@lixpi/constants'

import {
    type CapabilityActionExecutionContext,
    CapabilityActionRegistry,
    type CapabilityActionValidationResult,
} from '../../../backend/capability-action-registry.ts'
import { CapabilityError } from '../../../shared/capability-errors.ts'
import { CHARACTER_CREATOR_CAPABILITY_IDS } from './character-creator-definition.ts'
import { characterCreatorSettings } from '../settings.ts'
import {
    buildCharacterCreatorImagePrompt,
    buildCharacterSheetCorrectionPrompt,
    normalizeCharacterSheetAssessment,
    type CharacterSheetAssessment,
    type CharacterSheetValidation,
} from './character-creator-prompt.ts'

export type CharacterCreatorReference = {
    assetId: string
    modelUrl: string
}

export type CharacterCreatorImageCandidate = {
    image: CapabilityJsonValue
    providerMetadata?: CapabilityJsonValue
}

export type CharacterCreatorActionDependencies = {
    resolveReferences: (args: {
        assetIds: string[]
        context: CapabilityActionExecutionContext
    }) => Promise<CharacterCreatorReference[]>
    generateImage: (args: {
        prompt: string
        references: CharacterCreatorReference[]
        oneShotExample: Uint8Array
        context: CapabilityActionExecutionContext
    }) => Promise<CharacterCreatorImageCandidate>
    assessSheet: (args: {
        image: CapabilityJsonValue
        context: CapabilityActionExecutionContext
    }) => Promise<CharacterSheetAssessment>
    persistSheet: (args: {
        candidate: CharacterCreatorImageCandidate
        validation: CharacterSheetValidation
        correctionAttempts: 0 | 1
        context: CapabilityActionExecutionContext
    }) => Promise<{ assetId: string }>
}

export function registerCharacterCreatorActions(
    registry: CapabilityActionRegistry,
    dependencies: CharacterCreatorActionDependencies,
): void {
    registerIfMissing(registry, {
        key: 'character.validate-request',
        timeoutMs: characterCreatorSettings.actionTimeoutsMs.validateRequest,
        validateInput: validateObject,
        validateOutput: validateObject,
        authorize: authorizeCharacterCreator,
        execute: input => validateCharacterCreatorRequest(input),
        classifyRetry: () => 'terminal',
        summarizeInput: input => `prompt=${stringLength(input.prompt)} references=${arrayLength(input.referenceAssetIds)}`,
        summarizeOutput: output => `references=${arrayLength(asRecord(output)?.referenceAssetIds)}`,
    })
    registerIfMissing(registry, {
        key: 'asset.resolve-references',
        timeoutMs: characterCreatorSettings.actionTimeoutsMs.resolveReferences,
        validateInput: validateObject,
        validateOutput: validateObject,
        authorize: authorizeCharacterCreator,
        execute: async (input, context) => {
            const assetIds = readStringArray(input.referenceAssetIds, 'referenceAssetIds', true)
            const references = await dependencies.resolveReferences({ assetIds, context })
            if (references.length !== assetIds.length) {
                throw new CapabilityError(
                    'CAPABILITY_ACTION_NOT_ALLOWED',
                    'Every Character Creator reference Asset must be authorized and resolvable',
                )
            }
            return { references }
        },
        classifyRetry: () => 'terminal',
        summarizeInput: input => `referenceAssetIds=${arrayLength(input.referenceAssetIds)}`,
        summarizeOutput: output => `references=${arrayLength(asRecord(output)?.references)}`,
    })
    registerIfMissing(registry, {
        key: 'character.build-prompt',
        timeoutMs: characterCreatorSettings.actionTimeoutsMs.buildPrompt,
        validateInput: validateObject,
        validateOutput: validateGenerationContextOutput,
        authorize: authorizeCharacterCreator,
        execute: (input, context) => {
            const referenceAssetIds = readStringArray(input.referenceAssetIds, 'referenceAssetIds', true)
            const oneShotExample = readBytesResource(input.oneShotExample, 'oneShotExample')
            const oneShotExampleSha256 = createHash('sha256').update(oneShotExample).digest('hex')
            const manifestBlobHash = context.plan.serializable.resolvedManifests.find(
                manifest => manifest.capabilityId === context.rootCapabilityId,
            )?.manifestBlobHash
            const exampleTraceUrl = manifestBlobHash
                ? `/api/capabilities/${encodeURIComponent(context.rootCapabilityId)}/resources/${encodeURIComponent('character-sheet-example')}?manifestBlobHash=${encodeURIComponent(manifestBlobHash)}`
                : ''
            info(`[CharacterCreator:${context.runId}] packaged layout reference prepared ${JSON.stringify({
                resourceId: 'character-sheet-example',
                mediaType: 'image/jpeg',
                byteLength: oneShotExample.byteLength,
                sha256: oneShotExampleSha256,
                manifestBlobHash: manifestBlobHash ?? '',
                referenceAssetIds,
            })}`)
            return {
                mediaGenerationMode: 'character-creator',
                preserveUserPrompt: true,
                visualInstructions: buildCharacterCreatorImagePrompt({
                    prompt: readString(input.prompt, 'prompt'),
                    layoutInstructions: readTextResource(input.layout, 'layout'),
                    referenceFidelityInstructions: readTextResource(input.referenceFidelity, 'referenceFidelity'),
                    promptConstructionInstructions: readTextResource(input.promptInstructions, 'promptInstructions'),
                    referenceCount: referenceAssetIds.length,
                }),
                referenceImages: [toDataUrl(oneShotExample, 'image/jpeg')],
                referenceImageTraceUrls: exampleTraceUrl ? [exampleTraceUrl] : [],
            }
        },
        classifyRetry: () => 'terminal',
        summarizeInput: input => `prompt=${stringLength(input.prompt)} references=${arrayLength(input.referenceAssetIds)}`,
        summarizeOutput: output => `prompt=${stringLength(asRecord(output)?.visualInstructions)}`,
    })
    registerIfMissing(registry, {
        key: 'image.generate',
        timeoutMs: characterCreatorSettings.actionTimeoutsMs.generateImage,
        validateInput: validateObject,
        validateOutput: validateImageCandidate,
        authorize: authorizeCharacterCreator,
        execute: async (input, context) => await dependencies.generateImage({
            prompt: readString(input.prompt, 'prompt'),
            references: readReferences(input.references),
            oneShotExample: readBytesResource(input.oneShotExample, 'oneShotExample'),
            context,
        }),
        classifyRetry: error => isRetryableProviderError(error) ? 'retryable' : 'terminal',
        summarizeInput: input => `prompt=${stringLength(input.prompt)} references=${arrayLength(input.references)}`,
        summarizeOutput: () => 'image=generated',
    })
    registerIfMissing(registry, {
        key: 'character-sheet.validate',
        timeoutMs: characterCreatorSettings.actionTimeoutsMs.validateSheet,
        validateInput: validateImageInput,
        validateOutput: validateSheetValidationOutput,
        authorize: authorizeCharacterCreator,
        execute: async (input, context) => normalizeCharacterSheetAssessment(await dependencies.assessSheet({
            image: readCapabilityJsonValue(input.image, 'image'),
            context,
        })),
        classifyRetry: error => isRetryableProviderError(error) ? 'retryable' : 'terminal',
        summarizeInput: () => 'image=provided',
        summarizeOutput: output => `passed=${String(asRecord(output)?.passed)}`,
    })
    registerIfMissing(registry, {
        key: 'character.build-correction-prompt',
        timeoutMs: characterCreatorSettings.actionTimeoutsMs.buildCorrectionPrompt,
        validateInput: validateObject,
        validateOutput: validateCorrectionPromptOutput,
        authorize: authorizeCharacterCreator,
        execute: input => ({
            required: true,
            prompt: buildCharacterSheetCorrectionPrompt({
                originalPrompt: readString(input.prompt, 'prompt'),
                validation: readValidation(input.validation),
            }),
        }),
        classifyRetry: () => 'terminal',
        summarizeInput: input => `issues=${arrayLength(asRecord(input.validation)?.issues)}`,
        summarizeOutput: output => `prompt=${stringLength(asRecord(output)?.prompt)}`,
    })
    registerIfMissing(registry, {
        key: 'character-sheet.persist',
        timeoutMs: characterCreatorSettings.actionTimeoutsMs.persistSheet,
        validateInput: validateObject,
        validateOutput: validatePersistOutput,
        authorize: authorizeCharacterCreator,
        execute: async (input, context) => {
            const original = readImageCandidate(input.original, 'original')
            const originalValidation = readValidation(input.originalValidation)
            const correction = input.correction === undefined
                ? undefined
                : readImageCandidate(input.correction, 'correction')
            const correctionValidation = input.correctionValidation === undefined
                ? undefined
                : readValidation(input.correctionValidation)

            const selected = selectFinalCharacterSheet({
                original,
                originalValidation,
                correction,
                correctionValidation,
            })
            const persisted = await dependencies.persistSheet({ ...selected, context })
            return {
                assetId: persisted.assetId,
                validation: {
                    passed: selected.validation.passed,
                    correctionAttempts: selected.correctionAttempts,
                },
            }
        },
        classifyRetry: error => isRetryablePersistenceError(error) ? 'retryable' : 'terminal',
        summarizeInput: input => `corrected=${String(input.correction !== undefined)}`,
        summarizeOutput: output => `assetId=${String(asRecord(output)?.assetId ?? '')}`,
        collectOutputAssetIds: output => {
            const assetId = asRecord(output)?.assetId
            return typeof assetId === 'string' ? [assetId] : []
        },
    })
}

function toDataUrl(bytes: Uint8Array, mediaType: string): string {
    return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`
}

export function selectFinalCharacterSheet(args: {
    original: CharacterCreatorImageCandidate
    originalValidation: CharacterSheetValidation
    correction?: CharacterCreatorImageCandidate
    correctionValidation?: CharacterSheetValidation
}): {
    candidate: CharacterCreatorImageCandidate
    validation: CharacterSheetValidation
    correctionAttempts: 0 | 1
} {
    if (args.originalValidation.passed) {
        return {
            candidate: args.original,
            validation: args.originalValidation,
            correctionAttempts: 0,
        }
    }
    if (!args.correction || !args.correctionValidation) {
        throw new CapabilityError(
            'CAPABILITY_ACTION_OUTPUT_INVALID',
            'Character sheet failed validation and no correction result exists',
        )
    }
    const useCorrection = args.correctionValidation.passed
        || countPassingValidationChecks(args.correctionValidation) >= countPassingValidationChecks(args.originalValidation)
    return {
        candidate: useCorrection ? args.correction : args.original,
        validation: useCorrection ? args.correctionValidation : args.originalValidation,
        correctionAttempts: 1,
    }
}

function countPassingValidationChecks(validation: CharacterSheetValidation): number {
    return Object.entries(validation).reduce((count, [key, value]) =>
        key !== 'passed' && typeof value === 'boolean' && value ? count + 1 : count, 0)
}

function validateCharacterCreatorRequest(input: Readonly<Record<string, unknown>>): {
    prompt: string
    referenceAssetIds: string[]
} {
    const prompt = readString(input.prompt, 'prompt').trim()
    if (prompt.length > 8000) throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', 'Character prompt exceeds 8000 characters')
    const referenceAssetIds = [...new Set(readStringArray(input.referenceAssetIds, 'referenceAssetIds', true))]
    if (referenceAssetIds.length > 8) {
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', 'Character Creator accepts at most 8 reference Assets')
    }
    return { prompt, referenceAssetIds }
}

function authorizeCharacterCreator(context: { rootCapabilityId: string }): boolean {
    return context.rootCapabilityId === CHARACTER_CREATOR_CAPABILITY_IDS.tool
}

function registerIfMissing(
    registry: CapabilityActionRegistry,
    definition: Parameters<CapabilityActionRegistry['register']>[0],
): void {
    if (!registry.has(definition.key)) registry.register(definition)
}

function validateObject(input: unknown): CapabilityActionValidationResult {
    return asRecord(input)
        ? { valid: true }
        : { valid: false, message: 'Value must be an object' }
}

function validateGenerationContextOutput(output: unknown): CapabilityActionValidationResult {
    const record = asRecord(output)
    return record?.mediaGenerationMode === 'character-creator'
        && record.preserveUserPrompt === true
        && typeof record.visualInstructions === 'string'
        && record.visualInstructions.length > 0
        && Array.isArray(record.referenceImages)
        && record.referenceImages.every(value => typeof value === 'string')
        && Array.isArray(record.referenceImageTraceUrls)
        && record.referenceImageTraceUrls.every(value => typeof value === 'string')
        ? { valid: true }
        : { valid: false, message: 'Output must contain generation instructions and reference image arrays' }
}

function validateCorrectionPromptOutput(output: unknown): CapabilityActionValidationResult {
    const record = asRecord(output)
    return record?.required === true && typeof record.prompt === 'string'
        ? { valid: true }
        : { valid: false, message: 'Correction output must contain required=true and a prompt' }
}

function validateImageInput(input: unknown): CapabilityActionValidationResult {
    const record = asRecord(input)
    return record && isCapabilityJsonValue(record.image)
        ? { valid: true }
        : { valid: false, message: 'Input must contain a JSON-compatible image reference' }
}

function validateImageCandidate(output: unknown): CapabilityActionValidationResult {
    const record = asRecord(output)
    return record && isCapabilityJsonValue(record.image)
        ? { valid: true }
        : { valid: false, message: 'Image action must return a JSON-compatible image reference' }
}

function validateSheetValidationOutput(output: unknown): CapabilityActionValidationResult {
    try {
        readValidation(output)
        return { valid: true }
    } catch (error) {
        return { valid: false, message: error instanceof Error ? error.message : String(error) }
    }
}

function validatePersistOutput(output: unknown): CapabilityActionValidationResult {
    const record = asRecord(output)
    const validation = asRecord(record?.validation)
    return typeof record?.assetId === 'string'
        && typeof validation?.passed === 'boolean'
        && (validation.correctionAttempts === 0 || validation.correctionAttempts === 1)
        ? { valid: true }
        : { valid: false, message: 'Persist output must contain an Asset ID and validation summary' }
}

function readValidation(input: unknown): CharacterSheetValidation {
    const record = asRecord(input)
    if (!record || typeof record.passed !== 'boolean') {
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', 'Character sheet validation is missing')
    }
    const normalized = normalizeCharacterSheetAssessment(record)
    if (normalized.passed !== record.passed) {
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', 'Character sheet validation summary is inconsistent')
    }
    return normalized
}

function readImageCandidate(input: unknown, field: string): CharacterCreatorImageCandidate {
    const record = asRecord(input)
    if (!record || !isCapabilityJsonValue(record.image)) {
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', `${field} must contain a JSON-compatible image reference`)
    }
    return {
        image: record.image,
        ...(isCapabilityJsonValue(record.providerMetadata) ? { providerMetadata: record.providerMetadata } : {}),
    }
}

function readReferences(input: unknown): CharacterCreatorReference[] {
    if (!Array.isArray(input)) throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', 'references must be an array')
    return input.map((entry, index) => {
        const record = asRecord(entry)
        if (!record || typeof record.assetId !== 'string' || typeof record.modelUrl !== 'string') {
            throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', `references[${index}] is invalid`)
        }
        return { assetId: record.assetId, modelUrl: record.modelUrl }
    })
}

function readTextResource(input: unknown, field: string): string {
    const record = asRecord(input)
    if (!record || !(record.bytes instanceof Uint8Array)) {
        throw new CapabilityError('CAPABILITY_RESOURCE_INVALID', `${field} must be a loaded text resource`)
    }
    return new TextDecoder().decode(record.bytes)
}

function readBytesResource(input: unknown, field: string): Uint8Array {
    const record = asRecord(input)
    if (!record || !(record.bytes instanceof Uint8Array)) {
        throw new CapabilityError('CAPABILITY_RESOURCE_INVALID', `${field} must be a loaded binary resource`)
    }
    return record.bytes
}

function readString(input: unknown, field: string): string {
    if (typeof input !== 'string' || input.trim().length === 0) {
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', `${field} must be a non-empty string`)
    }
    return input
}

function readStringArray(input: unknown, field: string, optional = false): string[] {
    if (optional && input === undefined) return []
    if (!Array.isArray(input) || input.some(item => typeof item !== 'string' || item.length === 0)) {
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', `${field} must be an array of non-empty strings`)
    }
    return input as string[]
}

function readCapabilityJsonValue(input: unknown, field: string): CapabilityJsonValue {
    if (!isCapabilityJsonValue(input)) {
        throw new CapabilityError('CAPABILITY_ACTION_INPUT_INVALID', `${field} must be JSON-compatible`)
    }
    return input
}

function asRecord(input: unknown): Record<string, unknown> | null {
    return input && typeof input === 'object' && !Array.isArray(input)
        ? input as Record<string, unknown>
        : null
}

function isCapabilityJsonValue(input: unknown): input is CapabilityJsonValue {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return true
    if (typeof input === 'number') return Number.isFinite(input)
    if (Array.isArray(input)) return input.every(isCapabilityJsonValue)
    const record = asRecord(input)
    return record !== null && Object.values(record).every(isCapabilityJsonValue)
}

function isRetryableProviderError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /timeout|temporar|connection|fetch failed|socket|econnreset|etimedout|rate.?limit|429|502|503|504/i.test(message)
}

function isRetryablePersistenceError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /timeout|temporar|throttl|transaction conflict/i.test(message)
}

function stringLength(input: unknown): number {
    return typeof input === 'string' ? input.length : 0
}

function arrayLength(input: unknown): number {
    return Array.isArray(input) ? input.length : 0
}
