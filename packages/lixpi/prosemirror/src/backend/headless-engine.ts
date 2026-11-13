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
    type DocumentKindRegistry,
} from '../shared/document-kind.ts'

export type HeadlessProseMirrorEngineConfig = {
    registry: DocumentKindRegistry
    kindId: string
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

    constructor(private readonly config: HeadlessProseMirrorEngineConfig) {
        this.schema = config.registry.schema(config.kindId)
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
        return docJson
            ? this.config.registry.parse(this.config.kindId, docJson)
            : this.config.registry.createEmptyDocument(this.config.kindId)
    }
}
