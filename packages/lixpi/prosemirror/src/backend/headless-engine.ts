import {
    type Node as ProseMirrorNode,
    type Schema,
} from 'prosemirror-model'
import {
    EditorState,
    type Transaction,
} from 'prosemirror-state'
import { Step } from 'prosemirror-transform'
import {
    createProseMirrorSchema,
    type ProseMirrorDocumentType,
} from '../shared/schema-builder.ts'

export type HeadlessProseMirrorEngineConfig = {
    documentType: ProseMirrorDocumentType | string
    schema?: Schema
    doc?: object
    version?: number
}

export type AppliedStepResult = {
    transaction: Transaction
    doc: ProseMirrorNode
    version: number
}

export class HeadlessProseMirrorEngine {
    readonly schema: Schema
    private editorState: EditorState
    private currentVersion: number

    constructor(config: HeadlessProseMirrorEngineConfig) {
        this.schema = config.schema ?? createProseMirrorSchema(config.documentType)
        const doc = this.createDoc(config.doc)
        this.editorState = EditorState.create({ doc })
        this.currentVersion = config.version ?? 0
    }

    get state(): EditorState {
        return this.editorState
    }

    get version(): number {
        return this.currentVersion
    }

    get doc(): ProseMirrorNode {
        return this.editorState.doc
    }

    applyStepJson(stepJson: object): AppliedStepResult {
        const step = Step.fromJSON(this.schema, stepJson)
        const transaction = this.editorState.tr.step(step)
        return this.applyTransaction(transaction)
    }

    applyTransaction(transaction: Transaction): AppliedStepResult {
        this.editorState = this.editorState.apply(transaction)
        this.currentVersion += transaction.steps.length
        return {
            transaction,
            doc: this.editorState.doc,
            version: this.currentVersion,
        }
    }

    snapshot(): object {
        return this.editorState.doc.toJSON()
    }

    private createDoc(docJson: object | undefined): ProseMirrorNode {
        if (docJson) {
            const doc = this.schema.nodeFromJSON(docJson)
            doc.check()
            return doc
        }

        const doc = this.schema.nodes.doc.createAndFill()
        if (!doc) {
            throw new Error('Unable to create a schema-valid ProseMirror document')
        }
        doc.check()
        return doc
    }
}
