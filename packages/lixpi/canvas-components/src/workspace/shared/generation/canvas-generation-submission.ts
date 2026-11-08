import {
    type AiInteractionMediaGenerationRequest,
} from '@lixpi/constants'

export type CanvasGenerationSubmitOptions = {
    explicitContextNodeIds?: string[]
    excludedCanvasNodeIds?: string[]
    regeneration?: NonNullable<AiInteractionMediaGenerationRequest['regeneration']>
}
