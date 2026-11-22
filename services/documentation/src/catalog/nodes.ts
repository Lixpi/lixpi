import {
    type CanvasNode,
} from '@lixpi/constants'
import { componentCoverage } from './coverage.ts'
import {
    type DocumentationExample,
} from './catalog.ts'

export type CanvasNodePage = {
    id: string
    title: string
    nodeType: string
    nodeTypes?: readonly CanvasNode['type'][]
    mode: string
}

export const canvasNodePages: readonly CanvasNodePage[] = [
    {
        id: 'node-image',
        title: 'Image',
        nodeType: 'image',
        mode: 'media-images',
    },
    {
        id: 'node-video',
        title: 'Video',
        nodeType: 'video',
        mode: 'media-playback',
    },
    {
        id: 'node-audio',
        title: 'Audio',
        nodeType: 'audio',
        mode: 'media-playback',
    },
    {
        id: 'node-lixpi-document',
        title: 'Document',
        nodeType: 'document',
        mode: 'workspace-canvas',
    },
    {
        id: 'node-lixpi-media-document',
        title: 'Uploaded document',
        nodeType: 'mediaDocument',
        mode: 'workspace-canvas',
    },
    {
        id: 'node-lixpi-operation',
        title: 'Operation status',
        nodeType: 'operationStatus',
        mode: 'workspace-canvas',
    },
    {
        id: 'node-lixpi-branches',
        title: 'Branches',
        nodeType: 'branchOrigin',
        nodeTypes: ['branchOrigin', 'branchFork', 'branchLine'],
        mode: 'workspace-canvas',
    },
    {
        id: 'node-lixpi-artifact',
        title: 'Capability Artifact',
        nodeType: 'capabilityArtifact',
        mode: 'workspace-canvas',
    },
]

export const workspaceCanvasNodeTypes: readonly CanvasNode['type'][] = canvasNodePages.filter(page => page.mode === 'workspace-canvas').flatMap(
    page => page.nodeTypes ?? [page.nodeType as CanvasNode['type']],
)

const nodeDescriptions: Record<string, string> = {
    'node-image': 'One image registration supports contain, cover and stretch. Change the fit, resize the image or retry a failed load.',
    'node-video': 'Native video with shared PlaybackControls and UI-kit SVG controls.',
    'node-audio': 'Native audio with shared PlaybackControls and UI-kit SVG controls.',
    'node-lixpi-document': 'The original document canvas node plus editable, read-only lease, loading and retryable editor-mount states.',
    'node-lixpi-media-document': 'A read-only file added to the canvas as prompt context, shown as a picture of its first page. Covers PDF, Word converted to PDF, Markdown and a file whose page image failed.',
    'node-lixpi-operation': 'The original operation-status canvas node plus upload and generation progress, failure and required-action presentations.',
    'node-lixpi-branches': 'Origin, fork and continuation markers together with their native parent relationships, plus reference-resolution and review variants.',
    'node-lixpi-artifact': 'The original Capability Artifact canvas nodes plus registered module views and the editable-module lease state.',
}

export const canvasNodeExamples: readonly DocumentationExample[] = [
    {
        id: 'node-shell',
        title: 'Metadata shell',
        group: 'Nodes',
        summary: 'An empty shell alongside wrapped Image, Video and Audio nodes, sharing title, metadata and action slots.',
        source: '@lixpi/canvas-components/nodes/shell',
        components: componentCoverage['node-shell'],
        nodes: ['empty', 'image', 'video', 'audio'],
    },
    ...canvasNodePages.map(
        page => ({
            id: page.id,
            title: page.title,
            group: 'Nodes',
            summary: nodeDescriptions[page.id],
            source: page.mode === 'workspace-canvas'
                ? '@lixpi/canvas-components/workspace'
                : '@lixpi/canvas-components/media',
            components: componentCoverage[page.id],
            nodes: page.nodeTypes ?? [page.nodeType],
        }),
    ),
]
