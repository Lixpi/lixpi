'use strict'

import type {
    AiInteractionMediaGenerationRequest,
    CapabilityPromptReference,
} from '@lixpi/constants'

export const CHARACTER_CREATOR_TOOL_ID = 'global.character-creator'

const CHARACTER_CREATION_PATTERNS = [
    /\b(?:create|design|develop|make|generate|build|invent|draw|illustrate)\b(?:\s+\S+){0,10}\s+\bcharacter\b/i,
    /\bcharacter\s+(?:design|sheet|turnaround|model\s+sheet)\b/i,
    /\b(?:character|model)\s+turnaround\b/i,
] as const

export type CharacterCreatorRouting = {
    isCharacterCreator: boolean
    capabilityReferences: CapabilityPromptReference[] | undefined
}

export function isCharacterCreatorCapabilitySelected(
    capabilityReferences: CapabilityPromptReference[] | undefined,
): boolean {
    return capabilityReferences?.some(reference => (
        reference.kind === 'tool' && reference.capabilityId === CHARACTER_CREATOR_TOOL_ID
    )) ?? false
}

export function resolveCharacterCreatorRouting(
    prompt: string,
    capabilityReferences: CapabilityPromptReference[] | undefined,
): CharacterCreatorRouting {
    const references = capabilityReferences ?? []
    const explicitlySelected = isCharacterCreatorCapabilitySelected(references)
    const isCharacterCreator = explicitlySelected
        || CHARACTER_CREATION_PATTERNS.some(pattern => pattern.test(prompt))

    if (!isCharacterCreator || explicitlySelected) {
        return {
            isCharacterCreator,
            capabilityReferences,
        }
    }

    return {
        isCharacterCreator: true,
        capabilityReferences: [
            ...references,
            { capabilityId: CHARACTER_CREATOR_TOOL_ID, kind: 'tool' },
        ],
    }
}

export function restrictMediaRequestToCharacterImages(
    request: AiInteractionMediaGenerationRequest,
): AiInteractionMediaGenerationRequest {
    const imageOnlyRequest = { ...request }
    delete imageOnlyRequest.videoOptions
    return {
        ...imageOnlyRequest,
        outputMediaTypes: ['image'],
        useMultipleVideoModels: false,
        videoModelIds: [],
        ...(request.regeneration?.mode === 'existing-prompt'
            ? {
                regeneration: {
                    ...request.regeneration,
                    replayPrompts: request.regeneration.replayPrompts.filter(prompt => prompt.mediaType === 'image'),
                },
            }
            : {}),
    }
}
