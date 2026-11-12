import {
    type MediaPromptReference,
    type PromptReferenceType,
} from '@lixpi/constants'
import {
    type VideoControlsSettings,
} from '@lixpi/ui-kit/components/video-controls'

export type EditorContextPreviewTile = {
    dom: HTMLElement
    destroy: () => void
}
export type EditorPromptReferencePreviewRenderer = {
    document: Document
    resolveMediaKind: (assetId: string) => MediaPromptReference['mediaKind'] | undefined
    createMediaPreview: (reference: MediaPromptReference & { displayName: string }) => EditorContextPreviewTile | null
    createCapabilityPreview?: (reference: {
        moduleId: string
        displayName: string
    }) => EditorContextPreviewTile
}

export type EditorPromptReferenceChipDescriptor = {
    referenceType: Exclude<PromptReferenceType, 'capability-artifact'>
    displayName: string
    mediaKind?: unknown
}
export type EditorPreviewPorts = {
    createReferenceChip: (
        descriptor: EditorPromptReferenceChipDescriptor,
        document: Document,
    ) => HTMLElement
}

export type EditorAppearanceSettings = {
    aiModelControls: { styles: { dimensionsGlyph: {
        targetArea: number
        maxDimension: number
        cornerRadius: number
        strokeWidth: number
    } } }
    aiPromptInput: { mediaModeSwitch: { styles: {
        trackBackgroundColor: string
        indicatorBackgroundColor: string
        unselectedOptionColor: string
        hoveredOptionColor: string
        selectedOptionColor: string
        indicatorBoxShadow: string
    } } }
    videoControls: VideoControlsSettings & { chat: {
        horizontalInset: number
        bottomInset: number
        controlsScale: number
        minWidth: number
        fallbackWidth: number
    } }
}
export type EditorPromptChromePorts = {
    createMediaModeSwitch: (config: {
        document: Document
        value: 'image' | 'video'
        onChange: (value: 'image' | 'video') => void
        appearance?: Partial<EditorAppearanceSettings['aiPromptInput']['mediaModeSwitch']['styles']>
    }) => {
        element: HTMLElement
        setValue: (value: 'image' | 'video') => void
        destroy: () => void
    }
    createModelMenuTrigger: (config: {
        document: Document
        onClick: (event: MouseEvent) => void
    }) => {
        element: HTMLButtonElement
        summary: HTMLSpanElement
        setExpanded: (open: boolean) => void
        destroy: () => void
    }
}
