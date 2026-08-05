'use strict'

export type CapabilityMediaExecutionPlan = {
    kind: string
    capabilityRunId: string
}

export type CapabilityMediaDagOutputBinding = {
    bindingKey: string
    sourceNodeId: string
    required: boolean
}

export type CapabilityMediaDagNodePlan = {
    dependsOn: string[]
    outputBindings: CapabilityMediaDagOutputBinding[]
}
