// AI Chat Thread Plugin - Complete Export
// This file exports all functionality from the AI chat thread plugin

// Export constants
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'

// Export all from node definitions
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadNode.ts'
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiResponseMessageNode.ts'

// Export setAiGeneratedImageCallbacks for workspace canvas integration
export { setAiGeneratedImageCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts'

// Export all from plugin
export * from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts'