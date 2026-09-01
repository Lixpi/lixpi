export type CapabilityMediaExecutionPlan = {
    kind: string
    capabilityRunId: string
}

export type CapabilityMediaDagOutputBinding<BindingMetadata extends object = Record<never, never>> = {
    bindingKey: string
    sourceNodeId: string
    required: boolean
} & BindingMetadata

export type CapabilityMediaDagNodePlan<
    OutputBinding extends CapabilityMediaDagOutputBinding = CapabilityMediaDagOutputBinding,
> = {
    dependsOn: string[]
    outputBindings: OutputBinding[]
}
