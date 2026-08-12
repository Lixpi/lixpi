'use strict'

import { createHash } from 'node:crypto'

import { info } from '@lixpi/debug-tools'
import sharp from 'sharp'

import {
    CHARACTER_BACK_ANCHOR_BINDING_KEY,
    CHARACTER_IDENTITY_ANCHOR_BINDING_KEY,
    CHARACTER_OUTFIT_ANCHOR_BINDING_KEY,
    type CharacterPanelOutputBinding,
    type CharacterPanelSpec,
} from '../../shared/character-sheet-media-plan.ts'
import type { CapabilityMediaExecutionContext } from '../../../../backend/capability-media-strategy.ts'
import type {
    CharacterImageGenerationPort,
    CharacterImageReference,
} from './runtime-ports.ts'
import type { CharacterSourceMedium } from './character-evidence.ts'
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
    onImagePartial?: (imageBase64: string, providerPartialIndex: number) => Promise<void>
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
        info(`[CharacterCreatorShot:${args.context.generationRequestId}:${args.panel.panelId}:${args.attempt}] no-pose-control ${JSON.stringify({
            mediaRunId: args.context.mediaRunId,
            panelId: args.panel.panelId,
            target: args.panel.target,
            identityReferenceRoles: args.references.map(reference => reference.role),
        })}`)
    }
    const result = await args.imageGeneration.generate({
        context: args.context,
        plan: args.plan,
        operationKey: `${args.context.mediaRunId}:${args.plan.capabilityRunId}:${args.panel.panelId}:${args.attempt}`,
        usageMode: 'character-creator',
        prompt: args.prompt,
        references: poseReference ? [poseReference, ...args.references] : args.references,
        ...(args.onImagePartial ? { onImagePartial: args.onImagePartial } : {}),
        signal: args.signal,
    })
    if (poseReference && !result.includedReferenceRoles.includes('pose-reference')) {
        throw new Error(`CHARACTER_PANEL_POSE_REFERENCE_OMITTED:${args.panel.panelId}`)
    }
    const requiredGeneratedReferenceRoles = new Set(args.panel.outputBindings
        .filter(binding => binding.required)
        .map(binding => binding.referenceRole))
    for (const role of requiredGeneratedReferenceRoles) {
        if (!result.includedReferenceRoles.includes(role)) {
            throw new Error(`CHARACTER_PANEL_GENERATED_REFERENCE_OMITTED:${args.panel.panelId}:${role}`)
        }
    }
    info(`[CharacterCreatorShot:${args.context.generationRequestId}:${args.panel.panelId}:${args.attempt}] provider-result ${JSON.stringify({
        includedReferenceRoles: result.includedReferenceRoles,
        omittedReferenceRoles: result.omittedReferenceRoles,
        providerOperationId: result.providerOperationId ?? '',
    })}`)
    const providerBytes = decodeGeneratedImage(result.image)
    const bytes = await normalizeGeneratedPanel(providerBytes)
    return {
        bytes,
        providerOperationId: result.providerOperationId,
        includedReferenceRoles: result.includedReferenceRoles,
        omittedReferenceRoles: result.omittedReferenceRoles,
    }
}

const normalizeGeneratedPanel = async (bytes: Buffer): Promise<Buffer> => {
    try {
        const metadata = await sharp(bytes).metadata()
        if (!metadata.width || !metadata.height || metadata.width < 128 || metadata.height < 128) {
            throw new Error('dimensions')
        }
        return await sharp(bytes)
            .rotate()
            .png({ compressionLevel: 9 })
            .toBuffer()
    } catch (error) {
        throw new Error(`CHARACTER_PANEL_PROVIDER_OUTPUT_INVALID:${(error as Error).message}`)
    }
}

export function buildCharacterPanelPrompt(args: {
    panel: CharacterPanelSpec
    authoritativePrompt: string
    sourceMedium: CharacterSourceMedium
    sourceEvidenceSummary: string
    promptDirectives: readonly string[]
    sourceSubjectIdentityClassifications: CapabilityMediaExecutionContext['sharedState']['sourceSubjectIdentityClassifications']
    capabilityInstructions: readonly string[]
    capabilityReferenceCount: number
    generatedReferenceBindings: readonly CharacterPanelOutputBinding[]
}): string {
    const usesPoseReference = hasCharacterPoseReference(args.panel)
    const isSelfReference = args.sourceSubjectIdentityClassifications.includes('self')
    const usesGeneratedIdentityAnchor = args.generatedReferenceBindings.some(binding => (
        binding.bindingKey === CHARACTER_IDENTITY_ANCHOR_BINDING_KEY
    ))
    const usesGeneratedOutfitAnchor = args.generatedReferenceBindings.some(binding => (
        binding.bindingKey === CHARACTER_OUTFIT_ANCHOR_BINDING_KEY
    ))
    const usesGeneratedBackOutfitAnchor = args.generatedReferenceBindings.some(binding => (
        binding.bindingKey === CHARACTER_BACK_ANCHOR_BINDING_KEY
    ))
    const usesGeneratedReferences = args.generatedReferenceBindings.length > 0
    const poseInstruction = !usesPoseReference
        ? args.panel.kind === 'head'
            ? usesGeneratedReferences
                ? 'No synthetic facial or portrait control image is provided. Use the generated identity and outfit anchors for complementary request-compliant continuity, use the original subject references for unchanged evidence absent from both anchors, and use the request for the required design, camera angle, and body context.'
                : 'No synthetic facial or portrait control image is provided. Use only the prompt and original subject references for facial anatomy, sex presentation, identity, hair, headwear, expression, camera angle, and body context; create the requested neutral head view directly.'
            : usesGeneratedReferences
                ? 'No synthetic spatial control image is provided for this detail shot. Use the generated identity and outfit anchors for request-compliant continuity, the original subject references for unchanged evidence absent from both anchors, and the prompt for requested design changes, camera angle, and framing.'
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
        'AUTHORITATIVE REQUEST — APPLY EVERY PART OF IT',
        args.authoritativePrompt,
        args.capabilityInstructions.length > 0
            ? `SHARED CAPABILITY INSTRUCTIONS — APPLY THEM TO THIS SAME OUTPUT\n${args.capabilityInstructions.join('\n\n')}`
            : '',
        args.promptDirectives.length > 0
            ? `EXPLICIT REQUESTED CHANGES\n${args.promptDirectives.map(directive => `- ${directive}`).join('\n')}`
            : '',
        isSelfReference
            ? 'SELF-REFERENCE CONTEXT — The supplied source Asset is classified as the requesting user’s own identity. This is a transformation of their supplied reference; preserve recognizability while applying every requested visible change. This context does not override provider safety requirements.'
            : '',
        buildSourceMediumInstruction(args.sourceMedium),
        'INPUT ROLES',
        usesGeneratedIdentityAnchor
            ? 'The file GENERATED_IDENTITY_ANCHOR.png is the facial identity, hair, headwear, and close-detail continuity anchor only when it complies with the authoritative request and shared Capability instructions. If it omitted or weakened an explicit requested change, correct that failure instead of copying it.'
            : 'The original source image or images define the baseline person or character. Preserve recognizable identity and every observed trait that the authoritative request and shared Capability instructions do not change.',
        usesGeneratedOutfitAnchor
            ? 'The file GENERATED_OUTFIT_ANCHOR.png is the full-body proportions, outfit construction, layer, accessory, color, material, and footwear continuity anchor only when it complies with the authoritative request and shared Capability instructions. Preserve its complete request-compliant outfit across this view.'
            : '',
        usesGeneratedBackOutfitAnchor
            ? 'The file GENERATED_BACK_OUTFIT_ANCHOR.png is the rear garment construction, rear layers, back-facing accessories, rear materials, and back-of-footwear continuity anchor only when it complies with the authoritative request and shared Capability instructions. Preserve its request-compliant rear design wherever this view exposes it.'
            : '',
        usesGeneratedReferences
            ? 'The original source image or images remain baseline evidence for unchanged details absent from the generated anchors. They never override an explicit requested transformation or design change.'
            : '',
        args.capabilityReferenceCount > 0
            ? `The files CAPABILITY_REFERENCE_1 through CAPABILITY_REFERENCE_${args.capabilityReferenceCount} belong to the same shared request state. Apply them only according to the shared Capability instructions. Do not copy their subject identity, pose, composition, text, or background unless those instructions explicitly require it.`
            : '',
        poseInstruction,
        usesPoseReference
            ? usesGeneratedReferences
                ? 'The pose file is spatial control, never identity or design evidence. Ignore its gray material, featureless face, anatomy, physique, sex presentation, clothing, lighting, and rendering style; the authoritative request defines all requested changes, the generated anchors supply complementary request-compliant continuity, and the original subject references supply unchanged evidence absent from both anchors.'
                : 'The pose file is spatial control, never identity or design evidence. Ignore its gray material, featureless face, anatomy, physique, sex presentation, clothing, lighting, and rendering style; the authoritative request defines all requested changes and the original subject references define only unchanged character traits.'
            : '',
        'SHOT CONTRACT',
        framingInstruction,
        'Use an eye-level studio camera with a normal focal-length perspective, minimal perspective distortion, level shoulders where applicable, and an upright head unless the user explicitly requests otherwise.',
        args.sourceEvidenceSummary
            ? `UNMODIFIED SOURCE EVIDENCE — BASELINE ONLY, OVERRIDDEN BY REQUESTED CHANGES\n${args.sourceEvidenceSummary}`
            : '',
        'INVARIANTS',
        'Apply every explicit transformation, design change, state change, material change, costume change, and stylistic instruction from the authoritative request and shared Capability instructions. Preserve source or anchor traits only where they are not changed by that shared request state. Never return the unmodified source appearance when a transformation was requested.',
        usesGeneratedReferences
            ? 'Maintain recognizable continuity with the request-compliant parts of every supplied generated anchor. Use the identity portrait for face-level identity, the front full-body anchor for proportions and frontal outfit continuity, and the back full-body anchor when supplied for rear outfit continuity, while correcting any part that conflicts with the authoritative request.'
            : 'Maintain recognizable underlying identity where the request permits it, while applying each requested change to every affected visible trait.',
        args.panel.kind === 'head'
            ? 'Keep a relaxed neutral expression with level gaze and a closed relaxed mouth. Neutral expression controls only facial pose; it must not suppress any requested visual attribute, state, design change, or transformation.'
            : '',
        'One character only on a pure white studio background. No text, letters, numbers, labels, headings, captions, borders, grids, swatches, logos, watermarks, scenery, or additional people.',
    ].filter(Boolean).join('\n')
}

const buildSourceMediumInstruction = (sourceMedium: CharacterSourceMedium): string => {
    if (sourceMedium === 'photograph') {
        return [
            'SOURCE DEPICTION MEDIUM — PHOTOGRAPH',
            'Preserve a realistic photographic depiction with natural human proportions, photographic skin and material texture, plausible lighting, and camera/lens behavior unless the authoritative request or shared Capability instructions explicitly request a different depiction medium or named visual style.',
            'A requested change to the subject, character state, design, or appearance does not by itself authorize a depiction-medium or visual-style change.',
        ].join('\n')
    }
    if (sourceMedium === 'illustration') {
        return 'SOURCE DEPICTION MEDIUM — ILLUSTRATION\nPreserve the source illustration medium and its established rendering language unless the authoritative request or shared Capability instructions explicitly request a different depiction medium or named visual style.'
    }
    if (sourceMedium === 'render') {
        return 'SOURCE DEPICTION MEDIUM — RENDER\nPreserve the source rendered medium and its established rendering language unless the authoritative request or shared Capability instructions explicitly request a different depiction medium or named visual style.'
    }
    return 'SOURCE DEPICTION MEDIUM — UNSPECIFIED\nDo not invent a depiction-medium or visual-style change. Apply one only when it is explicitly stated by the authoritative request or shared Capability instructions.'
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
