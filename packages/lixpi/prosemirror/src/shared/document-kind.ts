import {
    Schema,
    type AttributeSpec,
    type MarkSpec,
    type Node as ProseMirrorNode,
    type NodeSpec,
} from 'prosemirror-model'

// A named, reusable set of node and mark specs. A kind lists the bundles it
// uses, and the registry assembles them into one schema.
export type SchemaBundle = {
    id: string
    nodes: Record<string, NodeSpec>
    marks?: Record<string, MarkSpec>
    // Node names this bundle deliberately redefines. Any other name another
    // bundle already defines with a different spec is a conflict.
    overrides?: string[]
}

// The shared half of a document kind: everything a server or a browser needs
// to build, validate and create its documents.
export type DocumentKindDefinition = {
    id: string
    schemaVersion: string
    bundles: SchemaBundle[]
    topNode: {
        content: string
        attrs?: Record<string, AttributeSpec>
        marks?: string
    }
    createEmptyDocument: (schema: Schema) => ProseMirrorNode
    // Rejects a document that is not a valid starting point for this kind.
    assertInitialDocument?: (doc: ProseMirrorNode) => void
    // Rejects an edit that this kind does not allow.
    assertEditableMutation?: (
        previous: ProseMirrorNode,
        proposed: ProseMirrorNode,
    ) => void
}

const TOP_NODE = 'doc'

// Assembles a kind's nodes in the order the editor has always used: the top
// node first, then each bundle's nodes in order. A new node from a later
// bundle sits before `paragraph`, so a kind's own block nodes come first in
// their groups; a redefined node keeps the place of the node it replaces.
const assembleNodes = (kind: DocumentKindDefinition): Record<string, NodeSpec> => {
    const nodes: Array<[string, NodeSpec]> = [[
        TOP_NODE,
        {
            content: kind.topNode.content,
            marks: kind.topNode.marks ?? '_',
            ...(kind.topNode.attrs ? { attrs: kind.topNode.attrs } : {}),
        },
    ]]
    const indexOf = (name: string): number => nodes.findIndex(([nodeName]) => nodeName === name)
    const owners = new Map<string, {
        bundle: string
        spec: NodeSpec
    }>()

    for (const bundle of kind.bundles) {
        // New nodes from a bundle go before an earlier bundle's paragraph, in
        // the bundle's own order; the bundle that defines paragraph appends.
        const paragraph = indexOf('paragraph')
        let insertAt = paragraph < 0 ? -1 : paragraph

        for (const [name, spec] of Object.entries(bundle.nodes)) {
            if (name === TOP_NODE)
                throw new Error(`Bundle ${bundle.id} must not define the top node; kind ${kind.id} declares it`)

            const owner = owners.get(name)

            if (owner) {
                if (owner.spec === spec)
                    continue

                if (!bundle.overrides?.includes(name))
                    throw new Error(`Bundles ${owner.bundle} and ${bundle.id} define node ${name} differently`)

                nodes[indexOf(name)] = [name, spec]
            } else if (insertAt < 0)
                nodes.push([name, spec])
            else {
                nodes.splice(
                    insertAt,
                    0,
                    [name, spec],
                )
                insertAt += 1
            }

            owners.set(
                name,
                {
                    bundle: bundle.id,
                    spec,
                },
            )
        }
    }

    // Object keys keep insertion order, which Schema reads as node order.
    return Object.fromEntries(nodes)
}

const assembleMarks = (kind: DocumentKindDefinition): Record<string, MarkSpec> => {
    const marks: Record<string, MarkSpec> = {}
    const owners = new Map<string, {
        bundle: string
        spec: MarkSpec
    }>()

    for (const bundle of kind.bundles) {
        for (const [name, spec] of Object.entries(bundle.marks ?? {})) {
            const owner = owners.get(name)

            if (owner) {
                if (owner.spec === spec)
                    continue

                throw new Error(`Bundles ${owner.bundle} and ${bundle.id} define mark ${name} differently`)
            }

            marks[name] = spec
            owners.set(
                name,
                {
                    bundle: bundle.id,
                    spec,
                },
            )
        }
    }

    return marks
}

// Builds one kind's schema. Registries cache the result; call this directly
// only for a kind that is not registered anywhere.
export const buildDocumentKindSchema = (kind: DocumentKindDefinition): Schema =>
    new Schema({
        nodes: assembleNodes(kind),
        marks: assembleMarks(kind),
        topNode: TOP_NODE,
    })

// Holds the kinds one application, service or tool uses. Each composition
// root builds its own registry, so nothing global decides which kinds exist.
export class DocumentKindRegistry {
    private readonly kinds = new Map<string, DocumentKindDefinition>()
    private readonly schemas = new Map<string, Schema>()

    constructor(kinds: DocumentKindDefinition[] = []) {
        for (const kind of kinds)
            this.register(kind)
    }

    register(kind: DocumentKindDefinition): void {
        if (this.kinds.has(kind.id))
            throw new Error(`Document kind ${kind.id} is already registered`)

        // Building the schema here surfaces bundle conflicts at registration.
        const schema = buildDocumentKindSchema(kind)
        this.kinds.set(kind.id, kind)
        this.schemas.set(kind.id, schema)
    }

    has(kindId: string): boolean {
        return this.kinds.has(kindId)
    }

    require(kindId: string): DocumentKindDefinition {
        const kind = this.kinds.get(kindId)

        if (!kind)
            throw new Error(`Unknown document kind: ${kindId}`)

        return kind
    }

    // The kind's schema, built once at registration.
    schema(kindId: string): Schema {
        this.require(kindId)

        return this.schemas.get(kindId)!
    }

    // Parses a stored document, checks it against the schema and the kind's
    // own rules, and returns the node.
    parse(
        kindId: string,
        json: unknown,
    ): ProseMirrorNode {
        const kind = this.require(kindId)
        const doc = this.schema(kindId).nodeFromJSON(json)
        doc.check()
        kind.assertInitialDocument?.(doc)

        return doc
    }

    createEmptyDocument(kindId: string): ProseMirrorNode {
        const doc = this.require(kindId).createEmptyDocument(
            this.schema(kindId),
        )
        doc.check()

        return doc
    }

    ids(): string[] {
        return [...this.kinds.keys()]
    }
}

// Fills the top node with its smallest valid content.
export const createFilledDocument = (schema: Schema): ProseMirrorNode => {
    const doc = schema.topNodeType.createAndFill()

    if (!doc)
        throw new Error('Unable to create a schema-valid ProseMirror document')

    return doc
}
