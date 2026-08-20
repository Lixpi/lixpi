// AI Chat Thread Plugin - Complete Export
// This file exports all functionality from the AI chat thread plugin

// Export constants
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'

// Export all from node definitions
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadNode.ts'
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiResponseMessageNode.ts'
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserMessageNode.ts'

// Export aiGeneratedImage node for schema and NodeView registration
export {
    aiGeneratedImageNodeType,
    aiGeneratedImageNodeSpec,
    aiGeneratedImageNodeView,
    setAiGeneratedImageCallbacks,
    getAiGeneratedImageCallbacks
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts'

// Export aiGeneratedVideo node for schema and NodeView registration
export {
    aiGeneratedVideoNodeType,
    aiGeneratedVideoNodeSpec,
    aiGeneratedVideoNodeView,
    setAiGeneratedVideoCallbacks,
    getAiGeneratedVideoCallbacks
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedVideoNode.ts'

// Export aiCollapsibleBlock node for schema and NodeView registration
export {
    aiCollapsibleBlockNodeType,
    aiCollapsibleBlockNodeSpec,
    aiCollapsibleBlockNodeView
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiCollapsibleBlockNode.ts'

// Export aiReasoningSection node (per-model slice of a multi-model response)
export {
    aiReasoningSectionNodeType,
    aiReasoningSectionNodeSpec,
    aiReasoningSectionNodeView
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiReasoningSectionNode.ts'

// Export aiLineageEvent node for projection-time workflow markers
export {
    aiLineageEventNodeType,
    aiLineageEventNodeSpec,
    aiLineageEventNodeView
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEventNode.ts'

export {
    aiMediaGenerationProgressNodeType,
    aiMediaGenerationProgressNodeSpec,
    aiMediaGenerationProgressNodeView,
    type AiMediaGenerationProgressRenderer,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiMediaGenerationProgressNode.ts'

export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEvents.ts'

// Export all from plugin
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts'
