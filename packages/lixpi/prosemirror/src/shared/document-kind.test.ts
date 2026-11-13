import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    DocumentKindRegistry,
    createFilledDocument,
    type DocumentKindDefinition,
    type SchemaBundle,
} from './document-kind.ts'
import {
    baseBlocksBundle,
    coreDocumentKinds,
    customBlocksBundle,
    promptReferenceBundle,
    DOCUMENT_TYPE,
} from './document-kinds.ts'
import { codeBlockNodeSpec } from './node-specs.ts'

// =============================================================================
// CORE KINDS
// =============================================================================

// Node order captured from the schema builder these kinds replaced. Order
// decides parse priority and default node choice, so it must not drift.
const BASE_TAIL = ['paragraph', 'blockquote', 'horizontal_rule', 'heading', 'code_block', 'text', 'image', 'hard_break', 'prompt_reference', 'capability_reference']
const AI_CHAT = ['aiChatThread', 'aiResponseMessage', 'aiUserMessage', 'aiGeneratedImage', 'aiGeneratedVideo', 'aiCollapsibleBlock', 'aiReasoningSection', 'aiLineageEvent', 'aiMediaGenerationProgress']
const expectedKinds = {
    [DOCUMENT_TYPE.ASSET_CONTENT]: {
        nodes: ['doc', 'documentTitle', 'taskRow', ...BASE_TAIL],
        doc: 'block+',
    },
    [DOCUMENT_TYPE.ASSET_TITLE]: {
        nodes: ['doc', 'documentTitle', 'taskRow', ...BASE_TAIL],
        doc: 'documentTitle',
    },
    [DOCUMENT_TYPE.ASSET_METADATA]: {
        nodes: ['doc', 'documentTitle', 'taskRow', ...BASE_TAIL],
        doc: 'documentTitle paragraph',
    },
    [DOCUMENT_TYPE.ASSET_CONVERSATION]: {
        nodes: ['doc', 'documentTitle', 'taskRow', ...AI_CHAT, ...BASE_TAIL],
        doc: 'aiChatThread+',
    },
    [DOCUMENT_TYPE.ASSET_PROVENANCE]: {
        nodes: ['doc', 'documentTitle', 'taskRow', ...AI_CHAT, ...BASE_TAIL],
        doc: 'aiChatThread+',
    },
    [DOCUMENT_TYPE.AI_PROMPT_INPUT]: {
        nodes: ['doc', 'aiPromptInput', ...BASE_TAIL],
        doc: 'aiPromptInput',
    },
}

describe('core document kinds', () => {
    const registry = new DocumentKindRegistry(coreDocumentKinds)

    for (const [kindId, expected] of Object.entries(expectedKinds))
        it(`${kindId} keeps the node set, order, marks and top content of the schema it replaced`, () => {
            const schema = registry.schema(kindId)

            expect(Object.keys(schema.nodes)).toEqual(expected.nodes)
            expect(Object.keys(schema.marks)).toEqual(['link', 'em', 'strikethrough', 'strong', 'code'])
            expect(schema.nodes.doc.spec).toEqual({
                content: expected.doc,
                marks: '_',
            })
            expect(registry.createEmptyDocument(kindId).type.name).toBe('doc')
        })

    it('replaces the base code block with the CodeMirror code block in asset kinds', () => {
        expect(registry.schema(DOCUMENT_TYPE.ASSET_CONTENT).nodes.code_block.spec).toBe(codeBlockNodeSpec)
        expect(registry.schema(DOCUMENT_TYPE.AI_PROMPT_INPUT).nodes.code_block.spec).not.toBe(codeBlockNodeSpec)
    })
})

// =============================================================================
// REGISTRY
// =============================================================================

const smallKind = (
    id: string,
    bundles: SchemaBundle[],
    overrides: Partial<DocumentKindDefinition> = {},
): DocumentKindDefinition => ({
    id,
    schemaVersion: 'test-v1',
    bundles,
    topNode: { content: 'block+' },
    createEmptyDocument: createFilledDocument,
    ...overrides,
})

describe('DocumentKindRegistry', () => {
    it('builds each schema once and returns the same instance', () => {
        const registry = new DocumentKindRegistry([smallKind('notes', [baseBlocksBundle])])

        expect(registry.schema('notes')).toBe(registry.schema('notes'))
    })

    it('rejects a kind registered twice and an unknown kind', () => {
        const registry = new DocumentKindRegistry([smallKind('notes', [baseBlocksBundle])])

        expect(() => registry.register(smallKind('notes', [baseBlocksBundle]))).toThrow('already registered')
        expect(() => registry.schema('missing')).toThrow('Unknown document kind')
    })

    it('rejects two bundles that define the same node differently unless one declares the override', () => {
        const conflicting: SchemaBundle = {
            id: 'conflicting',
            nodes: { code_block: { ...codeBlockNodeSpec } },
        }

        expect(() => new DocumentKindRegistry([smallKind('bad', [baseBlocksBundle, conflicting])])).toThrow('define node code_block differently')
        expect(() => new DocumentKindRegistry([smallKind('good', [baseBlocksBundle, customBlocksBundle])])).not.toThrow()
    })

    it('lets a kind list a bundle whose specs another bundle already supplies', () => {
        const registry = new DocumentKindRegistry([smallKind('notes', [baseBlocksBundle, promptReferenceBundle])])

        expect(Object.keys(registry.schema('notes').nodes)).toContain('prompt_reference')
    })

    it('parses through the schema check and the kind rule', () => {
        const assertInitialDocument = vi.fn()
        const registry = new DocumentKindRegistry([smallKind('notes', [baseBlocksBundle], { assertInitialDocument })])
        const doc = registry.parse('notes', {
            type: 'doc',
            content: [{ type: 'paragraph' }],
        })

        expect(doc.childCount).toBe(1)
        expect(assertInitialDocument).toHaveBeenCalledWith(doc)
        expect(() => registry.parse('notes', { type: 'doc' })).toThrow()
    })
})
