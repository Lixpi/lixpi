import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    createProseMirrorSchema,
    DOCUMENT_TYPE,
} from './schema-builder.ts'
import {
    getPromptReferenceStableId,
    LEGACY_CAPABILITY_REFERENCE_NODE_TYPE,
    normalizeLegacyCapabilityReferenceAttrs,
    normalizePromptReferenceAttrs,
    PROMPT_REFERENCE_NODE_TYPE,
    toPromptReference,
} from './prompt-reference.ts'

describe('prompt_reference', () => {
    it.each(
        [
            [{ referenceType: 'media', assetId: 'asset-1', nodeId: 'node-1', mediaKind: 'image', displayName: 'Portrait' }, 'asset-1'],
            [{ referenceType: 'capability-module', moduleId: 'character-creator', displayName: 'Character Creator' }, 'character-creator'],
            [{ referenceType: 'tool', capabilityId: 'tool-1', displayName: 'Tool' }, 'tool-1'],
            [{ referenceType: 'skill', capabilityId: 'skill-1', displayName: 'Skill' }, 'skill-1'],
        ] as const,
    )('normalizes every reference union member', (input, stableId) => {
        const attrs = normalizePromptReferenceAttrs(input)
        expect(attrs).not.toBeNull()
        expect(getPromptReferenceStableId(toPromptReference(attrs!))).toBe(stableId)
    })

    it('rejects incomplete and contradictory atom attributes', () => {
        expect(normalizePromptReferenceAttrs({ referenceType: 'media', assetId: '', mediaKind: 'image', displayName: 'Missing' })).toBeNull()
        expect(normalizePromptReferenceAttrs({ referenceType: 'tool', moduleId: 'wrong', displayName: 'Wrong' })).toBeNull()
        expect(normalizePromptReferenceAttrs({ referenceType: 'media', assetId: 'asset-1', capabilityId: 'tool-1', mediaKind: 'image', displayName: 'Wrong union' })).toBeNull()
        expect(normalizePromptReferenceAttrs({ referenceType: 'capability-module', moduleId: 'module-1', assetId: 'asset-1', displayName: 'Wrong union' })).toBeNull()
        expect(normalizePromptReferenceAttrs({ referenceType: 'skill', capabilityId: 'skill-1', nodeId: 'node-1', displayName: 'Wrong union' })).toBeNull()
        expect(normalizePromptReferenceAttrs({ referenceType: 'skill', capabilityId: 'skill-1', displayName: '' })).toBeNull()
    })

    it('normalizes persisted legacy Tool and Skill atoms without exposing them to new insertion code', () => {
        expect(normalizeLegacyCapabilityReferenceAttrs({
            capabilityId: 'skill-legacy',
            kind: 'skill',
            displayName: 'Legacy Skill',
        })).toEqual({
            referenceType: 'skill',
            capabilityId: 'skill-legacy',
            displayName: 'Legacy Skill',
        })
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.ASSET_CONVERSATION)
        const nodeType = schema.nodes[LEGACY_CAPABILITY_REFERENCE_NODE_TYPE]
        const node = schema.nodeFromJSON({
            type: LEGACY_CAPABILITY_REFERENCE_NODE_TYPE,
            attrs: { capabilityId: 'skill-legacy', kind: 'skill', displayName: 'Legacy Skill' },
        })
        const dom = nodeType.spec.toDOM!(node) as [string, Record<string, string>, ...unknown[]]

        expect(nodeType).toBeDefined()
        expect(nodeType.spec.selectable).toBe(false)
        expect(node.type.name).toBe(LEGACY_CAPABILITY_REFERENCE_NODE_TYPE)
        expect(dom.slice(2)).toEqual([
            ['span', { class: 'prompt-reference-chip-name' }, 'Legacy Skill'],
        ])
    })

    it('is an inline atom that round-trips stable identity through DOM attributes', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.AI_PROMPT_INPUT)
        const nodeType = schema.nodes[PROMPT_REFERENCE_NODE_TYPE]
        const node = nodeType.create({
            referenceType: 'media',
            assetId: 'asset-1',
            nodeId: '',
            mediaKind: 'video',
            displayName: 'Old cosmetic name',
        })
        const dom = nodeType.spec.toDOM!(node) as [string, Record<string, string>, ...unknown[]]

        expect(nodeType.isAtom).toBe(true)
        expect(nodeType.spec.selectable).toBe(false)
        expect(dom[1]['data-asset-id']).toBe('asset-1')
        expect(dom[1]['data-prompt-reference-type']).toBe('media')
        expect(dom[1]['data-prompt-reference-display-name']).toBe('Old cosmetic name')
    })

    it.each(
        [
            { referenceType: 'media', assetId: 'asset-1', mediaKind: 'image', displayName: 'Portrait' },
            { referenceType: 'capability-module', moduleId: 'character-creator', displayName: 'Character Creator' },
            { referenceType: 'tool', capabilityId: 'tool-1', displayName: 'Style Extraction' },
            { referenceType: 'skill', capabilityId: 'skill-1', displayName: 'Reference Fidelity' },
        ] as const,
    )('renders only the cosmetic name in fallback DOM', (attrs) => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.AI_PROMPT_INPUT)
        const nodeType = schema.nodes[PROMPT_REFERENCE_NODE_TYPE]
        const node = nodeType.create(attrs)
        const dom = nodeType.spec.toDOM!(node) as [string, Record<string, string>, ...unknown[]]

        expect(dom.slice(2)).toEqual([
            ['span', { class: 'prompt-reference-chip-name' }, attrs.displayName],
        ])
    })
})
