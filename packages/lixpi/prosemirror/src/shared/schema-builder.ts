import { Schema, type NodeSpec } from 'prosemirror-model'
import { schema } from './base-schema.ts'
import {
    aiChatNodeSpecs,
    aiChatThreadNodeType,
    aiPromptInputNodeSpec,
    aiPromptInputNodeType,
    customNodeSpecs,
    documentTitleNodeType,
} from './node-specs.ts'

export const DOCUMENT_TYPE = {
    DOCUMENT: 'document',
    AI_CHAT_THREAD: 'aiChatThread',
    AI_PROMPT_INPUT: 'aiPromptInput',
} as const

export const PROSEMIRROR_SCHEMA_VERSION = 'prosemirror-schema-v1'

export type ProseMirrorDocumentType = typeof DOCUMENT_TYPE[keyof typeof DOCUMENT_TYPE]

export function nodesBuilder(
    baseSchema: Schema = schema,
    supportedNodes: Record<string, NodeSpec>,
    documentType: ProseMirrorDocumentType | string,
) {
    const nodesKeys = Object.keys(supportedNodes)
    const docContent = getDocContent(documentType)

    let extendedSchema = baseSchema.spec.nodes.update('doc', {
        content: docContent,
        marks: '_',
    })

    for (const nodeKey of nodesKeys) {
        const spec = supportedNodes[nodeKey]
        if (!spec) continue
        if (extendedSchema.get(nodeKey)) {
            extendedSchema = extendedSchema.update(nodeKey, spec)
        } else {
            extendedSchema = extendedSchema.addBefore('paragraph', nodeKey, spec)
        }
    }

    return extendedSchema
}

export function createProseMirrorSchema(documentType: ProseMirrorDocumentType | string = DOCUMENT_TYPE.DOCUMENT): Schema {
    return new Schema({
        nodes: nodesBuilder(schema, getSupportedNodes(documentType), documentType),
        marks: schema.spec.marks,
    })
}

export function getSupportedNodes(documentType: ProseMirrorDocumentType | string): Record<string, NodeSpec> {
    if (documentType === DOCUMENT_TYPE.AI_CHAT_THREAD) {
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
    if (documentType === DOCUMENT_TYPE.AI_CHAT_THREAD) {
        return `${documentTitleNodeType} ${aiChatThreadNodeType}+`
    }
    if (documentType === DOCUMENT_TYPE.AI_PROMPT_INPUT) {
        return aiPromptInputNodeType
    }
    return `${documentTitleNodeType} block+`
}
