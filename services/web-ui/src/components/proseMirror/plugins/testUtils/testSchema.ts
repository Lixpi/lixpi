import { Schema } from 'prosemirror-model'
import { nodes, marks } from '$src/components/proseMirror/components/schema.ts'
import { aiGeneratedImageNodeSpec } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts'
import { aiGeneratedVideoNodeSpec } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedVideoNode.ts'
import { aiChatThreadNodeSpec } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadNode.ts'
import { aiCollapsibleBlockNodeSpec } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiCollapsibleBlockNode.ts'
import { aiReasoningSectionNodeSpec } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiReasoningSectionNode.ts'
import { aiResponseMessageNodeSpec } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiResponseMessageNode.ts'
import { aiUserMessageNodeSpec } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserMessageNode.ts'
import { aiPromptInputNodeSpec } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'

// Test schema that includes all node types needed for image and bubble menu testing
// This combines:
// - Standard document nodes (paragraph, heading, etc.)
// - Regular image node
// - AI-generated image node
// - AI chat thread nodes (for testing images in chat context)

export const testSchema = new Schema({
    nodes: {
        doc: {
            // Allow both regular blocks and AI chat threads at top level
            content: '(block | aiChatThread)+'
        },
        paragraph: nodes.paragraph,
        heading: nodes.heading,
        blockquote: nodes.blockquote,
        code_block: nodes.code_block,
        horizontal_rule: nodes.horizontal_rule,
        hard_break: nodes.hard_break,
        text: nodes.text,

        // Regular image node
        image: nodes.image,
        capability_reference: nodes.capability_reference,

        // AI-generated image node (used inside aiResponseMessage)
        aiGeneratedImage: aiGeneratedImageNodeSpec,
        // AI-generated video node (used inside aiResponseMessage)
        aiGeneratedVideo: aiGeneratedVideoNodeSpec,
        aiCollapsibleBlock: aiCollapsibleBlockNodeSpec,
        aiReasoningSection: aiReasoningSectionNodeSpec,

        // AI chat thread nodes
        aiChatThread: aiChatThreadNodeSpec,
        aiResponseMessage: aiResponseMessageNodeSpec,
        aiUserMessage: aiUserMessageNodeSpec,

        // AI prompt input node (standalone floating prompt)
        aiPromptInput: aiPromptInputNodeSpec,
    },
    marks: marks
})

export type TestSchema = typeof testSchema
