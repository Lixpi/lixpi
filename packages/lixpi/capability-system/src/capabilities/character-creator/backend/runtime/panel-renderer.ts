'use strict'

import { createHash } from 'node:crypto'

import { info } from '@lixpi/debug-tools'
import sharp from 'sharp'

import type { CharacterPanelSpec } from '../../shared/character-sheet-media-plan.ts'
import type { CapabilityMediaExecutionContext } from '../../../../backend/capability-media-strategy.ts'
import type {
    CharacterImageGenerationPort,
    CharacterImageReference,
} from './runtime-ports.ts'
import {
    hasCharacterPoseReference,
    loadCharacterPoseReference,
} from './pose-reference.ts'

export type CharacterPanelRenderResult = {
    bytes: Buffer
    providerOperationId?: string
    includedReferenceRoles: string[]
    omittedReferenceRoles: string[]
}

export async function renderCharacterPanel(args: {
    imageGeneration: CharacterImageGenerationPort
    context: CapabilityMediaExecutionContext
    plan: Parameters<CharacterImageGenerationPort['generate']>[0]['plan']
    panel: CharacterPanelSpec
    attempt: number
    prompt: string
    references: CharacterImageReference[]
    signal?: AbortSignal
}): Promise<CharacterPanelRenderResult> {
    const poseReference = await loadCharacterPoseReference(args.panel)
    if (poseReference) {
        const poseBytes = decodeReferenceImage(poseReference.url)
        info(`[CharacterCreatorShot:${args.context.generationRequestId}:${args.panel.panelId}:${args.attempt}] dispatch ${JSON.stringify({
            mediaRunId: args.context.mediaRunId,
            panelId: args.panel.panelId,
            target: args.panel.target,
            fileName: poseReference.fileName,
            preAdaptationReferenceIndex: 0,
            byteLength: poseBytes.length,
            sha256: createHash('sha256').update(poseBytes).digest('hex'),
            identityReferenceRoles: args.references.map(reference => reference.role),
        })}`)
    } else {
        info(`[CharacterCreatorShot:${args.context.generationRequestId}:${args.panel.panelId}:${args.attempt}] source-only ${JSON.stringify({
            mediaRunId: args.context.mediaRunId,
            panelId: args.panel.panelId,
            target: args.panel.target,
            identityReferenceRoles: args.references.map(reference => reference.role),
        })}`)
    }
    const result = await args.imageGeneration.generate({
        context: args.context,
        plan: args.plan,
        operationKey: `${args.plan.capabilityRunId}:${args.panel.panelId}:${args.attempt}`,
        usageMode: 'character-creator',
        prompt: args.prompt,
        references: poseReference ? [poseReference, ...args.references] : args.references,
        signal: args.signal,
    })
    if (poseReference && !result.includedReferenceRoles.includes('pose-reference')) {
        throw new Error(`CHARACTER_PANEL_POSE_REFERENCE_OMITTED:${args.panel.panelId}`)
    }
    info(`[CharacterCreatorShot:${args.context.generationRequestId}:${args.panel.panelId}:${args.attempt}] provider-result ${JSON.stringify({
        includedReferenceRoles: result.includedReferenceRoles,
        omittedReferenceRoles: result.omittedReferenceRoles,
        providerOperationId: result.providerOperationId ?? '',
    })}`)
    const bytes = decodeGeneratedImage(result.image)
    await assertGeneratedPanelUsable(bytes)
    return {
        bytes,
        providerOperationId: result.providerOperationId,
        includedReferenceRoles: result.includedReferenceRoles,
        omittedReferenceRoles: result.omittedReferenceRoles,
    }
}

const assertGeneratedPanelUsable = async (bytes: Buffer): Promise<void> => {
    try {
        const metadata = await sharp(bytes).metadata()
        if (!metadata.width || !metadata.height || metadata.width < 128 || metadata.height < 128) {
            throw new Error('dimensions')
        }
    } catch (error) {
        throw new Error(`CHARACTER_PANEL_PROVIDER_OUTPUT_INVALID:${(error as Error).message}`)
    }
}

export function buildCharacterPanelPrompt(args: {
    panel: CharacterPanelSpec
    userPrompt: string
    evidenceSummary: string
}): string {
    const usesPoseReference = hasCharacterPoseReference(args.panel)
    const poseInstruction = !usesPoseReference
        ? args.panel.kind === 'head'
            ? 'No synthetic facial or portrait control image is provided. Use only the prompt and original subject references for facial anatomy, sex presentation, identity, hair, headwear, expression, camera angle, and body context; create the requested neutral head view directly.'
            : 'No synthetic spatial control image is provided for this detail shot. Use only the prompt and original subject references for identity, outfit construction, materials, accessories, camera angle, and framing.'
        : args.panel.kind === 'head'
            ? `Use the file POSE_REFERENCE_${args.panel.panelId}.png only for centered straight-on camera direction, upright head position, symmetric head-and-shoulder alignment, upper-body crop, and subject scale. Its featureless gray mannequin is spatial pose control only, never identity or design evidence.`
        : args.panel.kind === 'prop'
            ? `Use the file POSE_REFERENCE_${args.panel.panelId}.png only for object placement, hand placement, and framing.`
            : `Use the file POSE_REFERENCE_${args.panel.panelId}.png only for framing, camera direction, upright head angle, posture, limb placement, weight distribution, and silhouette.`
    const framingInstruction = args.panel.kind === 'head'
        ? 'Use close head-and-shoulders identity-portrait framing. Preserve the complete top of the hair or headwear with 10-12 percent clean margin, plus the complete face and neck. Crop immediately below the collarbones. Do not show armpits, arms, chest, or torso. The head from crown to chin must occupy 55-60 percent of image height so facial details are clear.'
        : args.panel.crop === 'full-body' || args.panel.crop === 'action'
            ? 'The complete character must occupy 82-90 percent of image height. Keep even white margins above the hair or headwear and below the footwear. Do not make the figure small.'
            : args.panel.crop === 'upper-body'
                ? 'Frame from the complete top of the hair or headwear through mid-torso. Keep both shoulders and upper arms visible. The subject must occupy 82-90 percent of image height without touching an edge.'
                : 'Fill the frame with the requested object arrangement while keeping every object and hand fully visible.'
    return [
        `Create one isolated ${args.panel.crop} reference image: ${args.panel.target}.`,
        'INPUT ROLES',
        'The original source image or images define the exact person or character: facial identity, body proportions, hair, headwear, outfit construction, accessories, colors, materials, and visual medium.',
        poseInstruction,
        usesPoseReference
            ? 'The pose file is spatial control, never identity or design evidence. Ignore its gray material, featureless face, anatomy, physique, sex presentation, clothing, lighting, and rendering style; only the original subject references define the character.'
            : '',
        'SHOT CONTRACT',
        framingInstruction,
        'Use an eye-level studio camera with a normal focal-length perspective, minimal perspective distortion, level shoulders where applicable, and an upright head unless the user explicitly requests otherwise.',
        args.userPrompt,
        args.evidenceSummary,
        'INVARIANTS',
        'Preserve the observed identity, anatomy, clothing construction, materials, accessories, colors, and rendering medium exactly. Change only the camera, crop, and pose required by this shot.',
        args.panel.kind === 'head'
            ? 'Keep a relaxed neutral expression with level gaze and a closed relaxed mouth. Do not introduce a smile, frown, surprise, or other expression variant.'
            : '',
        'One character only on a pure white studio background. No text, letters, numbers, labels, headings, captions, borders, grids, swatches, logos, watermarks, scenery, or additional people.',
    ].filter(Boolean).join('\n')
}

const decodeGeneratedImage = (value: string): Buffer => {
    const dataUrl = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/u.exec(value)
    const base64 = dataUrl?.[1] ?? value
    if (!/^[A-Za-z0-9+/=\r\n]+$/u.test(base64)) throw new Error('CHARACTER_PANEL_PROVIDER_OUTPUT_FORMAT_INVALID')
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.length === 0) throw new Error('CHARACTER_PANEL_PROVIDER_OUTPUT_EMPTY')
    return bytes
}

const decodeReferenceImage = (value: string): Buffer => {
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/u.exec(value)
    if (!match?.[1]) throw new Error('CHARACTER_PANEL_POSE_REFERENCE_FORMAT_INVALID')
    const bytes = Buffer.from(match[1], 'base64')
    if (bytes.length === 0) throw new Error('CHARACTER_PANEL_POSE_REFERENCE_EMPTY')
    return bytes
}
