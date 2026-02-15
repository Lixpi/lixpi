import { builders } from 'prosemirror-test-builder'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { testSchema } from '$src/components/proseMirror/plugins/testUtils/testSchema.ts'

// Create node builders using prosemirror-test-builder
// These provide a convenient way to construct test documents with position tags

const builderResult = builders(testSchema, {
    // Paragraph shorthand
    p: { nodeType: 'paragraph' },

    // Headings
    h1: { nodeType: 'heading', level: 1 },
    h2: { nodeType: 'heading', level: 2 },
    h3: { nodeType: 'heading', level: 3 },

    // Regular image with default attrs
    img: {
        nodeType: 'image',
        src: 'test-image.png',
        alt: 'Test image',
        alignment: 'left',
        textWrap: 'none',
        width: null,
    },

    // AI-generated image with default attrs
    aiImg: {
        nodeType: 'aiGeneratedImage',
        imageData: 'data:image/png;base64,test',
        alignment: 'left',
        textWrap: 'none',
        width: null,
        isPartial: false,
        fileId: 'test-file-id',
        revisedPrompt: 'Test prompt',
        responseId: 'test-response-id',
        aiModel: 'dall-e-3',
    },

    // AI chat thread nodes
    thread: {
        nodeType: 'aiChatThread',
        threadId: 'test-thread-id',
        aiModel: 'Anthropic:claude-3-5-sonnet',
    },

    response: {
        nodeType: 'aiResponseMessage',
        aiProvider: 'OpenAI',
        isReceivingAnimation: false,
        isInitialRenderAnimation: false,
    },

    userMsg: {
        nodeType: 'aiUserMessage',
    },

    userInput: {
        nodeType: 'aiUserInput',
    },

    // AI prompt input
    promptInput: {
        nodeType: 'aiPromptInput',
        aiModel: '',
        imageGenerationEnabled: false,
        imageGenerationSize: '1024x1024',
    },

    // Other blocks
    blockquote: { nodeType: 'blockquote' },
    codeBlock: { nodeType: 'code_block' },
    hr: { nodeType: 'horizontal_rule' },
})

// Export individual builders
export const { doc, p, h1, h2, h3, img, aiImg, thread, response, userMsg, userInput, promptInput, blockquote, codeBlock, hr } = builderResult
export const schema = builderResult.schema

// Helper to find position of a node by type
export function findNodePosition(doc: ProseMirrorNode, nodeType: string): number | null {
    let foundPos: number | null = null
    doc.descendants((node, pos) => {
        if (node.type.name === nodeType && foundPos === null) {
            foundPos = pos
            return false // Stop searching
        }
    })
    return foundPos
}

// Helper to find all positions of nodes by type
export function findAllNodePositions(doc: ProseMirrorNode, nodeType: string): number[] {
    const positions: number[] = []
    doc.descendants((node, pos) => {
        if (node.type.name === nodeType) {
            positions.push(pos)
        }
    })
    return positions
}

// Create EditorState with a document
export function createEditorState(doc: ProseMirrorNode): EditorState {
    return EditorState.create({ doc, schema: testSchema })
}

// Create EditorState with NodeSelection on a specific node
export function createStateWithNodeSelection(doc: ProseMirrorNode, nodePos: number): EditorState {
    return EditorState.create({
        doc,
        schema: testSchema,
        selection: NodeSelection.create(doc, nodePos),
    })
}

// Create EditorState with TextSelection
export function createStateWithTextSelection(doc: ProseMirrorNode, from: number, to: number): EditorState {
    return EditorState.create({
        doc,
        schema: testSchema,
        selection: TextSelection.create(doc, from, to),
    })
}

// Helper to select a node by type (returns new state with selection)
export function selectNodeByType(doc: ProseMirrorNode, nodeType: string): EditorState | null {
    const pos = findNodePosition(doc, nodeType)
    if (pos === null) return null
    return createStateWithNodeSelection(doc, pos)
}
