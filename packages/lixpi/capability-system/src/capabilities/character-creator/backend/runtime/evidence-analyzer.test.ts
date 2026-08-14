'use strict'

import { describe, expect, it } from 'vitest'

import { buildCharacterPanelSpecs } from '../../shared/character-sheet-media-plan.ts'
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

    it('relinks an observed fact to the only authorized original source', async () => {
        const evidence = await analyzeCharacterEvidence({
            sources: [source('asset-original')],
            userPrompt: 'Use the original clothing and keep only the prior face.',
            editTargetPresent: true,
            analyzer: {
                analyze: async () => ({
                    medium: 'illustration',
                    editTargetPolicy: 'identity-only',
                    editTargetApprovedRegions: ['face'],
                    editTargetRejectedRegions: ['body', 'outfit', 'hands', 'feet', 'prop'],
                    facts: [{
                        feature: 'outfit construction',
                        value: 'long coat with covered arms',
                        region: 'outfit',
                        requestAuthority: 'assigned',
                        visibility: 'observed',
                        targetAngles: ['back'],
                        confidence: 1,
                    }],
                }),
            },
        })

        expect(evidence.editTargetPolicy).toBe('identity-only')
        expect(evidence.facts).toContainEqual(expect.objectContaining({
            feature: 'outfit construction',
            sourceAssetId: 'asset-original',
        }))
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

    it('retains changed original-source facts so requests can explicitly reuse them', async () => {
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
        })).toEqual([
            expect.objectContaining({ feature: 'coat color', value: 'red' }),
        ])
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

    it('restricts a mixed-authority edit target to its sole approved region', async () => {
        const panels = buildCharacterPanelSpecs()
        const evidence = await analyzeCharacterEvidence({
            sources: [source('asset-original')],
            editTargets: [{
                ...source('asset-sheet'),
                rendition: 'composition-component' as const,
                sourceKind: 'composition-component' as const,
                componentId: 'head-front-neutral',
                compositionAssetId: 'asset-sheet',
            }],
            panels,
            userPrompt: 'Apply the requested corrections throughout the sheet.',
            editTargetPresent: true,
            analyzer: {
                analyze: async () => ({
                    medium: 'illustration',
                    editTargetPolicy: 'preserve-panel',
                    editTargetApprovedRegions: ['face'],
                    editTargetRejectedRegions: ['body', 'outfit', 'prop'],
                    regenerationScope: 'full-sheet',
                    affectedPanelIds: panels.map(panel => panel.panelId),
                }),
            },
        })

        expect(evidence.editTargetPolicy).toBe('identity-only')
        expect(evidence.regenerationScope).toBe('full-sheet')
        expect(evidence.affectedPanelIds).toEqual(panels.map(panel => panel.panelId))
    })

    it('prefers request-assigned source evidence over a higher-confidence supporting source', async () => {
        const evidence = await analyzeCharacterEvidence({
            sources: [source('asset-assigned'), source('asset-supporting')],
            userPrompt: 'Use the assigned source for this visible feature.',
            analyzer: {
                analyze: async () => ({
                    medium: 'illustration',
                    facts: [
                        {
                            feature: 'surface treatment',
                            value: 'assigned appearance',
                            region: 'outfit',
                            requestAuthority: 'assigned',
                            visibility: 'observed',
                            sourceAssetId: 'asset-assigned',
                            targetAngles: ['front'],
                            confidence: 0.6,
                        },
                        {
                            feature: 'surface treatment',
                            value: 'supporting appearance',
                            region: 'outfit',
                            requestAuthority: 'supporting',
                            visibility: 'observed',
                            sourceAssetId: 'asset-supporting',
                            targetAngles: ['front'],
                            confidence: 1,
                        },
                    ],
                }),
            },
        })

        expect(selectCharacterEvidenceFacts({
            evidence,
            targetAngle: 'front',
            promptChangedFeatures: [],
        })).toContainEqual(expect.objectContaining({
            sourceAssetId: 'asset-assigned',
            value: 'assigned appearance',
        }))
    })
})
