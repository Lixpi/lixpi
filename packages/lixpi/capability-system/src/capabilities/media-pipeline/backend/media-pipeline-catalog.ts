import { validateJsonSchemaValue } from '../../../shared/capability-json-schema.ts'
import {
    type MediaPipeline,
    type MediaPipelineIssue,
    type MediaPipelineNode,
    type MediaPipelinePort,
} from '../shared/media-pipeline.ts'
import {
    type MediaPipelineCatalog,
    type MediaPipelineOperationDefinition,
} from './media-pipeline-ports.ts'

export const getExecutableMediaPipelineOperations = (catalog: MediaPipelineCatalog): MediaPipelineOperationDefinition[] => {
    return catalog.operations.filter(
        operation => operation.ready && (
            operation.execution === 'local'
            || catalog.modelRoutes.some(route => isUsableRoute(route) && route.operationKeys.includes(operation.operationKey))
        ),
    )
}

export const inspectMediaPipelineExecutability = (
    pipeline: MediaPipeline,
    catalog: MediaPipelineCatalog,
): MediaPipelineIssue[] => pipeline.nodes.flatMap(node => inspectNode(node, catalog))

const inspectNode = (
    node: MediaPipelineNode,
    catalog: MediaPipelineCatalog,
): MediaPipelineIssue[] => {
    const issue = (
        code: string,
        message: string,
    ): MediaPipelineIssue[] => [{
        code,
        message,
        nodeId: node.nodeId,
        recoverable: true,
    }]
    const operation = catalog.operations.find(candidate => candidate.operationKey === node.operationKey)

    if (!operation?.ready)
        return issue('PIPELINE_OPERATION_UNAVAILABLE', `Operation ${node.operationKey} has no installed, ready executor.`)

    if (
        !samePorts(
            node.inputs,
            operation.inputPorts,
            true,
        )
        || !samePorts(node.outputs, operation.outputPorts)
    )
        return issue('PIPELINE_OPERATION_PORTS_INVALID', 'Node ports must match the installed operation contract.')

    const validation = validateJsonSchemaValue(operation.parameterSchema, node.parameters)

    if (!validation.valid)
        return issue(
            'PIPELINE_OPERATION_PARAMETERS_INVALID',
            validation.errors.join('; '),
        )

    if (operation.execution === 'local')
        return node.modelId ? issue('PIPELINE_LOCAL_MODEL_FORBIDDEN', 'Local operations cannot select an inference model.') : []

    const route = catalog.modelRoutes.find(candidate => candidate.modelId === node.modelId)

    if (
        !route
        || !isUsableRoute(route)
        || !route.operationKeys.includes(operation.operationKey)
    )
        return issue('PIPELINE_MODEL_ROUTE_UNAVAILABLE', 'The selected model has no usable configured provider route for this installed operation.')

    if (
        node.inputs.some(port => !route.inputKinds.includes(port.kind))
        || node.outputs.some(port => !route.outputKinds.includes(port.kind))
    )
        return issue('PIPELINE_MODEL_PORTS_UNSUPPORTED', 'The synchronized model route does not support these input and output kinds.')

    return []
}

const isUsableRoute = (route: MediaPipelineCatalog['modelRoutes'][number]): boolean => {
    return Boolean(route.inferenceProviderCalledByThePlatform)
        && route.adapterReady && route.credentialsReady && route.regionReady && route.pricingReady
}

const samePorts = (
    actual: MediaPipelinePort[],
    expected: MediaPipelinePort[],
    allowOmittedOptional = false,
): boolean => {
    const required = allowOmittedOptional ? expected.filter(port => port.required || actual.some(candidate => candidate.portId === port.portId)) : expected

    return actual.length === required.length && required.every(
        port => actual.some(
            candidate => (
                candidate.portId === port.portId && candidate.kind === port.kind && candidate.required === port.required
            ),
        ),
    )
}
