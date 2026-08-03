'use strict'

import { describe, expect, it, vi } from 'vitest'

import { buildCharacterPanelSpecs } from '../../shared/character-sheet-media-plan.ts'

import { createCharacterVlmPorts } from './character-vlm.ts'
import { emptyCharacterEvidenceProfile } from './character-evidence.ts'

describe('Character Creator structured VLM ports', () => {
    it('analyzes authoritative source pixels with the selected reasoning model', async () => {
        const callVlm = vi.fn(async () => ({
            parsed: {
                medium: 'photograph',
                facts: [{
                    feature: 'face',
                    value: 'oval face',
                    visibility: 'observed',
                    sourceAssetId: 'asset-1',
                    sourceRegion: { x: 10, y: 20, width: 30, height: 40 },
                    targetAngles: ['front'],
                    confidence: 0.9,
                    conflictGroupId: null,
                }],
                palette: ['#112233'],
                costumeNotes: [],
                materialNotes: [],
                distinguishingDetailNotes: [],
                sourceCoverage: [{ sourceAssetId: 'asset-1', angles: ['front'], regions: ['face'] }],
            },
            rawText: '{}',
            modelName: 'reasoning-model-v1',
            promptTokens: 10,
            completionTokens: 20,
        }))
        const ports = createCharacterVlmPorts({
            provider: 'OpenAI',
            modelVersion: 'reasoning-model-v1',
            vlm: { call: callVlm },
        })
        const result = await ports.evidenceAnalyzer.analyze({
            sources: [{
                assetId: 'asset-1',
                organizationId: 'org-1',
                rendition: 'canonical',
                blobHash: 'a'.repeat(64),
                mimeType: 'image/png',
                bytes: Buffer.from('source-pixels'),
                width: 100,
                height: 100,
            }],
            userPrompt: 'A courier',
        })

        expect(result.facts?.[0]).not.toHaveProperty('conflictGroupId')
        expect(callVlm).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'OpenAI',
            modelVersion: 'reasoning-model-v1',
            schema: expect.objectContaining({ name: 'character_evidence' }),
            userMessages: [expect.objectContaining({
                content: expect.arrayContaining([
                    expect.objectContaining({ type: 'input_image', image_url: expect.stringMatching(/^data:image\/png;base64,/u) }),
                ]),
            })],
        }))
    })

    it('scores every requested panel dimension against sources and accepted anchors', async () => {
        const panel = buildCharacterPanelSpecs()[0]!
        const callVlm = vi.fn(async () => ({
            parsed: {
                dimensions: panel.acceptanceDimensions.map(dimension => ({
                    dimension,
                    score: 0.9,
                    mismatchCodes: [],
                })),
            },
            rawText: '{}',
            modelName: 'reasoning-model-v1',
            promptTokens: 10,
            completionTokens: 20,
        }))
        const ports = createCharacterVlmPorts({
            provider: 'Google',
            modelVersion: 'reasoning-model-v1',
            vlm: { call: callVlm },
        })
        const result = await ports.panelAssessor.assess({
            panel,
            candidateDataUrl: 'data:image/png;base64,Y2FuZGlkYXRl',
            sourceDataUrls: ['data:image/png;base64,c291cmNl'],
            anchorDataUrls: ['data:image/png;base64,YW5jaG9y'],
            evidence: emptyCharacterEvidenceProfile(),
        })

        expect(result.assessor).toBe('Google/reasoning-model-v1')
        expect(result.dimensions.map(dimension => dimension.dimension)).toEqual(panel.acceptanceDimensions)
        const content = (callVlm.mock.calls[0]![0] as any).userMessages[0].content
        expect(content.filter((part: any) => part.type === 'input_image')).toHaveLength(3)
    })
})
