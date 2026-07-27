import { describe, expect, it } from 'vitest'

import type {
    CapabilityManifest,
    CapabilityResourceRef,
    ResolvedCapabilityPlan,
} from '@lixpi/constants'

import {
    asAnthropicTool,
    asGoogleTool,
    asOpenAITool,
    directCapabilityToolName,
    getAttachedCapabilityModelTools,
    getStandingCapabilityModelTools,
} from './capability-model-tools.ts'
import { SealedResolvedCapabilityPlan } from './capability-resolver.ts'

function makePlan(): SealedResolvedCapabilityPlan {
    const schemaBytes = new TextEncoder().encode(JSON.stringify({
        type: 'object',
        required: ['prompt'],
        properties: { prompt: { type: 'string' } },
        additionalProperties: false,
    }))
    const schemaRef: CapabilityResourceRef = {
        resourceId: 'input',
        blobHash: 'hash',
        mediaType: 'application/schema+json',
        role: 'schema',
    }
    const manifest: CapabilityManifest = {
        schemaVersion: 1,
        capabilityId: 'character.creator:v1',
        kind: 'tool',
        name: 'Character Creator',
        description: 'Creates a character sheet.',
        references: [],
        resources: [schemaRef],
        tool: {
            toolType: 'character-creator',
            inputSchema: schemaRef,
            outputSchema: schemaRef,
            executionPolicy: 'model-choice',
            executionMultiplicity: 'once',
            modelAxisPolicy: {
                reasoning: 'first-selected',
                image: 'ignore',
                video: 'ignore',
                outputMode: 'capability-only',
            },
            workflow: { steps: [], outputs: {} },
        },
    }
    const serializable: ResolvedCapabilityPlan = {
        rootCapabilityIds: [manifest.capabilityId],
        capabilities: [{
            capabilityId: manifest.capabilityId,
            kind: 'tool',
            manifestBlobHash: 'manifest-hash',
            manifest,
        }],
        resolvedManifests: [{ capabilityId: manifest.capabilityId, manifestBlobHash: 'manifest-hash' }],
    }
    return new SealedResolvedCapabilityPlan(serializable, [{
        capabilityId: manifest.capabilityId,
        ref: schemaRef,
        bytes: schemaBytes,
    }])
}

describe('Capability model tool definitions', () => {
    it('always exposes provider-neutral search and use functions', () => {
        expect(getStandingCapabilityModelTools().map(tool => tool.name)).toEqual([
            'search_capabilities',
            'use_capability',
        ])
    })

    it('surfaces an attached model-choice Tool with its own input schema', () => {
        const tools = getAttachedCapabilityModelTools(makePlan())

        expect(tools).toEqual([expect.objectContaining({
            name: directCapabilityToolName('character.creator:v1'),
            capabilityId: 'character.creator:v1',
            inputSchema: expect.objectContaining({
                required: ['prompt'],
            }),
        })])
    })

    it('adapts the same definition to all three provider formats', () => {
        const definition = getStandingCapabilityModelTools()[0]!

        expect(asOpenAITool(definition)).toEqual(expect.objectContaining({
            type: 'function',
            name: 'search_capabilities',
            parameters: definition.inputSchema,
            strict: true,
        }))
        expect(asAnthropicTool(definition)).toEqual(expect.objectContaining({
            name: 'search_capabilities',
            input_schema: definition.inputSchema,
        }))
        expect(asGoogleTool(definition)).toEqual(expect.objectContaining({
            name: 'search_capabilities',
            parameters: definition.inputSchema,
        }))
    })
})
