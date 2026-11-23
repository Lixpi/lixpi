import {
    type AiInteractionMediaGenerationRequest,
} from '@lixpi/constants'

export type CanvasGenerationSubmitOptions = {
    sourceConversationAssetId?: string
    sourceGenerationRequestId?: string
    explicitContextNodeIds?: string[]
    excludedCanvasNodeIds?: string[]
    regeneration?: NonNullable<AiInteractionMediaGenerationRequest['regeneration']>
}
