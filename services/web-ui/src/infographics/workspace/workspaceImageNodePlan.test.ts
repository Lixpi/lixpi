import { describe, expect, it } from 'vitest'
import type { ContextRegionCanvasNode, ImageCanvasNode } from '@lixpi/constants'

import {
    canAdoptNodeIntoContextRegion,
    isGeneratedOutputImageNode,
} from '$src/infographics/workspace/workspaceImageNodePlan.ts'

function makeRegion(overrides: Partial<ContextRegionCanvasNode> & { nodeId: string }): ContextRegionCanvasNode {
    return {
        nodeId: overrides.nodeId,
        type: 'contextRegion',
        referenceId: overrides.referenceId ?? `thread-${overrides.nodeId}`,
        position: overrides.position ?? { x: 0, y: 0 },
        dimensions: overrides.dimensions ?? { width: 320, height: 240 },
        ...overrides,
    }
}

function makeImage(overrides: Partial<ImageCanvasNode> & { nodeId: string }): ImageCanvasNode {
    return {
        nodeId: overrides.nodeId,
        type: 'image',
        fileId: overrides.fileId ?? `file-${overrides.nodeId}`,
        workspaceId: overrides.workspaceId ?? 'workspace-1',
        src: overrides.src ?? `/api/images/workspace-1/file-${overrides.nodeId}`,
        aspectRatio: overrides.aspectRatio ?? 1,
        position: overrides.position ?? { x: 0, y: 0 },
        dimensions: overrides.dimensions ?? { width: 120, height: 120 },
        ...overrides,
    }
}

function makeGeneratedImage(overrides: Partial<ImageCanvasNode> & { nodeId: string; threadId: string }): ImageCanvasNode {
    return makeImage({
        ...overrides,
        generatedBy: {
            aiChatThreadId: overrides.threadId,
            responseId: 'response-1',
            aiModel: 'openai:gpt-4o' as any,
            revisedPrompt: 'prompt',
            responseMessageId: 'message-1',
            ...overrides.generatedBy,
        },
    })
}

describe('workspace image node plan', () => {
    it('identifies generated output images as independent context-region outputs', () => {
        const region = makeRegion({ nodeId: 'region-1', referenceId: 'thread-1' })
        const generatedImage = makeGeneratedImage({ nodeId: 'generated-output', threadId: 'thread-1' })
        const regularImage = makeImage({ nodeId: 'regular-image' })

        expect(isGeneratedOutputImageNode(generatedImage)).toBe(true)
        expect(canAdoptNodeIntoContextRegion(generatedImage)).toBe(false)
        expect(isGeneratedOutputImageNode(regularImage)).toBe(false)
        expect(canAdoptNodeIntoContextRegion(regularImage)).toBe(true)
        expect(canAdoptNodeIntoContextRegion(region)).toBe(true)
    })
})