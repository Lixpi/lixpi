import {
    type Schema,
    type Node as ProseMirrorNode,
    type NodeSpec,
} from 'prosemirror-model'
import {
    buildDocumentKindSchema,
    createFilledDocument,
    type DocumentKindDefinition,
} from './document-kind.ts'

export type NestedListJsonValue = string | number | boolean | null | NestedListJsonValue[] | { [key: string]: NestedListJsonValue }

export type NestedListDocumentJson = {
    type: string
    attrs?: Record<string, NestedListJsonValue>
    content?: NestedListDocumentJson[]
    text?: string
}

export const NESTED_LIST_KIND_ID = 'nestedList'
export const NESTED_LIST_SCHEMA_VERSION = 'nested-list-v1'
export const PLAIN_LIST_ITEM_TYPE = 'text'

const blockAttributes = { entryId: { default: null } }
const itemAttributes = {
    ...blockAttributes,
    itemType: { default: PLAIN_LIST_ITEM_TYPE },
    data: { default: null },
    tagIds: { default: [] },
}

export const nestedListNodes: Record<string, NodeSpec> = {
    paragraph: {
        group: 'block',
        attrs: {
            ...blockAttributes,
            bold: { default: false },
        },
        content: 'text*',
        marks: '',
        parseDOM: [{
            tag: 'p',
            getAttrs: (dom: HTMLElement) => ({ bold: dom.dataset.nestedListBold === 'true' }),
        }],
        toDOM: node => ['p', node.attrs.bold ? { 'data-nested-list-bold': 'true' } : {}, 0],
    },
    heading: {
        group: 'block',
        attrs: {
            ...blockAttributes,
            level: { default: 1 },
            bold: { default: false },
        },
        content: 'text*',
        marks: '',
        defining: true,
        parseDOM: [1, 2, 3].map(
            level => ({
                tag: `h${level}`,
                getAttrs: (dom: HTMLElement) => ({
                    level,
                    bold: dom.dataset.nestedListBold === 'true',
                }),
            }),
        ),
        toDOM: node => [`h${node.attrs.level}`, node.attrs.bold ? { 'data-nested-list-bold': 'true' } : {}, 0],
    },
    bullet_list: {
        group: 'block',
        attrs: blockAttributes,
        content: 'list_item+',
        parseDOM: [{ tag: 'ul' }],
        toDOM: () => ['ul', 0],
    },
    list_item: {
        attrs: itemAttributes,
        content: 'paragraph bullet_list*',
        defining: true,
        parseDOM: [{ tag: 'li' }],
        toDOM: () => ['li', 0],
    },
    section: {
        group: 'block',
        attrs: itemAttributes,
        content: 'paragraph (paragraph | heading | bullet_list)*',
        defining: true,
        isolating: true,
        parseDOM: [{ tag: 'section[data-nested-list-section]' }],
        toDOM: () => ['section', { 'data-nested-list-section': 'true' }, 0],
    },
    text: {},
}

const assertJson = (value: unknown): void => {
    if (
        value === null
        || typeof value === 'string'
        || typeof value === 'boolean'
    )
        return

    if (
        typeof value === 'number'
        && Number.isFinite(value)
    )
        return

    if (Array.isArray(value)) {
        value.forEach(assertJson)

        return
    }

    if (
        typeof value === 'object'
        && value
        && Object.getPrototypeOf(value) === Object.prototype
    ) {
        Object.values(value).forEach(assertJson)

        return
    }

    throw new Error('Nested list data must be JSON')
}

export const assertNestedListDocument = (doc: ProseMirrorNode): void => {
    const ids = new Set<string>()
    doc.check()
    doc.descendants(node => {
        if (node.isText)
            return

        const id = node.attrs.entryId

        if (
            id !== null
            && (typeof id !== 'string' || !id || ids.has(id))
        )
            throw new Error('Nested list entry IDs must be unique nonempty strings')

        if (id)
            ids.add(id)

        if (
            node.type.name === 'heading'
            && ![1, 2, 3].includes(node.attrs.level)
        )
            throw new Error('Unsupported nested list heading level')

        if (
            (node.type.name === 'paragraph' || node.type.name === 'heading')
            && typeof node.attrs.bold !== 'boolean'
        )
            throw new Error('Nested list bold must be a boolean')

        if (
            node.type.name === 'list_item'
            || node.type.name === 'section'
        ) {
            if (
                typeof node.attrs.itemType !== 'string'
                || !node.attrs.itemType
            )
                throw new Error('Nested list item type is required')

            if (
                !Array.isArray(node.attrs.tagIds)
                || node.attrs.tagIds.some((id: unknown) => typeof id !== 'string')
            )
                throw new Error('Nested list tag IDs must be strings')

            assertJson(node.attrs.data)
        }
    })
}

// Native paste and Enter can otherwise lift text by splitting one list into two.
export const preservesNestedListBoundaries = (
    previous: ProseMirrorNode,
    proposed: ProseMirrorNode,
): boolean => {
    const origins = new Map<string, ProseMirrorNode>()
    previous.descendants(node => {
        if (node.type.name === 'bullet_list')
            node.forEach(item => origins.set(item.attrs.entryId, node))
    })
    let valid = true
    const inspect = (container: ProseMirrorNode): void => {
        if (
            container.type.name !== 'doc'
            && container.type.name !== 'section'
        )
            return

        const seen = new Set<ProseMirrorNode>()
        const separated = new Set<ProseMirrorNode>()
        container.forEach(child => {
            if (child.type.name !== 'bullet_list') {
                seen.forEach(origin => separated.add(origin))

                return
            }

            child.forEach(item => {
                const origin = origins.get(item.attrs.entryId)

                if (!origin)
                    return

                if (separated.has(origin))
                    valid = false

                seen.add(origin)
            })
        })
    }
    inspect(proposed)
    proposed.descendants(inspect)

    return valid
}

export const nestedListKind: DocumentKindDefinition = {
    id: NESTED_LIST_KIND_ID,
    schemaVersion: NESTED_LIST_SCHEMA_VERSION,
    bundles: [{
        id: 'nested-list',
        nodes: nestedListNodes,
    }],
    topNode: {
        content: 'block+',
        marks: '',
    },
    createEmptyDocument: createFilledDocument,
    assertInitialDocument: assertNestedListDocument,
}

export const createNestedListSchema = (): Schema => buildDocumentKindSchema(nestedListKind)

// Identifies structural blocks without changing custom item bindings.
export const identifyNestedListDocument = (
    doc: ProseMirrorNode,
    createId: () => string = () => crypto.randomUUID(),
): ProseMirrorNode => {
    const ids = new Set<string>()
    const visit = (node: ProseMirrorNode): ProseMirrorNode => {
        if (node.isText)
            return node

        const children: ProseMirrorNode[] = []
        node.forEach(
            child => children.push(
                visit(child),
            ),
        )
        let attrs = node.attrs

        if (
            node.type !== node.type.schema.topNodeType
            && 'entryId' in attrs
        ) {
            const id = attrs.entryId

            if (
                !id
                || ids.has(id)
            ) {
                if (
                    id
                    && (node.type.name === 'list_item' || node.type.name === 'section')
                    && attrs.itemType !== PLAIN_LIST_ITEM_TYPE
                )
                    throw new Error('Duplicate custom item identity')

                attrs = {
                    ...attrs,
                    entryId: createId(),
                }
            }

            ids.add(attrs.entryId)
        }

        return node.type.create(
            attrs,
            children,
            node.marks,
        )
    }

    return visit(doc)
}

export const parseNestedListDocument = (
    json: unknown,
    schema: Schema = createNestedListSchema(),
): ProseMirrorNode => {
    const doc = schema.nodeFromJSON(json)
    assertNestedListDocument(doc)

    return identifyNestedListDocument(doc)
}

export const emptyNestedListDocument = (): NestedListDocumentJson => ({
    type: 'doc',
    content: [{ type: 'paragraph' }],
})
