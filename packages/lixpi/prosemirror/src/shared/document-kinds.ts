import {
    marks as baseMarks,
    nodes as baseNodes,
} from './base-schema.ts'
import {
    createFilledDocument,
    DocumentKindRegistry,
    type DocumentKindDefinition,
    type SchemaBundle,
} from './document-kind.ts'
import {
    aiChatNodeSpecs,
    aiChatThreadNodeType,
    aiPromptInputNodeSpec,
    aiPromptInputNodeType,
    customNodeSpecs,
} from './node-specs.ts'
import {
    LEGACY_CAPABILITY_REFERENCE_NODE_TYPE,
    PROMPT_REFERENCE_NODE_TYPE,
} from './prompt-reference.ts'

// The ids of the product's document kinds. They match the document types the
// API and stored assets have always used.
export const DOCUMENT_TYPE = {
    AI_PROMPT_INPUT: 'aiPromptInput',
    ASSET_CONTENT: 'assetContent',
    ASSET_CONVERSATION: 'assetConversation',
    ASSET_PROVENANCE: 'assetProvenance',
    ASSET_TITLE: 'assetTitle',
    ASSET_METADATA: 'assetMetadata',
} as const

export type ProseMirrorDocumentType = typeof DOCUMENT_TYPE[keyof typeof DOCUMENT_TYPE]

export const PROSEMIRROR_SCHEMA_VERSION = 'prosemirror-schema-v1'

const {
    doc: _topNode,
    ...baseBlockNodes
} = baseNodes

// Paragraphs, headings, lists of blocks, images, inline text, prompt
// references and the base marks.
export const baseBlocksBundle: SchemaBundle = {
    id: 'base-blocks',
    nodes: baseBlockNodes,
    marks: baseMarks,
}

// The prompt reference atoms on their own, for kinds that build a smaller
// schema. The specs are the same objects base-blocks uses, so a kind may list
// both bundles.
export const promptReferenceBundle: SchemaBundle = {
    id: 'prompt-reference',
    nodes: {
        [PROMPT_REFERENCE_NODE_TYPE]: baseNodes[PROMPT_REFERENCE_NODE_TYPE as keyof typeof baseNodes],
        [LEGACY_CAPABILITY_REFERENCE_NODE_TYPE]: baseNodes[LEGACY_CAPABILITY_REFERENCE_NODE_TYPE as keyof typeof baseNodes],
    },
}

// The document title, task rows and the CodeMirror code block, which
// replaces the base code block.
export const customBlocksBundle: SchemaBundle = {
    id: 'custom-blocks',
    nodes: customNodeSpecs,
    overrides: ['code_block'],
}

// The conversation thread: messages, generated media, reasoning, lineage and
// generation progress.
export const aiChatBundle: SchemaBundle = {
    id: 'ai-chat',
    nodes: aiChatNodeSpecs,
}

export const aiPromptInputBundle: SchemaBundle = {
    id: 'ai-prompt-input',
    nodes: { [aiPromptInputNodeType]: aiPromptInputNodeSpec },
}

const kind = (
    id: string,
    bundles: SchemaBundle[],
    content: string,
): DocumentKindDefinition => ({
    id,
    schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
    bundles,
    topNode: { content },
    createEmptyDocument: createFilledDocument,
})

export const assetContentKind = kind(
    DOCUMENT_TYPE.ASSET_CONTENT,
    [baseBlocksBundle, customBlocksBundle],
    'block+',
)

export const assetTitleKind = kind(
    DOCUMENT_TYPE.ASSET_TITLE,
    [baseBlocksBundle, customBlocksBundle],
    'documentTitle',
)

export const assetMetadataKind = kind(
    DOCUMENT_TYPE.ASSET_METADATA,
    [baseBlocksBundle, customBlocksBundle],
    'documentTitle paragraph',
)

export const assetConversationKind = kind(
    DOCUMENT_TYPE.ASSET_CONVERSATION,
    [baseBlocksBundle, customBlocksBundle, aiChatBundle],
    `${aiChatThreadNodeType}+`,
)

export const assetProvenanceKind = kind(
    DOCUMENT_TYPE.ASSET_PROVENANCE,
    [baseBlocksBundle, customBlocksBundle, aiChatBundle],
    `${aiChatThreadNodeType}+`,
)

export const aiPromptInputKind = kind(
    DOCUMENT_TYPE.AI_PROMPT_INPUT,
    [baseBlocksBundle, aiPromptInputBundle],
    aiPromptInputNodeType,
)

// The six kinds every Lixpi application registers.
export const coreDocumentKinds: DocumentKindDefinition[] = [
    assetContentKind,
    assetTitleKind,
    assetMetadataKind,
    assetConversationKind,
    assetProvenanceKind,
    aiPromptInputKind,
]

// A registry holding the core kinds. Composition roots register their own
// kinds, such as Capability Artifacts, on top of it.
export const createCoreDocumentKindRegistry = (): DocumentKindRegistry => new DocumentKindRegistry(coreDocumentKinds)
