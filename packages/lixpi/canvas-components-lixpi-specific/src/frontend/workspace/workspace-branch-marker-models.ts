import {
    getBranchMarkerMediaModelCircleDescriptors,
    type BranchMarkerNode,
    type GeneratedOutputCanvasNode,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { normalizeHexColor } from '@lixpi/ui-primitives/gradients'
import {
    type CanvasNode,
} from '@lixpi/constants'
import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'

type BranchMarkerModelDescriptor = {
    modelId: string
    modelProvider?: string
}

type BranchMarkerModelCatalogEntry = {
    provider?: string
    model?: string
    title?: string
    shortTitle?: string
    iconName?: string
    color?: string
}

export type BranchMarkerModelEntry = {
    title: string
    icon: string | null
    color: string | null
}

export type BranchMarkerModelDetail = {
    label: string
    entries: BranchMarkerModelEntry[]
}

export type WorkspaceBranchMarkerModelsPorts = {
    models: WorkspaceCanvasHost['models']
    getCanvasNodes: () => readonly CanvasNode[]
    getGeneratedOutputNodes: (node: BranchMarkerNode) => GeneratedOutputCanvasNode[]
}

export class WorkspaceBranchMarkerModels {
    constructor(private readonly ports: WorkspaceBranchMarkerModelsPorts) {}

    getReasoningModel(node: BranchMarkerNode): BranchMarkerModelEntry | null {
        const entries = this.uniqueEntries(
            this.getReasoningModelDescriptors(node).map(descriptor => this.getModelEntry(descriptor.modelId, descriptor.modelProvider ?? '')).filter(
                (entry): entry is BranchMarkerModelEntry => Boolean(entry),
            ),
        )

        return entries[0] ?? null
    }

    getReasoningDescriptor(node: BranchMarkerNode): BranchMarkerModelDescriptor | undefined {
        return this.getReasoningModelDescriptors(node)[0]
    }

    getDetails(node: BranchMarkerNode): BranchMarkerModelDetail[] {
        const descriptorsByLabel = new Map<string, BranchMarkerModelDescriptor[]>()

        for (const descriptor of getBranchMarkerMediaModelCircleDescriptors(
            node,
            this.ports.getCanvasNodes(),
        )) {
            descriptorsByLabel.set(
                descriptor.label,
                [
                    ...(descriptorsByLabel.get(descriptor.label) ?? []),
                    {
                        modelId: descriptor.modelId,
                        ...(descriptor.modelProvider ? { modelProvider: descriptor.modelProvider } : {}),
                    },
                ],
            )
        }

        return Array.from(
            descriptorsByLabel.entries(),
        ).map(([label, descriptors]) => this.createDetail(label, descriptors)).filter((detail): detail is BranchMarkerModelDetail => Boolean(detail))
    }

    getDescriptors(node: BranchMarkerNode) {
        return getBranchMarkerMediaModelCircleDescriptors(
            node,
            this.ports.getCanvasNodes(),
        )
    }

    getSummary(node: BranchMarkerNode): string {
        return this.getDetails(node).map(detail => `${detail.label}: ${detail.entries.map(entry => entry.title).join(', ')}`)
            .join(' · ')
    }

    getTooltipEntries(node: BranchMarkerNode): Array<{
        label: string
        entry: BranchMarkerModelEntry
    }> {
        return getBranchMarkerMediaModelCircleDescriptors(
            node,
            this.ports.getCanvasNodes(),
        ).map(descriptor => {
            const entry = this.getModelEntry(descriptor.modelId, descriptor.modelProvider ?? '')

            return entry ? {
                label: descriptor.label,
                entry,
            } : null
        }).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    }

    private normalize(value: string | null | undefined): string {
        return String(value ?? '')
            .trim()
            .toLowerCase()
    }

    private splitModelId(modelId: string): {
        provider: string
        model: string
    } {
        const separatorIndex = modelId.indexOf(':')

        if (separatorIndex < 0)
            return {
                provider: '',
                model: modelId,
            }

        return {
            provider: modelId.slice(0, separatorIndex),
            model: modelId.slice(separatorIndex + 1),
        }
    }

    private findModelMeta(
        modelId: string,
        modelProvider: string,
    ): BranchMarkerModelCatalogEntry | null {
        const {
            provider,
            model,
        } = this.splitModelId(modelId)
        const normalizedProvider = this.normalize(provider || modelProvider)
        const normalizedModel = this.normalize(model)
        const normalizedModelId = this.normalize(modelId)
        const models = (this.ports.models.read() ?? []) as BranchMarkerModelCatalogEntry[]

        return (
            models.find(candidate => {
                const candidateProvider = this.normalize(candidate.provider)
                const candidateModel = this.normalize(candidate.model)
                const candidateModelId = this.normalize(`${candidate.provider ?? ''}:${candidate.model ?? ''}`)

                if (normalizedProvider)
                    return candidateProvider === normalizedProvider && candidateModel === normalizedModel

                return candidateModel === normalizedModel || candidateModelId === normalizedModelId
            }) ?? null
        )
    }

    private getModelEntry(
        modelId: string,
        modelProvider = '',
    ): BranchMarkerModelEntry | null {
        if (!modelId)
            return null

        const modelIdParts = this.splitModelId(modelId)
        const providerKey = modelProvider || modelIdParts.provider
        const meta = this.findModelMeta(modelId, providerKey)
        const title = meta?.shortTitle
            ?? meta?.title
            ?? modelIdParts.model
            ?? modelId
        const icon = this.ports.models.modelIcon(meta?.iconName)
            ?? this.ports.models.providerIcon(meta?.provider)
            ?? this.ports.models.providerIcon(providerKey)

        return title ? {
            title,
            icon,
            color: normalizeHexColor(meta?.color),
        } : null
    }

    private uniqueEntries(entries: BranchMarkerModelEntry[]): BranchMarkerModelEntry[] {
        const seen = new Set<string>()
        const uniqueEntries: BranchMarkerModelEntry[] = []

        for (const entry of entries) {
            const key = `${entry.title}:${entry.icon ?? ''}:${entry.color ?? ''}`

            if (seen.has(key))
                continue

            seen.add(key)
            uniqueEntries.push(entry)
        }

        return uniqueEntries
    }

    private createDetail(
        label: string,
        descriptors: BranchMarkerModelDescriptor[],
    ): BranchMarkerModelDetail | null {
        const entries = this.uniqueEntries(
            descriptors.map(descriptor => this.getModelEntry(descriptor.modelId, descriptor.modelProvider ?? '')).filter(
                (entry): entry is BranchMarkerModelEntry => Boolean(entry),
            ),
        )

        return entries.length > 0 ? {
            label,
            entries,
        } : null
    }

    private getReasoningModelDescriptors(node: BranchMarkerNode): BranchMarkerModelDescriptor[] {
        const descriptors: BranchMarkerModelDescriptor[] = []

        if (node.pendingState?.reasoningModelId)
            descriptors.push({ modelId: node.pendingState.reasoningModelId })
        else if (node.pendingState?.reasoningModelIds.length)
            descriptors.push(...node.pendingState.reasoningModelIds.map(modelId => ({ modelId })))

        if (
            node.type === 'branchFork'
            || node.type === 'branchLine'
        ) {
            if (node.reasoningModelId)
                descriptors.push({ modelId: node.reasoningModelId })

            if (node.provenance?.reasoningModelId)
                descriptors.push({ modelId: node.provenance.reasoningModelId })
        }

        for (const outputNode of this.ports.getGeneratedOutputNodes(node)) {
            const reasoningModelId = outputNode.generatedBy?.reasoningModelId

            if (reasoningModelId)
                descriptors.push({ modelId: reasoningModelId })
        }

        return descriptors
    }
}
