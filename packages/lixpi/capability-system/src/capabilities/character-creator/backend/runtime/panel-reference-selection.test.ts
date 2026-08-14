'use strict'

import { describe, expect, it } from 'vitest'

import { buildCharacterSheetRenderPlan } from '../../shared/character-sheet-media-plan.ts'
import { emptyCharacterEvidenceProfile } from './character-evidence.ts'
import { selectCharacterPanelReferenceEntries } from './panel-reference-selection.ts'
import type { CharacterReferencePackEntry } from './reference-pack.ts'

const coordinate = {
    organizationId: 'org-1',
    bucketName: 'transient-media-org-1-files',
    objectKey: `partial-${'a'.repeat(64)}.png`,
    mimeType: 'image/png' as const,
    byteLength: 100,
}

const entry = (
    role: CharacterReferencePackEntry['role'],
    fileName: string,
    overrides: Partial<CharacterReferencePackEntry> = {},
): CharacterReferencePackEntry => ({
    url: `data:image/png;base64,${Buffer.from(fileName).toString('base64')}`,
    role,
    fileName,
    coordinate,
    width: 256,
    height: 256,
    ...overrides,
})

describe('selectCharacterPanelReferenceEntries', () => {
    it('sends only the matching decomposed component from each sheet to one shot', () => {
        const panel = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-1',
            sourceAssetIds: ['sheet-1', 'sheet-2'],
            userPrompt: 'Edit the character sheet.',
        }).panels[0]!
        const entries = [
            entry('edit-target', 'EDIT_TARGET_head-front-neutral.png', {
                sourceAssetId: 'sheet-1',
                compositionAssetId: 'sheet-1',
                componentId: 'head-front-neutral',
            }),
            entry('edit-target', 'EDIT_TARGET_body-front.png', {
                sourceAssetId: 'sheet-1',
                compositionAssetId: 'sheet-1',
                componentId: 'body-front',
            }),
            entry('original-source', 'REFERENCE_2_head-front-neutral.png', {
                sourceAssetId: 'sheet-2',
                compositionAssetId: 'sheet-2',
                componentId: 'head-front-neutral',
            }),
            entry('original-source', 'REFERENCE_2_body-back.png', {
                sourceAssetId: 'sheet-2',
                compositionAssetId: 'sheet-2',
                componentId: 'body-back',
            }),
            entry('original-source', 'REFERENCE_1.png', { sourceAssetId: 'source-1' }),
        ]

        const selected = selectCharacterPanelReferenceEntries(
            entries,
            panel,
            emptyCharacterEvidenceProfile(),
        )

        expect(selected.map(reference => reference.fileName)).toEqual([
            'EDIT_TARGET_head-front-neutral.png',
            'REFERENCE_2_head-front-neutral.png',
            'REFERENCE_1.png',
        ])
    })

    it('never sends body or prop crops to a portrait shot', () => {
        const panel = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-1',
            sourceAssetIds: ['source-1'],
            userPrompt: 'Create a character sheet.',
        }).panels[0]!
        const entries = [
            entry('original-source', 'REFERENCE_1.png', { sourceAssetId: 'source-1' }),
            entry('face-crop', 'REFERENCE_1_FACE_CROP.png', { sourceAssetId: 'source-1' }),
            entry('body-outfit-crop', 'REFERENCE_1_BODY_OUTFIT_CROP.png', { sourceAssetId: 'source-1' }),
            entry('prop-crop', 'REFERENCE_1_PROP_CROP.png', { sourceAssetId: 'source-1' }),
        ]

        expect(selectCharacterPanelReferenceEntries(
            entries,
            panel,
            emptyCharacterEvidenceProfile(),
        ).map(reference => reference.role)).toEqual(['face-crop'])
    })

    it('isolates an approved edit-target identity from unrelated body sources', () => {
        const panel = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-1',
            sourceAssetIds: ['source-1', 'sheet-1'],
            userPrompt: 'Keep the face and replace the clothes from the original drawing.',
        }).panels[0]!
        const evidence = emptyCharacterEvidenceProfile()
        evidence.editTargetPolicy = 'identity-only'
        evidence.facts = [
            {
                feature: 'clothing',
                value: 'gray herringbone coat',
                region: 'outfit',
                requestAuthority: 'assigned',
                visibility: 'observed',
                sourceAssetId: 'source-1',
                targetAngles: ['back'],
                confidence: 1,
            },
            {
                feature: 'bag placement',
                value: 'low against the thigh',
                region: 'prop',
                requestAuthority: 'assigned',
                visibility: 'observed',
                sourceAssetId: 'source-1',
                targetAngles: ['back'],
                confidence: 1,
            },
        ]
        const entries = [
            entry('edit-target-identity', 'EDIT_TARGET_IDENTITY_FACE.png', {
                sourceAssetId: 'sheet-1',
            }),
            entry('original-source', 'REFERENCE_1.png', { sourceAssetId: 'source-1' }),
            entry('face-crop', 'REFERENCE_1_FACE_CROP.png', { sourceAssetId: 'source-1' }),
            entry('body-outfit-crop', 'REFERENCE_1_BODY_OUTFIT_CROP.png', { sourceAssetId: 'source-1' }),
            entry('prop-crop', 'REFERENCE_1_PROP_CROP.png', { sourceAssetId: 'source-1' }),
        ]

        expect(selectCharacterPanelReferenceEntries(entries, panel, evidence).map(reference => reference.fileName))
            .toEqual(['EDIT_TARGET_IDENTITY_FACE.png'])
    })

    it('keeps explicitly assigned face evidence as a crop beside an approved identity crop', () => {
        const panel = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-1',
            sourceAssetIds: ['source-1', 'sheet-1'],
            userPrompt: 'Use the antenna pattern from the original drawing.',
        }).panels[0]!
        const evidence = emptyCharacterEvidenceProfile()
        evidence.editTargetPolicy = 'identity-only'
        evidence.facts = [{
            feature: 'antenna pattern',
            value: 'short radial antennas',
            region: 'face',
            requestAuthority: 'assigned',
            visibility: 'observed',
            sourceAssetId: 'source-1',
            targetAngles: ['front'],
            confidence: 1,
        }]
        const entries = [
            entry('edit-target-identity', 'EDIT_TARGET_IDENTITY_FACE.png', {
                sourceAssetId: 'sheet-1',
            }),
            entry('original-source', 'REFERENCE_1.png', { sourceAssetId: 'source-1' }),
            entry('face-crop', 'REFERENCE_1_FACE_CROP.png', { sourceAssetId: 'source-1' }),
        ]

        expect(selectCharacterPanelReferenceEntries(entries, panel, evidence).map(reference => reference.fileName))
            .toEqual(['EDIT_TARGET_IDENTITY_FACE.png', 'REFERENCE_1_FACE_CROP.png'])
    })
})
