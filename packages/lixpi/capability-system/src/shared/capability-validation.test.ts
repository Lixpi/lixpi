import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    type CapabilityKind,
    type CapabilityManifest,
    type CapabilityResourceRef,
} from '@lixpi/constants'

import {
    CAPABILITY_LIMITS,
    validateCapabilityDependencyGraph,
    validateCapabilityManifest,
} from './capability-validation.ts'

const inputSchema: CapabilityResourceRef = {
    resourceId: 'input-schema',
    blobHash: 'sha256:input',
    mediaType: 'application/schema+json',
    role: 'schema',
}

const outputSchema: CapabilityResourceRef = {
    resourceId: 'output-schema',
    blobHash: 'sha256:output',
    mediaType: 'application/schema+json',
    role: 'schema',
}

function makeToolManifest(capabilityId = 'character-creator'): CapabilityManifest {
    return {
        schemaVersion: 1,
        capabilityId,
        kind: 'tool',
        name: 'Character Creator',
        description: 'Creates a deterministic character sheet.',
        references: [],
        resources: [inputSchema, outputSchema],
        tool: {
            toolType: 'character-creator',
            inputSchema,
            outputSchema,
            executionPolicy: 'required',
            executionMultiplicity: 'once',
            modelAxisPolicy: {
                reasoning: 'first-selected',
                image: 'ignore',
                video: 'ignore',
                outputMode: 'capability-only',
            },
            workflow: {
                steps: [
                    {
                        stepId: 'validate',
                        title: 'Validate request',
                        action: 'character.validate',
                        dependsOn: [],
                        input: {
                            request: { source: 'input', path: ['prompt'] },
                        },
                        progress: {},
                    },
                    {
                        stepId: 'generate',
                        title: 'Generate sheet',
                        action: 'image.generate',
                        dependsOn: ['validate'],
                        input: {
                            prompt: { source: 'step', stepId: 'validate', path: ['prompt'] },
                        },
                        retry: { maxAttempts: 2, backoffMs: 100 },
                        progress: { group: 'generation' },
                    },
                ],
                outputs: {
                    assetId: { source: 'step', stepId: 'generate', path: ['assetId'] },
                },
            },
        },
    }
}

function makeSkillManifest(capabilityId: string, references: CapabilityManifest['references'] = []): CapabilityManifest {
    return {
        schemaVersion: 1,
        capabilityId,
        kind: 'skill',
        name: capabilityId,
        description: `Instructions for ${capabilityId}`,
        references,
        resources: [],
    }
}

function issueCodes(manifest: unknown): string[] {
    const result = validateCapabilityManifest(manifest)
    return result.issues.map((issue) => issue.code)
}

// =============================================================================
// MANIFEST AND WORKFLOW VALIDATION
// =============================================================================

describe('validateCapabilityManifest', () => {
    it('accepts a valid bounded Tool manifest and registered actions', () => {
        const result = validateCapabilityManifest(makeToolManifest(), {
            allowedActions: new Set(['character.validate', 'image.generate']),
        })

        expect(result.valid).toBe(true)
        if (result.valid) expect(result.manifest.capabilityId).toBe('character-creator')
    })

    it('rejects unnamespaced and non-allowlisted actions', () => {
        const malformedAction = makeToolManifest()
        malformedAction.tool!.workflow.steps[0]!.action = 'generate'
        expect(issueCodes(malformedAction)).toContain('INVALID_ACTION_NAME')

        const unregisteredAction = validateCapabilityManifest(makeToolManifest(), {
            allowedActions: new Set(['character.validate']),
        })
        expect(unregisteredAction.issues.map((issue) => issue.code)).toContain('ACTION_NOT_ALLOWED')
    })

    it('rejects workflow dependency cycles and missing dependencies', () => {
        const manifest = makeToolManifest()
        manifest.tool!.workflow.steps[0]!.dependsOn = ['generate']
        manifest.tool!.workflow.steps[1]!.dependsOn = ['missing']

        const codes = issueCodes(manifest)
        expect(codes).toContain('MISSING_REFERENCE')

        manifest.tool!.workflow.steps[1]!.dependsOn = ['validate']
        expect(issueCodes(manifest)).toContain('DEPENDENCY_CYCLE')
    })

    it('rejects step bindings that read from unavailable steps', () => {
        const manifest = makeToolManifest()
        manifest.tool!.workflow.steps[0]!.input = {
            future: { source: 'step', stepId: 'generate', path: ['assetId'] },
        }

        expect(issueCodes(manifest)).toContain('INVALID_BINDING')
    })

    it('requires Tool schemas to be exact manifest schema resources', () => {
        const manifest = makeToolManifest()
        manifest.tool!.inputSchema = {
            ...inputSchema,
            blobHash: 'sha256:different',
            mediaType: 'application/json',
        }

        const codes = issueCodes(manifest)
        expect(codes).toContain('INVALID_SCHEMA')
    })

    it('keeps Skills non-executable and enforces manifest bounds', () => {
        const skill = makeSkillManifest('layout')
        skill.tool = makeToolManifest().tool
        expect(issueCodes(skill)).toContain('INVALID_SCHEMA')

        const oversized = makeSkillManifest('oversized')
        oversized.resources = Array.from({ length: CAPABILITY_LIMITS.maxResources + 1 }, (_, index) => ({
            resourceId: `resource-${index}`,
            blobHash: `sha256:${index}`,
            mediaType: 'text/markdown' as const,
            role: 'instructions' as const,
        }))
        expect(issueCodes(oversized)).toContain('LIMIT_EXCEEDED')
    })

    it('rejects non-finite literal values and excessive retries', () => {
        const manifest = makeToolManifest()
        manifest.tool!.workflow.steps[0]!.input = {
            value: { source: 'literal', value: Number.POSITIVE_INFINITY },
        }
        manifest.tool!.workflow.steps[0]!.retry = {
            maxAttempts: CAPABILITY_LIMITS.maxRetryAttempts + 1,
            backoffMs: CAPABILITY_LIMITS.maxRetryBackoffMs + 1,
        }

        const codes = issueCodes(manifest)
        expect(codes).toContain('INVALID_BINDING')
        expect(codes).toContain('LIMIT_EXCEEDED')
    })
})

// =============================================================================
// CROSS-CAPABILITY GRAPH VALIDATION
// =============================================================================

describe('validateCapabilityDependencyGraph', () => {
    it('accepts Tools and Skills referencing either kind', () => {
        const tool = makeToolManifest()
        tool.references = [{ capabilityId: 'layout', kind: 'skill' }]
        const skill = makeSkillManifest('layout', [{ capabilityId: tool.capabilityId, kind: 'tool' }])
        skill.references = []

        expect(validateCapabilityDependencyGraph([tool, skill], {
            rootCapabilityIds: [tool.capabilityId],
        })).toEqual([])
    })

    it('detects reference cycles, missing targets, and declared-kind mismatches', () => {
        const first = makeSkillManifest('first', [{ capabilityId: 'second', kind: 'tool', import: ['missing-export'] }])
        const second = makeSkillManifest('second', [
            { capabilityId: 'first', kind: 'skill' },
            { capabilityId: 'missing', kind: 'skill' },
        ])

        const issues = validateCapabilityDependencyGraph([first, second], {
            rootCapabilityIds: ['first'],
        })
        const codes = issues.map((issue) => issue.code)

        expect(codes).toContain('REFERENCE_CYCLE')
        expect(codes).toContain('MISSING_REFERENCE')
        expect(codes).toContain('REFERENCE_KIND_MISMATCH')
        expect(issues.some((issue) => issue.message.includes('missing-export'))).toBe(true)
    })

    it('enforces dependency depth and resolved Capability count', () => {
        const manifests = Array.from({ length: 4 }, (_, index) =>
            makeSkillManifest(
                `skill-${index}`,
                index < 3 ? [{ capabilityId: `skill-${index + 1}`, kind: 'skill' as CapabilityKind }] : [],
            ))

        const codes = validateCapabilityDependencyGraph(manifests, {
            rootCapabilityIds: ['skill-0'],
            maxDependencyDepth: 2,
            maxResolvedCapabilities: 2,
        }).map((issue) => issue.code)

        expect(codes).toContain('LIMIT_EXCEEDED')
    })
})
