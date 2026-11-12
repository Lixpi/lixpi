import { canvasNodeExamples } from './nodes.ts'

export type CanvasDomain = {
    id: string
    title: string
    group: string
    examples: readonly string[]
}

export const canvasDomains: readonly CanvasDomain[] = [
    {
        id: 'nodes',
        title: 'Nodes',
        group: 'Canvas',
        examples: canvasNodeExamples.map(example => example.id),
    },
    {
        id: 'connectors',
        title: 'Connectors',
        group: 'Canvas',
        examples: ['engine-connector-matrix', 'engine-routing', 'engine-proximity'],
    },
    {
        id: 'interaction',
        title: 'Interaction',
        group: 'Canvas',
        examples: ['engine-multiple', 'engine-validation'],
    },
    {
        id: "stress",
        title: "Large scenes",
        group: "Stress testing",
        examples: ["engine-large-scene"],
    },
    {
        id: 'arrangement',
        title: 'Arrangement',
        group: 'Layout',
        examples: ['engine-parenting'],
    },
    {
        id: 'trees',
        title: 'Tree layout',
        group: 'Layout',
        examples: ['engine-tidy-tree'],
    },
    {
        id: 'collisions',
        title: 'Collisions',
        group: 'Layout',
        examples: ['engine-collisions'],
    },
    {
        id: 'effects',
        title: 'Effects and loading',
        group: 'Composition',
        examples: ['effects-glass', 'effects-outline', 'loading-overlay', 'loading-layer'],
    },
    {
        id: 'workspace',
        title: 'Workspace components',
        group: 'Composition',
        examples: ['workspace-libraries', 'workspace-context', 'workspace-progress-review'],
    },
    {
        id: "input",
        title: "Input and agentic chat",
        group: "Composition",
        examples: ["workspace-conversation", "workspace-history", "workspace-right-panel"],
    },
    {
        id: 'nested-list',
        title: 'Nested list',
        group: 'Reference',
        examples: ['nested-list'],
    },
    {
        id: 'icons',
        title: 'Icons',
        group: 'Reference',
        examples: ['icons'],
    },
]

export const getCanvasDomain = (exampleId: string): CanvasDomain | undefined => canvasDomains.find(domain => domain.examples.includes(exampleId))
