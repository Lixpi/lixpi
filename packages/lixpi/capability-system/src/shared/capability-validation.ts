import {
    type CapabilityJsonValue,
    type CapabilityManifest,
    type CapabilityResourceRef,
    type CapabilityWorkflowStep,
} from '@lixpi/constants'

export const CAPABILITY_LIMITS = {
    maxConditionDepth: 8,
    maxDependencyDepth: 8,
    maxResolvedCapabilities: 64,
    maxResources: 128,
    maxAggregateResourceBytes: 32 * 1024 * 1024,
    maxAggregateTextResourceBytes: 1024 * 1024,
    maxWorkflowSteps: 128,
    maxRetryAttempts: 3,
    maxRetryBackoffMs: 60000,
} as const

export type CapabilityValidationIssueCode =
    | 'INVALID_SCHEMA'
    | 'INVALID_ACTION_NAME'
    | 'ACTION_NOT_ALLOWED'
    | 'DUPLICATE_ID'
    | 'MISSING_REFERENCE'
    | 'REFERENCE_KIND_MISMATCH'
    | 'DEPENDENCY_CYCLE'
    | 'REFERENCE_CYCLE'
    | 'LIMIT_EXCEEDED'
    | 'INVALID_BINDING'

export type CapabilityValidationIssue = {
    code: CapabilityValidationIssueCode
    path: string
    message: string
}

export type CapabilityManifestValidationOptions = {
    allowedActions?: ReadonlySet<string>
}

export type CapabilityManifestValidationResult =
    | { valid: true; manifest: CapabilityManifest; issues: [] }
    | { valid: false; issues: CapabilityValidationIssue[] }

export type CapabilityGraphValidationOptions = {
    rootCapabilityIds?: string[]
    maxDependencyDepth?: number
    maxResolvedCapabilities?: number
    maxResources?: number
}

const ACTION_NAME_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const TOOL_TYPE_PATTERN = /^[a-z][a-z0-9-]*$/
const CAPABILITY_KINDS = new Set(['tool', 'skill'])
const RESOURCE_ROLES = new Set(['instructions', 'reference', 'schema', 'example', 'asset'])
const COMPARISON_OPERATORS = new Set([
    'equals',
    'not-equals',
    'greater-than',
    'greater-than-or-equal',
    'less-than',
    'less-than-or-equal',
    'contains',
])

export function validateCapabilityManifest(
    input: unknown,
    options: CapabilityManifestValidationOptions = {},
): CapabilityManifestValidationResult {
    const issues: CapabilityValidationIssue[] = []
    const manifest = asRecord(input)
    if (!manifest) {
        addIssue(issues, 'INVALID_SCHEMA', '$', 'Manifest must be an object')
        return { valid: false, issues }
    }

    validateLiteral(manifest.schemaVersion, 1, '$.schemaVersion', issues)
    validateIdentifier(manifest.capabilityId, '$.capabilityId', issues)
    validateEnum(manifest.kind, CAPABILITY_KINDS, '$.kind', issues)
    validateNonEmptyString(manifest.name, '$.name', issues)
    validateNonEmptyString(manifest.description, '$.description', issues)

    const references = validateReferences(manifest.references, issues)
    const resources = validateResources(manifest.resources, issues)
    validateExports(manifest.exports, resources, issues, options)

    if (manifest.kind === 'tool') {
        validateToolDefinition(manifest.tool, resources, issues, options)
    } else if (manifest.kind === 'skill' && manifest.tool !== undefined) {
        addIssue(issues, 'INVALID_SCHEMA', '$.tool', 'Skill manifests cannot define a Tool workflow')
    }

    if (references.length > CAPABILITY_LIMITS.maxResolvedCapabilities) {
        addIssue(
            issues,
            'LIMIT_EXCEEDED',
            '$.references',
            `Manifest references exceed ${CAPABILITY_LIMITS.maxResolvedCapabilities}`,
        )
    }

    if (issues.length > 0) return { valid: false, issues }
    return { valid: true, manifest: input as CapabilityManifest, issues: [] }
}

export function validateCapabilityDependencyGraph(
    manifests: readonly CapabilityManifest[],
    options: CapabilityGraphValidationOptions = {},
): CapabilityValidationIssue[] {
    const issues: CapabilityValidationIssue[] = []
    const manifestById = new Map<string, CapabilityManifest>()

    for (const manifest of manifests) {
        if (manifestById.has(manifest.capabilityId)) {
            addIssue(
                issues,
                'DUPLICATE_ID',
                `$.manifests.${manifest.capabilityId}`,
                `Capability ${manifest.capabilityId} is defined more than once`,
            )
            continue
        }
        manifestById.set(manifest.capabilityId, manifest)
    }

    const rootCapabilityIds = options.rootCapabilityIds ?? [...manifestById.keys()]
    const maxDepth = options.maxDependencyDepth ?? CAPABILITY_LIMITS.maxDependencyDepth
    const maxCapabilities = options.maxResolvedCapabilities ?? CAPABILITY_LIMITS.maxResolvedCapabilities
    const maxResources = options.maxResources ?? CAPABILITY_LIMITS.maxResources
    const visited = new Set<string>()
    const visiting: string[] = []
    let resourceCount = 0

    const visit = (capabilityId: string, depth: number): void => {
        const manifest = manifestById.get(capabilityId)
        if (!manifest) {
            addIssue(
                issues,
                'MISSING_REFERENCE',
                `$.manifests.${capabilityId}`,
                `Referenced Capability ${capabilityId} is missing`,
            )
            return
        }

        if (depth > maxDepth) {
            addIssue(
                issues,
                'LIMIT_EXCEEDED',
                `$.manifests.${capabilityId}`,
                `Capability dependency depth exceeds ${maxDepth}`,
            )
            return
        }

        const cycleStart = visiting.indexOf(capabilityId)
        if (cycleStart >= 0) {
            const cycle = [...visiting.slice(cycleStart), capabilityId].join(' -> ')
            addIssue(issues, 'REFERENCE_CYCLE', `$.manifests.${capabilityId}`, `Capability reference cycle: ${cycle}`)
            return
        }
        if (visited.has(capabilityId)) return

        visiting.push(capabilityId)
        visited.add(capabilityId)
        resourceCount += manifest.resources.length

        if (visited.size > maxCapabilities) {
            addIssue(
                issues,
                'LIMIT_EXCEEDED',
                '$.manifests',
                `Resolved Capability count exceeds ${maxCapabilities}`,
            )
        }
        if (resourceCount > maxResources) {
            addIssue(
                issues,
                'LIMIT_EXCEEDED',
                '$.manifests',
                `Resolved resource count exceeds ${maxResources}`,
            )
        }

        for (const reference of manifest.references) {
            const target = manifestById.get(reference.capabilityId)
            if (!target) {
                addIssue(
                    issues,
                    'MISSING_REFERENCE',
                    `$.manifests.${capabilityId}.references`,
                    `Referenced Capability ${reference.capabilityId} is missing`,
                )
                continue
            }
            if (target.kind !== reference.kind) {
                addIssue(
                    issues,
                    'REFERENCE_KIND_MISMATCH',
                    `$.manifests.${capabilityId}.references`,
                    `Reference ${reference.capabilityId} declares ${reference.kind} but resolves to ${target.kind}`,
                )
            }
            const exportedNames = new Set([
                ...Object.keys(target.exports?.instructions ?? {}),
                ...Object.keys(target.exports?.stepTemplates ?? {}),
            ])
            for (const importedName of reference.import ?? []) {
                if (!exportedNames.has(importedName)) {
                    addIssue(
                        issues,
                        'MISSING_REFERENCE',
                        `$.manifests.${capabilityId}.references`,
                        `Import ${importedName} is not exported by ${reference.capabilityId}`,
                    )
                }
            }
            visit(reference.capabilityId, depth + 1)
        }

        visiting.pop()
    }

    for (const rootCapabilityId of rootCapabilityIds) visit(rootCapabilityId, 1)
    return deduplicateIssues(issues)
}

function validateReferences(input: unknown, issues: CapabilityValidationIssue[]): Array<Record<string, unknown>> {
    if (!Array.isArray(input)) {
        addIssue(issues, 'INVALID_SCHEMA', '$.references', 'References must be an array')
        return []
    }

    return input.flatMap((entry, index) => {
        const reference = asRecord(entry)
        const path = `$.references[${index}]`
        if (!reference) {
            addIssue(issues, 'INVALID_SCHEMA', path, 'Reference must be an object')
            return []
        }
        validateIdentifier(reference.capabilityId, `${path}.capabilityId`, issues)
        validateEnum(reference.kind, CAPABILITY_KINDS, `${path}.kind`, issues)
        validateStringArray(reference.import, `${path}.import`, issues, true)
        return [reference]
    })
}

function validateResources(input: unknown, issues: CapabilityValidationIssue[]): CapabilityResourceRef[] {
    if (!Array.isArray(input)) {
        addIssue(issues, 'INVALID_SCHEMA', '$.resources', 'Resources must be an array')
        return []
    }
    if (input.length > CAPABILITY_LIMITS.maxResources) {
        addIssue(
            issues,
            'LIMIT_EXCEEDED',
            '$.resources',
            `Manifest resources exceed ${CAPABILITY_LIMITS.maxResources}`,
        )
    }

    const resources: CapabilityResourceRef[] = []
    const resourceIds = new Set<string>()
    for (const [index, entry] of input.entries()) {
        const resource = asRecord(entry)
        const path = `$.resources[${index}]`
        if (!resource) {
            addIssue(issues, 'INVALID_SCHEMA', path, 'Resource must be an object')
            continue
        }
        validateIdentifier(resource.resourceId, `${path}.resourceId`, issues)
        validateNonEmptyString(resource.blobHash, `${path}.blobHash`, issues)
        validateResourceMediaType(resource.mediaType, `${path}.mediaType`, issues)
        validateEnum(resource.role, RESOURCE_ROLES, `${path}.role`, issues)
        if (resource.name !== undefined) validateNonEmptyString(resource.name, `${path}.name`, issues)
        if (typeof resource.resourceId === 'string') {
            if (resourceIds.has(resource.resourceId)) {
                addIssue(issues, 'DUPLICATE_ID', `${path}.resourceId`, `Duplicate resourceId ${resource.resourceId}`)
            }
            resourceIds.add(resource.resourceId)
        }
        resources.push(resource as CapabilityResourceRef)
    }
    return resources
}

function validateExports(
    input: unknown,
    resources: CapabilityResourceRef[],
    issues: CapabilityValidationIssue[],
    options: CapabilityManifestValidationOptions,
): void {
    if (input === undefined) return
    const exports = asRecord(input)
    if (!exports) {
        addIssue(issues, 'INVALID_SCHEMA', '$.exports', 'Exports must be an object')
        return
    }
    const resourceIds = new Set(resources.map((resource) => resource.resourceId))
    const instructions = asRecord(exports.instructions)
    if (exports.instructions !== undefined && !instructions) {
        addIssue(issues, 'INVALID_SCHEMA', '$.exports.instructions', 'Instruction exports must be an object')
    }
    for (const [name, entry] of Object.entries(instructions ?? {})) {
        const instruction = asRecord(entry)
        const path = `$.exports.instructions.${name}`
        if (!instruction) {
            addIssue(issues, 'INVALID_SCHEMA', path, 'Instruction export must be an object')
            continue
        }
        const exportedResourceIds = validateStringArray(instruction.resourceIds, `${path}.resourceIds`, issues)
        for (const resourceId of exportedResourceIds) {
            if (!resourceIds.has(resourceId)) {
                addIssue(issues, 'MISSING_REFERENCE', `${path}.resourceIds`, `Resource ${resourceId} is not in the manifest`)
            }
        }
    }

    const stepTemplates = asRecord(exports.stepTemplates)
    if (exports.stepTemplates !== undefined && !stepTemplates) {
        addIssue(issues, 'INVALID_SCHEMA', '$.exports.stepTemplates', 'Step template exports must be an object')
    }
    for (const [name, entry] of Object.entries(stepTemplates ?? {})) {
        const template = asRecord(entry)
        const path = `$.exports.stepTemplates.${name}`
        if (!template) {
            addIssue(issues, 'INVALID_SCHEMA', path, 'Step template export must be an object')
            continue
        }
        validateWorkflow({ steps: template.steps, outputs: template.outputs }, `${path}`, resources, issues, options)
    }
}

function validateToolDefinition(
    input: unknown,
    resources: CapabilityResourceRef[],
    issues: CapabilityValidationIssue[],
    options: CapabilityManifestValidationOptions,
): void {
    const tool = asRecord(input)
    if (!tool) {
        addIssue(issues, 'INVALID_SCHEMA', '$.tool', 'Tool manifests must define a Tool definition')
        return
    }
    if (typeof tool.toolType !== 'string' || !TOOL_TYPE_PATTERN.test(tool.toolType)) {
        addIssue(issues, 'INVALID_SCHEMA', '$.tool.toolType', 'Tool type must be a lowercase kebab-case identifier')
    }
    validateEnum(tool.executionPolicy, new Set(['required', 'model-required', 'model-choice']), '$.tool.executionPolicy', issues)
    validateEnum(
        tool.executionMultiplicity,
        new Set(['once', 'per-reasoning-model']),
        '$.tool.executionMultiplicity',
        issues,
    )
    validateModelAxisPolicy(tool.modelAxisPolicy, issues)
    validateSchemaResource(tool.inputSchema, '$.tool.inputSchema', resources, issues)
    validateSchemaResource(tool.outputSchema, '$.tool.outputSchema', resources, issues)
    validateWorkflow(tool.workflow, '$.tool.workflow', resources, issues, options)
}

function validateModelAxisPolicy(input: unknown, issues: CapabilityValidationIssue[]): void {
    const policy = asRecord(input)
    if (!policy) {
        addIssue(issues, 'INVALID_SCHEMA', '$.tool.modelAxisPolicy', 'Tool model-axis policy must be an object')
        return
    }
    validateEnum(policy.reasoning, new Set(['all-selected', 'first-selected', 'ignore']), '$.tool.modelAxisPolicy.reasoning', issues)
    validateEnum(policy.image, new Set(['all-selected', 'ignore']), '$.tool.modelAxisPolicy.image', issues)
    validateEnum(policy.video, new Set(['all-selected', 'ignore']), '$.tool.modelAxisPolicy.video', issues)
    validateEnum(
        policy.outputMode,
        new Set(['capability-only', 'continue-media-generation']),
        '$.tool.modelAxisPolicy.outputMode',
        issues,
    )
}

function validateSchemaResource(
    input: unknown,
    path: string,
    resources: CapabilityResourceRef[],
    issues: CapabilityValidationIssue[],
): void {
    const schemaRef = asRecord(input)
    if (!schemaRef) {
        addIssue(issues, 'INVALID_SCHEMA', path, 'Schema reference must be an object')
        return
    }
    validateIdentifier(schemaRef.resourceId, `${path}.resourceId`, issues)
    if (schemaRef.mediaType !== 'application/schema+json') {
        addIssue(issues, 'INVALID_SCHEMA', `${path}.mediaType`, 'Tool schemas must use application/schema+json')
    }
    if (schemaRef.role !== 'schema') {
        addIssue(issues, 'INVALID_SCHEMA', `${path}.role`, 'Tool schemas must use the schema resource role')
    }
    const matchingResource = resources.find((resource) => resource.resourceId === schemaRef.resourceId)
    if (!matchingResource) {
        addIssue(issues, 'MISSING_REFERENCE', path, `Schema resource ${String(schemaRef.resourceId)} is not in the manifest`)
        return
    }
    if (
        matchingResource.blobHash !== schemaRef.blobHash
        || matchingResource.mediaType !== schemaRef.mediaType
        || matchingResource.role !== schemaRef.role
    ) {
        addIssue(issues, 'INVALID_SCHEMA', path, 'Schema reference must exactly match its manifest resource')
    }
}

function validateWorkflow(
    input: unknown,
    path: string,
    resources: CapabilityResourceRef[],
    issues: CapabilityValidationIssue[],
    options: CapabilityManifestValidationOptions,
): void {
    const workflow = asRecord(input)
    if (!workflow) {
        addIssue(issues, 'INVALID_SCHEMA', path, 'Workflow must be an object')
        return
    }
    if (!Array.isArray(workflow.steps)) {
        addIssue(issues, 'INVALID_SCHEMA', `${path}.steps`, 'Workflow steps must be an array')
        return
    }
    if (workflow.steps.length === 0) {
        addIssue(issues, 'INVALID_SCHEMA', `${path}.steps`, 'Workflow must contain at least one step')
    }
    if (workflow.steps.length > CAPABILITY_LIMITS.maxWorkflowSteps) {
        addIssue(
            issues,
            'LIMIT_EXCEEDED',
            `${path}.steps`,
            `Workflow steps exceed ${CAPABILITY_LIMITS.maxWorkflowSteps}`,
        )
    }

    const steps: CapabilityWorkflowStep[] = []
    const stepIds = new Set<string>()
    for (const [index, entry] of workflow.steps.entries()) {
        const step = asRecord(entry)
        const stepPath = `${path}.steps[${index}]`
        if (!step) {
            addIssue(issues, 'INVALID_SCHEMA', stepPath, 'Workflow step must be an object')
            continue
        }
        validateIdentifier(step.stepId, `${stepPath}.stepId`, issues)
        validateNonEmptyString(step.title, `${stepPath}.title`, issues)
        validateAction(step.action, `${stepPath}.action`, issues, options.allowedActions)
        validateStringArray(step.dependsOn, `${stepPath}.dependsOn`, issues)
        validateBindingRecord(step.input, `${stepPath}.input`, resources, issues)
        if (step.condition !== undefined) {
            validateCondition(step.condition, `${stepPath}.condition`, resources, issues, 1)
        }
        validateRetry(step.retry, `${stepPath}.retry`, issues)
        validateProgress(step.progress, `${stepPath}.progress`, issues)
        if (typeof step.stepId === 'string') {
            if (stepIds.has(step.stepId)) {
                addIssue(issues, 'DUPLICATE_ID', `${stepPath}.stepId`, `Duplicate stepId ${step.stepId}`)
            }
            stepIds.add(step.stepId)
        }
        steps.push(step as CapabilityWorkflowStep)
    }

    validateStepGraph(steps, path, issues)
    validateStepBindings(steps, path, resources, issues)
    validateBindingRecord(workflow.outputs, `${path}.outputs`, resources, issues, stepIds)
}

function validateStepGraph(
    steps: CapabilityWorkflowStep[],
    path: string,
    issues: CapabilityValidationIssue[],
): void {
    const stepIds = new Set(steps.map((step) => step.stepId))
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const stepById = new Map(steps.map((step) => [step.stepId, step]))

    const visit = (stepId: string, chain: string[]): void => {
        if (visiting.has(stepId)) {
            addIssue(
                issues,
                'DEPENDENCY_CYCLE',
                `${path}.steps`,
                `Workflow dependency cycle: ${[...chain, stepId].join(' -> ')}`,
            )
            return
        }
        if (visited.has(stepId)) return
        visiting.add(stepId)
        const step = stepById.get(stepId)
        for (const dependencyId of step?.dependsOn ?? []) visit(dependencyId, [...chain, stepId])
        visiting.delete(stepId)
        visited.add(stepId)
    }

    for (const [index, step] of steps.entries()) {
        for (const dependencyId of step.dependsOn) {
            if (!stepIds.has(dependencyId)) {
                addIssue(
                    issues,
                    'MISSING_REFERENCE',
                    `${path}.steps[${index}].dependsOn`,
                    `Dependency ${dependencyId} does not name a workflow step`,
                )
            }
        }
        visit(step.stepId, [])
    }
}

function validateStepBindings(
    steps: CapabilityWorkflowStep[],
    path: string,
    resources: CapabilityResourceRef[],
    issues: CapabilityValidationIssue[],
): void {
    const stepById = new Map(steps.map((step) => [step.stepId, step]))
    const dependenciesFor = (stepId: string, found = new Set<string>()): Set<string> => {
        for (const dependencyId of stepById.get(stepId)?.dependsOn ?? []) {
            if (found.has(dependencyId)) continue
            found.add(dependencyId)
            dependenciesFor(dependencyId, found)
        }
        return found
    }

    for (const [index, step] of steps.entries()) {
        const allowedStepIds = dependenciesFor(step.stepId)
        validateBindingRecord(step.input, `${path}.steps[${index}].input`, resources, issues, allowedStepIds)
        if (step.condition !== undefined) {
            validateCondition(step.condition, `${path}.steps[${index}].condition`, resources, issues, 1, allowedStepIds)
        }
    }
}

function validateBindingRecord(
    input: unknown,
    path: string,
    resources: CapabilityResourceRef[],
    issues: CapabilityValidationIssue[],
    allowedStepIds?: ReadonlySet<string>,
): void {
    const bindings = asRecord(input)
    if (!bindings) {
        addIssue(issues, 'INVALID_SCHEMA', path, 'Bindings must be an object')
        return
    }
    for (const [key, binding] of Object.entries(bindings)) {
        validateBinding(binding, `${path}.${key}`, resources, issues, allowedStepIds)
    }
}

function validateBinding(
    input: unknown,
    path: string,
    resources: CapabilityResourceRef[],
    issues: CapabilityValidationIssue[],
    allowedStepIds?: ReadonlySet<string>,
): void {
    const binding = asRecord(input)
    if (!binding || typeof binding.source !== 'string') {
        addIssue(issues, 'INVALID_BINDING', path, 'Value binding must be a discriminated object')
        return
    }
    if (binding.source === 'input') {
        validateStringArray(binding.path, `${path}.path`, issues)
        return
    }
    if (binding.source === 'step') {
        validateIdentifier(binding.stepId, `${path}.stepId`, issues)
        validateStringArray(binding.path, `${path}.path`, issues)
        if (allowedStepIds && typeof binding.stepId === 'string' && !allowedStepIds.has(binding.stepId)) {
            addIssue(issues, 'INVALID_BINDING', `${path}.stepId`, `Step ${binding.stepId} is not an available dependency`)
        }
        return
    }
    if (binding.source === 'resource') {
        validateIdentifier(binding.resourceId, `${path}.resourceId`, issues)
        if (binding.capabilityId !== undefined) validateIdentifier(binding.capabilityId, `${path}.capabilityId`, issues)
        const isLocal = binding.capabilityId === undefined
        if (isLocal && !resources.some((resource) => resource.resourceId === binding.resourceId)) {
            addIssue(issues, 'MISSING_REFERENCE', `${path}.resourceId`, `Resource ${String(binding.resourceId)} is not in the manifest`)
        }
        return
    }
    if (binding.source === 'literal') {
        if (!isJsonValue(binding.value)) {
            addIssue(issues, 'INVALID_BINDING', `${path}.value`, 'Literal binding must contain a finite JSON value')
        }
        return
    }
    addIssue(issues, 'INVALID_BINDING', `${path}.source`, `Unsupported binding source ${binding.source}`)
}

function validateCondition(
    input: unknown,
    path: string,
    resources: CapabilityResourceRef[],
    issues: CapabilityValidationIssue[],
    depth: number,
    allowedStepIds?: ReadonlySet<string>,
): void {
    if (depth > CAPABILITY_LIMITS.maxConditionDepth) {
        addIssue(
            issues,
            'LIMIT_EXCEEDED',
            path,
            `Condition depth exceeds ${CAPABILITY_LIMITS.maxConditionDepth}`,
        )
        return
    }
    const condition = asRecord(input)
    if (!condition || typeof condition.type !== 'string') {
        addIssue(issues, 'INVALID_SCHEMA', path, 'Condition must be a discriminated object')
        return
    }
    if (condition.type === 'compare') {
        validateBinding(condition.left, `${path}.left`, resources, issues, allowedStepIds)
        validateEnum(condition.operator, COMPARISON_OPERATORS, `${path}.operator`, issues)
        validateBinding(condition.right, `${path}.right`, resources, issues, allowedStepIds)
        return
    }
    if (condition.type === 'exists') {
        validateBinding(condition.value, `${path}.value`, resources, issues, allowedStepIds)
        return
    }
    if (condition.type === 'all' || condition.type === 'any') {
        if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
            addIssue(issues, 'INVALID_SCHEMA', `${path}.conditions`, 'Condition group must be a non-empty array')
            return
        }
        for (const [index, child] of condition.conditions.entries()) {
            validateCondition(child, `${path}.conditions[${index}]`, resources, issues, depth + 1, allowedStepIds)
        }
        return
    }
    if (condition.type === 'not') {
        validateCondition(condition.condition, `${path}.condition`, resources, issues, depth + 1, allowedStepIds)
        return
    }
    addIssue(issues, 'INVALID_SCHEMA', `${path}.type`, `Unsupported condition type ${condition.type}`)
}

function validateRetry(input: unknown, path: string, issues: CapabilityValidationIssue[]): void {
    if (input === undefined) return
    const retry = asRecord(input)
    if (!retry) {
        addIssue(issues, 'INVALID_SCHEMA', path, 'Retry policy must be an object')
        return
    }
    if (!Number.isInteger(retry.maxAttempts) || Number(retry.maxAttempts) < 1 || Number(retry.maxAttempts) > CAPABILITY_LIMITS.maxRetryAttempts) {
        addIssue(
            issues,
            'LIMIT_EXCEEDED',
            `${path}.maxAttempts`,
            `Retry attempts must be between 1 and ${CAPABILITY_LIMITS.maxRetryAttempts}`,
        )
    }
    if (!Number.isInteger(retry.backoffMs) || Number(retry.backoffMs) < 0 || Number(retry.backoffMs) > CAPABILITY_LIMITS.maxRetryBackoffMs) {
        addIssue(
            issues,
            'LIMIT_EXCEEDED',
            `${path}.backoffMs`,
            `Retry backoff must be between 0 and ${CAPABILITY_LIMITS.maxRetryBackoffMs}ms`,
        )
    }
}

function validateProgress(input: unknown, path: string, issues: CapabilityValidationIssue[]): void {
    const progress = asRecord(input)
    if (!progress) {
        addIssue(issues, 'INVALID_SCHEMA', path, 'Progress metadata must be an object')
        return
    }
    if (progress.group !== undefined) validateNonEmptyString(progress.group, `${path}.group`, issues)
    if (progress.exposeReasoning !== undefined && typeof progress.exposeReasoning !== 'boolean') {
        addIssue(issues, 'INVALID_SCHEMA', `${path}.exposeReasoning`, 'exposeReasoning must be boolean')
    }
}

function validateAction(
    input: unknown,
    path: string,
    issues: CapabilityValidationIssue[],
    allowedActions?: ReadonlySet<string>,
): void {
    if (typeof input !== 'string' || !ACTION_NAME_PATTERN.test(input)) {
        addIssue(issues, 'INVALID_ACTION_NAME', path, 'Action must use a namespaced lowercase key such as image.generate')
        return
    }
    if (allowedActions && !allowedActions.has(input)) {
        addIssue(issues, 'ACTION_NOT_ALLOWED', path, `Action ${input} is not registered for this Tool`)
    }
}

function validateResourceMediaType(input: unknown, path: string, issues: CapabilityValidationIssue[]): void {
    const valid = input === 'application/json'
        || input === 'application/schema+json'
        || input === 'text/markdown'
        || (typeof input === 'string' && input.startsWith('image/') && input.length > 'image/'.length)
    if (!valid) addIssue(issues, 'INVALID_SCHEMA', path, 'Unsupported Capability resource media type')
}

function validateIdentifier(input: unknown, path: string, issues: CapabilityValidationIssue[]): void {
    if (typeof input !== 'string' || !IDENTIFIER_PATTERN.test(input)) {
        addIssue(issues, 'INVALID_SCHEMA', path, 'Identifier must be a non-empty stable token')
    }
}

function validateNonEmptyString(input: unknown, path: string, issues: CapabilityValidationIssue[]): void {
    if (typeof input !== 'string' || input.trim().length === 0) {
        addIssue(issues, 'INVALID_SCHEMA', path, 'Value must be a non-empty string')
    }
}

function validateStringArray(
    input: unknown,
    path: string,
    issues: CapabilityValidationIssue[],
    optional = false,
): string[] {
    if (optional && input === undefined) return []
    if (!Array.isArray(input) || input.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
        addIssue(issues, 'INVALID_SCHEMA', path, 'Value must be an array of non-empty strings')
        return []
    }
    return input as string[]
}

function validateEnum(
    input: unknown,
    allowed: ReadonlySet<string>,
    path: string,
    issues: CapabilityValidationIssue[],
): void {
    if (typeof input !== 'string' || !allowed.has(input)) {
        addIssue(issues, 'INVALID_SCHEMA', path, `Value must be one of: ${[...allowed].join(', ')}`)
    }
}

function validateLiteral(
    input: unknown,
    expected: string | number,
    path: string,
    issues: CapabilityValidationIssue[],
): void {
    if (input !== expected) addIssue(issues, 'INVALID_SCHEMA', path, `Value must be ${expected}`)
}

function isJsonValue(input: unknown): input is CapabilityJsonValue {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return true
    if (typeof input === 'number') return Number.isFinite(input)
    if (Array.isArray(input)) return input.every(isJsonValue)
    const record = asRecord(input)
    return record !== null && Object.values(record).every(isJsonValue)
}

function asRecord(input: unknown): Record<string, unknown> | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null
    return input as Record<string, unknown>
}

function addIssue(
    issues: CapabilityValidationIssue[],
    code: CapabilityValidationIssueCode,
    path: string,
    message: string,
): void {
    issues.push({ code, path, message })
}

function deduplicateIssues(issues: CapabilityValidationIssue[]): CapabilityValidationIssue[] {
    const seen = new Set<string>()
    return issues.filter((issue) => {
        const key = `${issue.code}:${issue.path}:${issue.message}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}
