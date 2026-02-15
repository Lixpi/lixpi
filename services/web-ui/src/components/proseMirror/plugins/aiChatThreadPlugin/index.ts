// AI Chat Thread Plugin - Complete Export
// This file exports all functionality from the AI chat thread plugin

// Export constants
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'

// Export all from node definitions
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadNode.ts'
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiResponseMessageNode.ts'
// aiUserInput is no longer exported — the composer is now the separate aiPromptInputPlugin
// The node type/spec remain in aiUserInputNode.ts for legacy content migration only
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserMessageNode.ts'

// Export aiGeneratedImage node for schema and NodeView registration
export {
    aiGeneratedImageNodeType,
    aiGeneratedImageNodeSpec,
    aiGeneratedImageNodeView,
    setAiGeneratedImageCallbacks,
    getAiGeneratedImageCallbacks
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts'

// Export all from plugin
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts'