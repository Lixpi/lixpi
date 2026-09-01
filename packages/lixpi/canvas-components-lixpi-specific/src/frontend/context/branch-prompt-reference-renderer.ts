import {
    type BranchPromptReferenceRenderer,
} from '../nodes/branch-marker-prompt.ts'
import { createCapabilityPromptReferencePreview } from './capability-prompt-preview.ts'

import {
    createMediaPromptReferencePreview,
    createPromptReferenceChipElement,
    type PromptReferencePreviewRenderer,
} from '@lixpi/canvas-components-lixpi-specific/frontend/context'

export function createCanvasPromptReferenceRenderer(
    options: {
        document: Document
        previewRenderer?: PromptReferencePreviewRenderer
        inlinePopover?: boolean
    },
): BranchPromptReferenceRenderer {
    return reference => {
        if (reference.referenceType === 'media' && options.previewRenderer) {
            const preview = createMediaPromptReferencePreview(reference, options.previewRenderer, {
                inlinePopover: options.inlinePopover,
                preferredPlacement: 'top',
            })
            if (preview) return preview
        }
        if (reference.referenceType === 'capability-module' && options.previewRenderer?.getCapabilityModule) {
            return createCapabilityPromptReferencePreview(reference, options.previewRenderer, {
                inlinePopover: options.inlinePopover,
                preferredPlacement: 'top',
            })
        }
        const dom = createPromptReferenceChipElement(reference, options.document)
        return { dom, destroy: () => dom.remove() }
    }
}
