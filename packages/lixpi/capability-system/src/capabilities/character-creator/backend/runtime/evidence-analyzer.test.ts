'use strict'

import { describe, expect, it } from 'vitest'

import {
    analyzeCharacterEvidence,
    selectCharacterEvidenceFacts,
} from './evidence-analyzer.ts'

const source = (assetId: string) => ({
    assetId,
    organizationId: 'org-1',
    rendition: 'original' as const,
    blobHash: assetId.padEnd(64, 'a'),
    mimeType: 'image/png' as const,
    bytes: Buffer.from([1]),
    width: 1000,
    height: 1200,
})

describe('character evidence analysis', () => {
    it('returns explicit source-free evidence without inventing observations', async () => {
        const evidence = await analyzeCharacterEvidence({ sources: [], userPrompt: 'A courier' })

        expect(evidence.medium).toBe('unknown')
        expect(evidence.facts).toEqual([])
        expect(evidence.sourceCoverage).toEqual([])
    })

    it('keeps a sparse single source as observed coverage without inventing hidden details', async () => {
        const evidence = await analyzeCharacterEvidence({
            sources: [source('asset-front')],
            userPrompt: 'A courier',
            analyzer: {
                analyze: async () => ({
                    medium: 'unknown',
                    facts: [{
                        feature: 'source appearance',
                        value: 'Visible character appearance',
                        visibility: 'observed',
                        sourceAssetId: 'asset-front',
                        targetAngles: ['unspecified'],
                        confidence: 1,
                    }],
                    sourceCoverage: [{
                        sourceAssetId: 'asset-front',
                        angles: ['unspecified'],
                        regions: ['face', 'body', 'outfit'],
                    }],
                }),
            },
        })

        expect(evidence.facts).toEqual([
            expect.objectContaining({
                visibility: 'observed',
                sourceAssetId: 'asset-front',
                targetAngles: ['unspecified'],
            }),
        ])
        expect(evidence.facts.some(fact => fact.visibility === 'inferred')).toBe(false)
    })

    it('keeps observed and inferred facts and records multi-source conflicts', async () => {
        const evidence = await analyzeCharacterEvidence({
            sources: [source('asset-front'), source('asset-profile')],
            userPrompt: 'Keep the original coat',
            analyzer: {
                analyze: async () => ({
                    medium: 'illustration',
                    facts: [
                        {
                            feature: 'coat color', value: 'red', visibility: 'observed', sourceAssetId: 'asset-front',
                            targetAngles: ['front'], confidence: 0.9, conflictGroupId: 'coat-1',
                        },
                        {
                            feature: 'coat color', value: 'brown', visibility: 'observed', sourceAssetId: 'asset-profile',
                            targetAngles: ['profile'], confidence: 0.85, conflictGroupId: 'coat-1',
                        },
                        {
                            feature: 'footwear', value: 'boots', visibility: 'inferred',
                            targetAngles: ['unspecified'], confidence: 0.4,
                        },
                    ],
                }),
            },
        })

        expect(evidence.conflicts).toEqual([expect.objectContaining({ conflictGroupId: 'coat-1', factIndexes: [0, 1] })])
        expect(selectCharacterEvidenceFacts({ evidence, targetAngle: 'profile', promptChangedFeatures: [] })
            .find(fact => fact.feature === 'coat color')?.value).toBe('brown')
    })

    it('lets explicit prompt changes override observed source facts', async () => {
        const evidence = await analyzeCharacterEvidence({
            sources: [source('asset-front')],
            userPrompt: 'Change coat to blue',
            analyzer: {
                analyze: async () => ({
                    medium: 'photograph',
                    promptDirectives: ['Change the coat to blue.'],
                    promptChangedFeatures: ['coat color'],
                    facts: [{
                        feature: 'coat color', value: 'red', visibility: 'observed', sourceAssetId: 'asset-front',
                        targetAngles: ['front'], confidence: 1,
                    }],
                }),
            },
        })

        expect(selectCharacterEvidenceFacts({
            evidence,
            targetAngle: 'front',
            promptChangedFeatures: evidence.promptChangedFeatures,
        })).toEqual([])
        expect(evidence.promptDirectives).toEqual(['Change the coat to blue.'])
    })

    it('rejects observed evidence outside the authorized source bounds', async () => {
        await expect(analyzeCharacterEvidence({
            sources: [source('asset-front')],
            userPrompt: 'A courier',
            analyzer: {
                analyze: async () => ({
                    medium: 'photograph',
                    facts: [{
                        feature: 'face',
                        value: 'visible face',
                        visibility: 'observed',
                        sourceAssetId: 'asset-front',
                        sourceRegion: { x: 900, y: 0, width: 200, height: 200 },
                        targetAngles: ['front'],
                        confidence: 1,
                    }],
                }),
            },
        })).rejects.toThrow('CHARACTER_EVIDENCE_REGION_INVALID')
    })
})
