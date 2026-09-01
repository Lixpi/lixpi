import {
    LEGACY_CAPABILITY_REFERENCE_NODE_TYPE,
    PROMPT_REFERENCE_NODE_TYPE,
} from '@lixpi/prosemirror'
import {
    NodeSelection,
    TextSelection,
} from 'prosemirror-state'
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    atomIcon,
    documentIcon,
    fileIcon,
    imageIcon,
    promptIcon,
    videoPlayGlyphIcon,
    videoVolumeHighGlyphIcon,
} from '@lixpi/ui-kit/svg'
import { CapabilityModulePromiseCache } from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import { getCapabilityArtifactIcon } from '$src/installed-capabilities.ts'
import {
    createStateWithNodeSelection,
    createStateWithTextSelection,
    doc,
    findNodePosition,
    p,
    promptReference,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import { createMockEditorView } from '$src/components/proseMirror/plugins/testUtils/testHelpers.ts'
import {
    createPromptReferenceNodeViewPlugin,
    PromptReferenceNodeView,
} from './promptReferenceNodeView.ts'
import { getPromptReferenceIcon } from '@lixpi/canvas-components-lixpi-specific/frontend/context'

const capabilityMeta = {
    moduleId: 'global.character-creator',
    name: 'Character Creator',
    normalizedName: 'character creator',
    summary: 'Creates a panel-first character sheet.',
    tags: ['character'],
    status: 'active' as const,
    descriptionSheet: {
        purpose: 'Creates a complete character description sheet from a prompt and optional references.',
        expectedInputs: [{
            name: 'Prompt',
            requirement: 'required' as const,
            accepts: ['prompt' as const],
            description: 'Describe the character and requested changes.',
        }],
        bestResults: ['Supply 3 to 5 high-resolution views, including face and full-body views.'],
        limitations: ['Missing angles and regions are inferred. Identity preservation is best effort.'],
        executionCharacteristics: { cost: 'high' as const, latency: 'high' as const, summary: 'Generates and validates panels before assembly.' },
    },
}

describe('PromptReferenceNodeView', () => {
    it.each(
        [
            ['media', 'image', imageIcon],
            ['media', 'video', videoPlayGlyphIcon],
            ['media', 'audio', videoVolumeHighGlyphIcon],
            ['media', 'document', documentIcon],
            ['capability-module', '', atomIcon],
            ['tool', '', promptIcon],
            ['skill', '', fileIcon],
        ] as const,
    )('uses an existing SVG for %s %s references', (referenceType, mediaKind, icon) => {
        expect(getPromptReferenceIcon(referenceType, mediaKind)).toBe(icon)
    })

    it('renders only the existing icon and cosmetic name without trigger characters', () => {
        const node = promptReference({
            referenceType: 'media',
            assetId: 'asset-1',
            mediaKind: 'image',
            displayName: 'Character Sheet',
        })
        const nodeView = new PromptReferenceNodeView(node)

        expect(nodeView.dom.querySelector('.prompt-reference-chip-content')?.textContent).toBe('Character Sheet')
        expect(nodeView.dom.classList.contains('prompt-reference-chip-media')).toBe(true)
        expect(nodeView.dom.querySelector('.prompt-reference-chip-icon svg')).not.toBeNull()
        expect(nodeView.dom.textContent?.includes('@')).toBe(false)
        expect(nodeView.dom.textContent?.includes('/')).toBe(false)
    })

    it('renders a slash-selected Action Timeline with the standard Capability module badge', () => {
        const node = promptReference({
            referenceType: 'capability-module',
            moduleId: 'action-timeline',
            displayName: 'Action Timeline',
        })
        const nodeView = new PromptReferenceNodeView(node)

        expect(nodeView.dom.classList.contains('prompt-reference-chip-capability-module')).toBe(true)
        expect(nodeView.dom.querySelector('.prompt-reference-chip-content')?.textContent).toBe('Action Timeline')
        expect(nodeView.dom.querySelector('.prompt-reference-chip-icon svg')).not.toBeNull()
        expect(nodeView.dom.querySelector('input')).toBeNull()
        expect(nodeView.dom.querySelector('.action-timeline-controls')).toBeNull()
    })

    it('loads the capability description through the shared context-preview card on focus', async () => {
        const getCapabilityModule = vi.fn(async () => capabilityMeta)
        const node = promptReference({
            referenceType: 'capability-module',
            moduleId: 'global.character-creator',
            displayName: 'Character Creator',
        })
        const nodeView = new PromptReferenceNodeView(node, {
            getNode: () => undefined,
            getCapabilityModule,
            environment: {
                getDocuments: () => [],
                getThreads: () => [],
                document,
                tooltipHideDelayMs: 0,
                getArtifactIcon: () => '',
                extractDocumentText: () => '',
                initialRenditionUrl: () => '',
                resolveRenditionUrl: async () => '',
                onError: vi.fn(),
            },
        })
        document.body.append(nodeView.dom)
        expect(nodeView.dom.classList.contains('context-preview-tooltip-inline-label')).toBe(true)
        const trigger = nodeView.dom.querySelector<HTMLElement>('.help-tooltip-trigger')!
        trigger.focus()
        const popover = document.body.querySelector<HTMLElement>('.help-tooltip-content')!
        expect(popover.classList.contains('context-preview-popover')).toBe(true)
        expect(popover.querySelector('[role="status"]')?.textContent).toContain('Loading')
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(popover.querySelector('.capability-description-card h2')?.textContent).toBe('Character Creator')
        expect(popover.querySelectorAll('.capability-description-card section')).toHaveLength(4)
        expect(Array.from(popover.querySelectorAll('.capability-description-card h3')).map(heading => heading.textContent))
            .toEqual(['Expected inputs', 'Best results', 'Limitations', 'Execution'])
        expect(popover.querySelector('.capability-description-columns')).toBeNull()
        expect(getCapabilityModule).toHaveBeenCalledOnce()
        nodeView.destroy()
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
    })

    it('uses the shared canvas portal and viewport scale for capability and media cards', async () => {
        const pane = document.createElement('div')
        pane.className = 'workspace-pane'
        const viewport = document.createElement('div')
        viewport.className = 'workspace-viewport'
        viewport.style.transform = 'matrix(1.5, 0, 0, 1.5, 0, 0)'
        pane.append(viewport)
        document.body.append(pane)
        const node = promptReference({
            referenceType: 'capability-module',
            moduleId: 'global.character-creator',
            displayName: 'Character Creator',
        })
        const nodeView = new PromptReferenceNodeView(node, {
            inlinePopover: true,
            getNode: () => undefined,
            getCapabilityModule: async () => capabilityMeta,
            environment: {
                getDocuments: () => [],
                getThreads: () => [],
                document,
                tooltipHideDelayMs: 0,
                getArtifactIcon: () => '',
                extractDocumentText: () => '',
                initialRenditionUrl: () => '',
                resolveRenditionUrl: async () => '',
                onError: vi.fn(),
            },
        })
        viewport.append(nodeView.dom)

        const popover = nodeView.dom.querySelector<HTMLElement>('.context-preview-inline-popover')!
        nodeView.dom.dispatchEvent(new PointerEvent('pointerenter'))
        await new Promise(resolve => setTimeout(resolve, 0))

        expect(popover.parentElement).toBe(pane)
        expect(popover.classList.contains('context-preview-inline-popover-portaled')).toBe(true)
        expect(popover.classList.contains('context-preview-inline-popover-top')).toBe(true)
        expect(popover.style.transform).toContain('scale(1.5)')
        expect(popover.querySelector('.capability-description-card h2')?.textContent).toBe('Character Creator')

        nodeView.destroy()
        expect(popover.isConnected).toBe(false)
    })

    it('shares in-flight metadata lookups and evicts rejected cache entries for retry', async () => {
        const cache = new CapabilityModulePromiseCache()
        const load = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue(capabilityMeta)
        await expect(cache.get('global.character-creator', load)).rejects.toThrow('offline')
        const [left, right] = await Promise.all([
            cache.get('global.character-creator', load),
            cache.get('global.character-creator', load),
        ])

        expect(left).toBe(capabilityMeta)
        expect(right).toBe(capabilityMeta)
        expect(load).toHaveBeenCalledTimes(2)
    })

    it('renders an Action Timeline Artifact with its registered existing icon', () => {
        const node = promptReference({
            referenceType: 'capability-artifact',
            assetId: 'timeline-asset',
            artifactTypeId: 'action-timeline',
            displayName: 'Travel Timeline',
        })
        const nodeView = new PromptReferenceNodeView(node)

        expect(getCapabilityArtifactIcon('action-timeline')).toContain('<svg')
        expect(nodeView.dom.querySelector('.prompt-reference-chip-icon svg')).not.toBeNull()
        expect(nodeView.dom.querySelector('.action-timeline-reference')?.textContent).toBe('Travel Timeline')
    })

    it('keeps identical markup and asks ProseMirror to recreate changed reference markup', () => {
        const mediaNode = promptReference({
            referenceType: 'media',
            assetId: 'asset-1',
            mediaKind: 'image',
            displayName: 'Character Sheet',
        })
        const nodeView = new PromptReferenceNodeView(mediaNode)
        const capabilityNode = promptReference({
            referenceType: 'capability-module',
            assetId: '',
            mediaKind: '',
            moduleId: 'character-creator',
            displayName: 'Character Creator',
        })

        expect(nodeView.update(mediaNode)).toBe(true)
        expect(nodeView.update(capabilityNode)).toBe(false)
        expect(nodeView.update(p('Different node type'))).toBe(false)
    })

    it('uses the shared context-preview card with the inline reference label as its trigger', async () => {
        const node = promptReference({
            referenceType: 'media',
            assetId: 'asset-1',
            mediaKind: 'image',
            displayName: 'Character Sheet',
        })
        const nodeView = new PromptReferenceNodeView(node, {
            getNode: () => ({
                type: 'image',
                nodeId: 'image-node-1',
                assetId: 'asset-1',
                position: { x: 0, y: 0 },
                dimensions: { width: 640, height: 480 },
            }),
            environment: {
                getDocuments: () => [],
                getThreads: () => [],
                getAsset: () => undefined,
                document,
                tooltipHideDelayMs: 0,
                getArtifactIcon: () => '',
                extractDocumentText: () => '',
                initialRenditionUrl: () => '',
                resolveRenditionUrl: async () => '',
                onError: vi.fn(),
            },
        })
        document.body.appendChild(nodeView.dom)

        expect(nodeView.dom.classList.contains('context-preview-tooltip-inline-label')).toBe(true)
        expect(nodeView.dom.querySelector('.context-preview-trigger-inline-label')).not.toBeNull()
        expect(nodeView.dom.querySelector('.context-preview-image-mini')).toBeNull()
        expect(nodeView.dom.querySelector('.prompt-reference-chip-content')?.textContent).toBe('Character Sheet')

        const trigger = nodeView.dom.querySelector('.help-tooltip-trigger') as HTMLElement
        trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await Promise.resolve()

        const preview = document.body.querySelector('.help-tooltip-content') as HTMLElement
        expect(preview.querySelector('.context-preview-image-large')).not.toBeNull()
        expect(preview.querySelector('.context-preview-popover-title')?.textContent)
            .toBe('Character Sheet')

        nodeView.destroy()
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
    })

    it('uses the canonical Asset title instead of a persisted UUID display label', () => {
        const node = promptReference({
            referenceType: 'media',
            assetId: 'asset-1',
            mediaKind: 'image',
            displayName: 'asset-1',
        })
        const nodeView = new PromptReferenceNodeView(node, {
            getNode: () => ({
                type: 'image',
                nodeId: 'image-node-1',
                assetId: 'asset-1',
                position: { x: 0, y: 0 },
                dimensions: { width: 640, height: 480 },
            }),
            environment: {
                getDocuments: () => [],
                getThreads: () => [],
                getAsset: () => ({ title: 'Shelby' }) as never,
                document,
                tooltipHideDelayMs: 0,
                getArtifactIcon: () => '',
                extractDocumentText: () => '',
                initialRenditionUrl: () => '',
                resolveRenditionUrl: async () => '',
                onError: vi.fn(),
            },
        })

        expect(nodeView.dom.querySelector('.prompt-reference-chip-name')?.textContent).toBe('Shelby')
        expect(nodeView.dom.textContent).not.toContain('asset-1')
        nodeView.destroy()
    })

    it('uses the renderer inline-popover policy for canvas-scaled references', () => {
        const node = promptReference({
            referenceType: 'media',
            assetId: 'asset-1',
            mediaKind: 'image',
            displayName: 'Character Sheet',
        })
        const nodeView = new PromptReferenceNodeView(node, {
            inlinePopover: true,
            getNode: () => ({
                type: 'image',
                nodeId: 'image-node-1',
                assetId: 'asset-1',
                position: { x: 0, y: 0 },
                dimensions: { width: 640, height: 480 },
            }),
            environment: {
                getDocuments: () => [],
                getThreads: () => [],
                getAsset: () => undefined,
                document,
                tooltipHideDelayMs: 0,
                getArtifactIcon: () => '',
                extractDocumentText: () => '',
                initialRenditionUrl: () => '',
                resolveRenditionUrl: async () => '',
                onError: vi.fn(),
            },
        })

        expect(nodeView.dom.classList.contains('context-preview-inline')).toBe(true)
        expect(nodeView.dom.classList.contains('context-preview-inline-label')).toBe(true)
        expect(nodeView.dom.querySelector('.context-preview-inline-popover')).not.toBeNull()
        expect(document.body.querySelector('.help-tooltip-content')).toBeNull()
        nodeView.destroy()
    })

    it('repairs legacy Timeline references with an empty media kind from Asset metadata', () => {
        const node = promptReference({
            referenceType: 'media',
            assetId: 'asset-video',
            mediaKind: '',
            displayName: 'asset-video',
        })
        const nodeView = new PromptReferenceNodeView(node, {
            getNode: reference =>
                reference.mediaKind === 'video'
                    ? {
                        type: 'video',
                        nodeId: 'video-node-1',
                        assetId: 'asset-video',
                        position: { x: 0, y: 0 },
                        dimensions: { width: 640, height: 360 },
                    }
                    : undefined,
            environment: {
                getDocuments: () => [],
                getThreads: () => [],
                getAsset: () =>
                    ({
                        title: 'Slop Train',
                        media: { kind: 'video' },
                    }) as never,
                document,
                tooltipHideDelayMs: 0,
                getArtifactIcon: () => '',
                extractDocumentText: () => '',
                initialRenditionUrl: () => '',
                resolveRenditionUrl: async () => '',
                onError: vi.fn(),
            },
        })

        expect(nodeView.dom.querySelector('.prompt-reference-chip-name')?.textContent).toBe('Slop Train')
        expect(nodeView.dom.querySelector('.prompt-reference-chip-icon')?.innerHTML).toContain('M8 5v14l11-7z')
        expect(nodeView.dom.classList.contains('context-preview-tooltip-inline-label')).toBe(true)
        nodeView.destroy()
    })

    it('registers renderers for current and persisted legacy reference atoms', () => {
        const nodeViews = createPromptReferenceNodeViewPlugin().props.nodeViews

        expect(nodeViews).toHaveProperty(PROMPT_REFERENCE_NODE_TYPE)
        expect(nodeViews).toHaveProperty(LEGACY_CAPABILITY_REFERENCE_NODE_TYPE)
    })

    it.each(
        [
            ['ArrowRight', 'before', 1, 2],
            ['ArrowLeft', 'after', 2, 1],
        ] as const,
    )('moves %s directly from %s the atom to its opposite side', (key, _side, start, expected) => {
        const documentNode = doc(p(promptReference({ displayName: 'Character Sheet' })))
        const state = createStateWithTextSelection(documentNode, start, start)
        const view = createMockEditorView({ state })
        const event = new KeyboardEvent('keydown', { key, cancelable: true })
        const plugin = createPromptReferenceNodeViewPlugin()

        expect(plugin.props.handleKeyDown?.(view, event)).toBe(true)
        expect(event.defaultPrevented).toBe(true)
        expect(view.state.selection).toBeInstanceOf(TextSelection)
        expect(view.state.selection.from).toBe(expected)
        expect(view.state.selection.to).toBe(expected)
    })

    it.each(
        [
            ['ArrowLeft', 1],
            ['ArrowRight', 2],
        ] as const,
    )('converts a prompt-reference NodeSelection into a visible text caret for %s', (key, expected) => {
        const documentNode = doc(p(promptReference({ displayName: 'Character Sheet' })))
        const nodePosition = findNodePosition(documentNode, PROMPT_REFERENCE_NODE_TYPE)
        if (nodePosition === null) throw new Error('Missing prompt reference in test document')
        const state = createStateWithNodeSelection(documentNode, nodePosition)
        expect(state.selection).toBeInstanceOf(NodeSelection)
        const view = createMockEditorView({ state })
        const event = new KeyboardEvent('keydown', { key, cancelable: true })

        expect(createPromptReferenceNodeViewPlugin().props.handleKeyDown?.(view, event)).toBe(true)
        expect(view.state.selection).toBeInstanceOf(TextSelection)
        expect(view.state.selection.from).toBe(expected)
    })

    it('leaves modified arrow-key selection behavior to ProseMirror', () => {
        const documentNode = doc(p(promptReference({ displayName: 'Character Sheet' })))
        const view = createMockEditorView({
            state: createStateWithTextSelection(documentNode, 1, 1),
        })
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            shiftKey: true,
            cancelable: true,
        })

        expect(createPromptReferenceNodeViewPlugin().props.handleKeyDown?.(view, event)).toBe(false)
        expect(event.defaultPrevented).toBe(false)
        expect(view.state.selection.from).toBe(1)
    })
})
