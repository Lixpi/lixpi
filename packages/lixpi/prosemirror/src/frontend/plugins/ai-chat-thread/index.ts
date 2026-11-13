// AI Chat Thread Plugin - Complete Export
// This file exports all functionality from the AI chat thread plugin

// Export constants
export * from './ai-chat-thread-plugin-constants.ts'

// Export all from node definitions
export * from './ai-chat-thread-node.ts'
export * from './ai-response-message-node.ts'
export * from './ai-user-message-node.ts'

// Export aiGeneratedVideo node for schema and NodeView registration
export {
    aiGeneratedVideoNodeType,
    aiGeneratedVideoNodeSpec,
    aiGeneratedVideoNodeView,
} from './ai-generated-video-node.ts'

// Export aiCollapsibleBlock node for schema and NodeView registration
export {
    aiCollapsibleBlockNodeType,
    aiCollapsibleBlockNodeSpec,
    aiCollapsibleBlockNodeView,
} from './ai-collapsible-block-node.ts'

// Export aiReasoningSection node (per-model slice of a multi-model response)
export {
    aiReasoningSectionNodeType,
    aiReasoningSectionNodeSpec,
    aiReasoningSectionNodeView,
} from './ai-reasoning-section-node.ts'

// Export aiLineageEvent node for projection-time workflow markers
export {
    aiLineageEventNodeType,
    aiLineageEventNodeSpec,
    aiLineageEventNodeView,
} from './ai-lineage-event-node.ts'

export {
    aiMediaGenerationProgressNodeType,
    aiMediaGenerationProgressNodeSpec,
    aiMediaGenerationProgressNodeView,
    type AiMediaGenerationProgressRenderer,
} from './ai-media-generation-progress-node.ts'

export * from './ai-lineage-events.ts'

// Export all from plugin
export * from './ai-chat-thread-plugin.ts'
