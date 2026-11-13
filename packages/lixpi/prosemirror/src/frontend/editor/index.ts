// Product editor features for Lixpi documents: the AI chat thread, the AI
// prompt input, prompt references and their pickers, the view definitions of
// the core document kinds, and the services contract the host implements.
export * from '../plugins/ai-chat-thread/index.ts'
export * from '../plugins/ai-chat-thread/ai-chat-message-shells.ts'
export * from '../plugins/ai-chat-thread/ai-provider-icons.ts'
export * from '../plugins/ai-chat-thread/capability-chat-run-progress.ts'
export * from '../plugins/ai-chat-thread/image-generation-trace-details.ts'
export * from '../plugins/ai-chat-thread/insert-ai-chat-thread.ts'
export * from '../plugins/ai-prompt-input/index.ts'
export * from '../plugins/ai-prompt-input/prompt-model-controls.ts'
export * from '../plugins/prompt-reference/index.ts'
export * from './editor-services.ts'
export * from './editor-views.ts'
export * from './read-only-ai-chat-thread.ts'
export { type WorkspacePromptCatalog } from './workspace-prompt-catalog.ts'
export * from './editor-host-ports.ts'

export {
    createPromptComposerHandle,
    type PromptComposerHandle,
} from './prompt-composer-handle.ts'

export { PromptInputSurface } from '../plugins/ai-prompt-input/prompt-input-surface.ts'
