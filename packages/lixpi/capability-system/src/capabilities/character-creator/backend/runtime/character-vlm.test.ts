'use strict'

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { AiModelInferenceCapabilities } from '@lixpi/constants'

import { buildCharacterPanelSpecs } from '../../shared/character-sheet-media-plan.ts'

import { createCharacterVlmPorts } from './character-vlm.ts'
import { emptyCharacterEvidenceProfile } from './character-evidence.ts'

const inferenceCapabilities: AiModelInferenceCapabilities = {
    thinkingMode: 'none',
    requiresAutoToolChoiceWithThinking: false,
    supportsTemperature: true,
    supportsSystemPrompt: true,
    requiresClosedJsonSchema: true,
    supportedInputKinds: ['image', 'document-text'],
}

describe('Character Creator structured VLM ports', () => {
    it('analyzes authoritative source pixels with the selected reasoning model', async () => {
        const panels = buildCharacterPanelSpecs()
        const callVlm = vi.fn(async () => ({
            parsed: {
                medium: 'photograph',
                editTargetPolicy: 'identity-only',
                editTargetApprovedRegions: ['face'],
                editTargetRejectedRegions: ['body', 'outfit', 'hands', 'feet', 'prop'],
                regenerationScope: 'full-sheet',
                affectedPanelIds: panels.map(panel => panel.panelId),
                promptDirectives: ['Apply the requested transformation.'],
                promptChangedFeatures: ['requested transformation'],
                facts: [{
                    feature: 'face',
                    value: 'oval face',
                    region: 'face',
                    requestAuthority: 'assigned',
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
            inferenceCapabilities,
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
            editTargets: [{
                assetId: 'sheet-1',
                organizationId: 'org-1',
                rendition: 'composition-component',
                sourceKind: 'composition-component',
                componentId: 'head-front-neutral',
                compositionAssetId: 'sheet-1',
                blobHash: 'b'.repeat(64),
                mimeType: 'image/png',
                bytes: Buffer.from('target-pixels'),
                width: 100,
                height: 100,
            }],
            referenceAliases: [
                { assetId: 'asset-1', alias: 'REFERENCE_1' },
                { assetId: 'sheet-1', alias: 'REFERENCE_2' },
            ],
            panels,
            userPrompt: 'Apply the requested transformation using the assigned original reference.',
            editTargetPresent: true,
        })

        expect(result.facts?.[0]).not.toHaveProperty('conflictGroupId')
        expect(result.promptDirectives).toEqual(['Apply the requested transformation.'])
        expect(result.promptChangedFeatures).toEqual(['requested transformation'])
        expect(result.editTargetPolicy).toBe('identity-only')
        expect(callVlm).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'OpenAI',
            modelVersion: 'reasoning-model-v1',
            systemPrompt: expect.stringContaining('Resolve an obvious misspelling conservatively from the surrounding request'),
            schema: expect.objectContaining({ name: 'character_evidence' }),
            userMessages: [expect.objectContaining({
                content: expect.arrayContaining([
                    expect.objectContaining({ type: 'input_text', text: expect.stringContaining('Original reference REFERENCE_1') }),
                    expect.objectContaining({ type: 'input_text', text: expect.stringContaining('Editable prior panel REFERENCE_2') }),
                    expect.objectContaining({ type: 'input_image', image_url: expect.stringMatching(/^data:image\/png;base64,/u) }),
                ]),
            })],
        }))
        expect(callVlm.mock.calls[0]?.[0].systemPrompt).toContain(
            'Every observed fact must name the exact asset ID of the original reference',
        )
    })

    it('scores every requested panel dimension against authoritative sources and the candidate', async () => {
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
            inferenceCapabilities,
            vlm: { call: callVlm },
        })
        const result = await ports.panelAssessor.assess({
            panel,
            candidateDataUrl: 'data:image/png;base64,Y2FuZGlkYXRl',
            poseReferenceDataUrl: 'data:image/png;base64,cG9zZQ==',
            authoritativePrompt: 'Apply the requested transformation.',
            capabilityInstructions: ['Render with rough watercolor texture.'],
            capabilityReferenceDataUrls: ['data:image/png;base64,c3R5bGU='],
            sourceDataUrls: ['data:image/png;base64,c291cmNl'],
            evidence: emptyCharacterEvidenceProfile(),
        })

        expect(result.assessor).toBe('Google/reasoning-model-v1')
        expect(result.dimensions).toContainEqual(expect.objectContaining({ dimension: 'request-compliance' }))
        expect(result.dimensions).toContainEqual(expect.objectContaining({ dimension: 'depiction-medium' }))
        expect(result.dimensions.map(dimension => dimension.dimension)).toEqual(panel.acceptanceDimensions)
        const content = (callVlm.mock.calls[0]![0] as any).userMessages[0].content
        expect(content.filter((part: any) => part.type === 'input_image')).toHaveLength(4)
        expect(content[0].text).toContain('Apply the requested transformation.')
        expect(content[0].text).toContain('rough watercolor texture')
        expect(content[0].text).toContain('Categorical single-panel-composition and target-view or action-pose dimensions are release gates')
        expect(content[0].text).toContain('Template-conformance and framing are review dimensions')
        expect(content).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'input_text',
                text: expect.stringContaining('Exact grayscale spatial template'),
            }),
        ]))
        expect((callVlm.mock.calls[0]![0] as any).systemPrompt)
            .toContain('unrequested depiction-medium or visual-style conversion')
        expect((callVlm.mock.calls[0]![0] as any).systemPrompt)
            .toContain('never a contact sheet, montage, lineup, split view')
    })
})
