'use strict'

import { createHash } from 'node:crypto'

import type { CapabilityKind, CapabilityJsonValue } from '@lixpi/constants'

import type { SealedResolvedCapabilityPlan } from './capability-resolver.ts'

export const SEARCH_CAPABILITIES_TOOL_NAME = 'search_capabilities'
export const USE_CAPABILITY_TOOL_NAME = 'use_capability'

export type CapabilityModelToolCall = {
    callId: string
    name: string
    arguments: Record<string, CapabilityJsonValue>
}

export type CapabilityModelToolDefinition = {
    name: string
    description: string
    inputSchema: Record<string, unknown>
    capabilityId?: string
}

export function getStandingCapabilityModelTools(): CapabilityModelToolDefinition[] {
    return [
        {
            name: SEARCH_CAPABILITIES_TOOL_NAME,
            description: 'Search the authorized Tools and Skills catalog by normalized name prefix. You must call this before generate_image or generate_video for any free-form request to create, design, or develop a character, make a character sheet or turnaround, extract a style, or perform another specialized named workflow. Use this before use_capability when the user did not explicitly attach a Tool.',
            inputSchema: {
                type: 'object',
                required: ['query', 'kinds', 'limit', 'cursor'],
                properties: {
                    query: {
                        anyOf: [
                            { type: 'string', maxLength: 200 },
                            { type: 'null' },
                        ],
                    },
                    kinds: {
                        anyOf: [
                            {
                                type: 'array',
                                items: { type: 'string', enum: ['tool', 'skill'] satisfies CapabilityKind[] },
                                maxItems: 2,
                            },
                            { type: 'null' },
                        ],
                    },
                    limit: {
                        anyOf: [
                            { type: 'integer', minimum: 1, maximum: 20 },
                            { type: 'null' },
                        ],
                    },
                    cursor: {
                        anyOf: [
                            { type: 'string', maxLength: 4096 },
                            { type: 'null' },
                        ],
                    },
                },
                additionalProperties: false,
            },
        },
        {
            name: USE_CAPABILITY_TOOL_NAME,
            description: 'Run one authorized Capability Tool visibly. When search_capabilities returns a Tool matching the user request, run it before ordinary image/video generation. Arguments are validated against the Tool input schema before execution.',
            inputSchema: {
                type: 'object',
                required: ['capabilityId', 'arguments'],
                properties: {
                    capabilityId: { type: 'string', minLength: 1, maxLength: 256 },
                    arguments: { type: 'object' },
                },
                additionalProperties: false,
            },
        },
    ]
}

export function getAttachedCapabilityModelTools(
    plan: SealedResolvedCapabilityPlan | undefined,
): CapabilityModelToolDefinition[] {
    if (!plan) return []
    return plan.serializable.rootCapabilityIds.flatMap(capabilityId => {
        const capability = plan.getManifest(capabilityId)
        if (capability?.kind !== 'tool'
            || capability.manifest.tool?.executionPolicy !== 'model-choice') return []
        const schema = plan.getResource(capabilityId, capability.manifest.tool.inputSchema.resourceId)
        if (!schema) return []
        try {
            const inputSchema = JSON.parse(new TextDecoder().decode(schema.bytes)) as Record<string, unknown>
            return [{
                name: directCapabilityToolName(capabilityId),
                description: capability.manifest.description,
                inputSchema,
                capabilityId,
            }]
        } catch {
            return []
        }
    })
}

export function directCapabilityToolName(capabilityId: string): string {
    const safeId = capabilityId.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 32)
    const suffix = createHash('sha256').update(capabilityId).digest('hex').slice(0, 8)
    return `capability_${safeId}_${suffix}`
}

function isOpenAIStrictSchemaCompatible(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return true
    const schema = value as Record<string, unknown>
    if (schema.type === 'object') {
        if (schema.additionalProperties !== false) return false
        const properties = schema.properties
        if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return false
        const propertyEntries = Object.entries(properties)
        const required = new Set(Array.isArray(schema.required) ? schema.required : [])
        if (propertyEntries.some(([key]) => !required.has(key))) return false
        if (propertyEntries.some(([, child]) => !isOpenAIStrictSchemaCompatible(child))) return false
    }
    if (schema.items && !isOpenAIStrictSchemaCompatible(schema.items)) return false
    if (Array.isArray(schema.anyOf)
        && schema.anyOf.some(child => !isOpenAIStrictSchemaCompatible(child))) return false
    return true
}

export function asOpenAITool(definition: CapabilityModelToolDefinition): Record<string, unknown> {
    return {
        type: 'function',
        name: definition.name,
        description: definition.description,
        parameters: definition.inputSchema,
        // Capability inputs are always validated again by the sealed server-side
        // schema. Strict mode is used only when the schema can represent every
        // property under OpenAI's closed-object requirements.
        strict: isOpenAIStrictSchemaCompatible(definition.inputSchema),
    }
}

export function asAnthropicTool(definition: CapabilityModelToolDefinition): Record<string, unknown> {
    return {
        name: definition.name,
        description: definition.description,
        input_schema: definition.inputSchema,
    }
}

export function asGoogleTool(definition: CapabilityModelToolDefinition): Record<string, unknown> {
    return {
        name: definition.name,
        description: definition.description,
        parameters: definition.inputSchema,
    }
}

export function parseCapabilityToolArguments(value: unknown): Record<string, CapabilityJsonValue> {
    if (typeof value === 'string') {
        try {
            return parseCapabilityToolArguments(JSON.parse(value))
        } catch {
            return {}
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as Record<string, CapabilityJsonValue>
}
