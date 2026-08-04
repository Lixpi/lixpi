'use strict'

import sharp from 'sharp'

import type { CharacterPanelSpec } from '../../shared/character-sheet-media-plan.ts'
import type { CapabilityMediaExecutionContext } from '../../../../backend/capability-media-strategy.ts'
import type {
    CharacterImageGenerationPort,
    CharacterImageReference,
} from './runtime-ports.ts'

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
    anchors: Array<{ panelId: string; bytes: Buffer }>
    signal?: AbortSignal
}): Promise<CharacterPanelRenderResult> {
    const anchorReferences: CharacterImageReference[] = args.anchors.map((anchor, index) => ({
        url: `data:image/png;base64,${anchor.bytes.toString('base64')}`,
        role: index === 0 ? 'canonical-anchor' : 'adjacent-angle',
        fileName: `${anchor.panelId}.png`,
    }))
    const result = await args.imageGeneration.generate({
        context: args.context,
        plan: args.plan,
        operationKey: `${args.plan.capabilityRunId}:${args.panel.panelId}:${args.attempt}`,
        usageMode: 'character-creator',
        prompt: args.prompt,
        references: [...args.references, ...anchorReferences],
        signal: args.signal,
    })
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
    return [
        `Render one isolated ${args.panel.crop} character panel: ${args.panel.target}.`,
        args.userPrompt,
        args.evidenceSummary,
        'One character only. Plain white background. No text, labels, borders, grids, watermarks, or layout elements.',
        'Preserve observed identity, proportions, clothing construction, materials, accessories, and rendering medium.',
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
