import { vi } from 'vitest'
import {
    type AiModel,
    type MediaGenerationConfigMatrix,
} from '@lixpi/constants'

import {
    type SegmentEvent,
} from '../frontend/plugins/ai-chat-thread/ai-chat-thread-plugin.ts'
import {
    type EditorServices,
} from '../frontend/editor/editor-services.ts'

export type TestEditorServices = {
    services: EditorServices
    setModels: (models: AiModel[]) => void
    // Sends a segment to the listeners of its conversation, as the host's
    // segment router does.
    emitSegment: (segment: SegmentEvent) => void
}

// Editor services for package tests: API URLs carry the token "token-1", the model
// catalog is in memory, and segments go to listeners by conversation.
export const createTestEditorServices = (overrides: Partial<EditorServices> = {}): TestEditorServices => {
    let models: AiModel[] = []
    const modelListeners = new Set<() => void>()
    const segmentListeners = new Map<string, Set<(event: SegmentEvent) => void>>()
    const subscribeModels = (listener: () => void) => {
        modelListeners.add(listener)

        return () => void modelListeners.delete(listener)
    }
    const services: EditorServices = {
        media: {
            resolveUrl: vi.fn(async (url: string, options?: { base64MimeType?: string }) => {
                if (
                    !url
                    || url.startsWith('data:')
                    || url.startsWith('blob:')
                )
                    return url

                const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url)

                if (
                    options?.base64MimeType
                    && !isAbsolute
                    && !url.startsWith('/')
                )
                    return `data:${options.base64MimeType};base64,${url}`

                const parsed = new URL(url, 'http://localhost')

                if (!parsed.pathname.startsWith('/api/'))
                    return url

                parsed.searchParams.set('token', 'token-1')

                return isAbsolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`
            }),
            renditionPath: (assetId, rendition) => `/api/assets/${encodeURIComponent(assetId)}/renditions/${encodeURIComponent(rendition)}`,
            modelBadge: {
                decorate: vi.fn(),
                render: vi.fn((target: HTMLElement, modelId: string | null | undefined) => void (target.textContent = modelId ?? '')),
                subscribe: subscribeModels,
            },
            downloadImage: vi.fn(async () => undefined),
        },
        settings: {
            aiModelControls: { styles: { dimensionsGlyph: {
                targetArea: 500,
                maxDimension: 25,
                cornerRadius: 2,
                strokeWidth: 1,
            } } },
            aiPromptInput: { mediaModeSwitch: { styles: {
                trackBackgroundColor: '#eef',
                indicatorBackgroundColor: '#fff',
                unselectedOptionColor: '#777',
                hoveredOptionColor: '#444',
                selectedOptionColor: '#111',
                indicatorBoxShadow: 'none',
            } } },
            videoControls: {
                height: 32,
                styles: {} as EditorServices['settings']['videoControls']['styles'],
                chat: {
                    horizontalInset: 0,
                    bottomInset: 0,
                    controlsScale: 1,
                    minWidth: 200,
                    fallbackWidth: 200,
                },
            } as EditorServices['settings']['videoControls'],
        },
        previews: {
            createMediaReferencePreview: () => ({
                dom: document.createElement('span'),
                destroy: vi.fn(),
            }),
            createCapabilityReferencePreview: () => ({
                dom: document.createElement('span'),
                destroy: vi.fn(),
            }),
            createReferenceChip: () => document.createElement('span'),
            createContextTile: () => ({
                dom: document.createElement('span'),
                destroy: vi.fn(),
            }),
        },
        promptChrome: {
            createMediaModeSwitch: () => ({
                element: document.createElement('div'),
                setValue: vi.fn(),
                destroy: vi.fn(),
            }),
            createModelMenuTrigger: () => ({
                element: document.createElement('button'),
                summary: document.createElement('span'),
                setExpanded: vi.fn(),
                destroy: vi.fn(),
            }),
        },
        models: {
            getModels: () => models,
            getMediaGenerationConfigMatrix: (): MediaGenerationConfigMatrix => ({
                version: 'media-generation-config-matrix-v1',
                groups: [],
            }),
            subscribe: subscribeModels,
        },
        segments: {
            subscribeForThread: (threadId, listener) => {
                const listeners = segmentListeners.get(threadId) ?? new Set()
                listeners.add(listener)
                segmentListeners.set(threadId, listeners)

                return () => void listeners.delete(listener)
            },
        },
        capabilityArtifacts: {
            createPromptReferenceView: () => ({ destroy: vi.fn() }),
            icon: () => '<svg></svg>',
            ensureStyles: vi.fn(),
        },
        createCapabilityRunProgress: () => {
            throw new Error('TEST_CAPABILITY_RUN_PROGRESS_NOT_CONFIGURED')
        },
        modelControls: {
            applyAiModelMenuStyleSettings: vi.fn(),
            createAiModelMenuContent: () => ({
                dom: document.createElement('div'),
                update: vi.fn(),
                destroy: vi.fn(),
            }),
            createMediaGenerationConfigMatrixView: () => ({
                dom: document.createElement('div'),
                update: vi.fn(),
                closeMenus: vi.fn(),
                destroy: vi.fn(),
            }),
            getModelOptionsForCapability: () => [],
            transformModelsToOptions: () => [],
        },
        ...overrides,
    }

    return {
        services,
        setModels: next => {
            models = next
            modelListeners.forEach(listener => listener())
        },
        emitSegment: segment => {
            if (segment.conversationAssetId)
                segmentListeners.get(segment.conversationAssetId)?.forEach(listener => listener(segment))
        },
    }
}
