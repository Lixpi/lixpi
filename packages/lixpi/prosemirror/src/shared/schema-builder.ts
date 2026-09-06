import {
    Schema,
    type NodeSpec,
} from 'prosemirror-model'
import { schema } from './base-schema.ts'
import {
    aiChatNodeSpecs,
    aiChatThreadNodeType,
    aiPromptInputNodeSpec,
    aiPromptInputNodeType,
    customNodeSpecs,
} from './node-specs.ts'

export const DOCUMENT_TYPE = {
    AI_PROMPT_INPUT: 'aiPromptInput',
    ASSET_CONTENT: 'assetContent',
    ASSET_CONVERSATION: 'assetConversation',
    ASSET_PROVENANCE: 'assetProvenance',
    ASSET_TITLE: 'assetTitle',
    ASSET_METADATA: 'assetMetadata',
} as const

export const PROSEMIRROR_SCHEMA_VERSION = 'prosemirror-schema-v1'

export type ProseMirrorDocumentType = typeof DOCUMENT_TYPE[keyof typeof DOCUMENT_TYPE]

export const nodesBuilder = (
    baseSchema: Schema = schema,
    supportedNodes: Record<string, NodeSpec>,
    documentType: ProseMirrorDocumentType | string,
) => {
    const nodesKeys = Object.keys(supportedNodes)
    const docContent = getDocContent(documentType)

    let extendedSchema = baseSchema.spec.nodes.update(
        'doc',
        {
            content: docContent,
            marks: '_',
        },
    )

    for (const nodeKey of nodesKeys) {
        const spec = supportedNodes[nodeKey]

        if (!spec)
            continue

        if (extendedSchema.get(nodeKey))
            extendedSchema = extendedSchema.update(nodeKey, spec)
        else
            extendedSchema = extendedSchema.addBefore(
                'paragraph',
                nodeKey,
                spec,
            )
    }

    return extendedSchema
}

export const createProseMirrorSchema = (documentType: ProseMirrorDocumentType | string = DOCUMENT_TYPE.ASSET_CONTENT): Schema => {
    return new Schema({
        nodes: nodesBuilder(
            schema,
            getSupportedNodes(documentType),
            documentType,
        ),
        marks: schema.spec.marks,
    })
}

export function getSupportedNodes(documentType: ProseMirrorDocumentType | string): Record<string, NodeSpec> {
    if (
        documentType === DOCUMENT_TYPE.ASSET_CONVERSATION
        || documentType === DOCUMENT_TYPE.ASSET_PROVENANCE
    ) {
        return {
            ...customNodeSpecs,
            ...aiChatNodeSpecs,
        }
    }

    if (documentType === DOCUMENT_TYPE.AI_PROMPT_INPUT) {
        return {
            [aiPromptInputNodeType]: aiPromptInputNodeSpec,
        }
    }

    return { ...customNodeSpecs }
}

function getDocContent(documentType: ProseMirrorDocumentType | string): string {
    if (
        documentType === DOCUMENT_TYPE.ASSET_CONVERSATION
        || documentType === DOCUMENT_TYPE.ASSET_PROVENANCE
    )
        return `${aiChatThreadNodeType}+`

    if (documentType === DOCUMENT_TYPE.ASSET_CONTENT)
        return 'block+'

    if (documentType === DOCUMENT_TYPE.ASSET_TITLE)
        return 'documentTitle'

    if (documentType === DOCUMENT_TYPE.ASSET_METADATA)
        return 'documentTitle paragraph'

    if (documentType === DOCUMENT_TYPE.AI_PROMPT_INPUT)
        return aiPromptInputNodeType

    throw new Error(`Unsupported ProseMirror document type: ${documentType}`)
}
