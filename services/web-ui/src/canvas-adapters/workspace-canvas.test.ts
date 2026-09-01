import {
    describe,
    it,
    expect,
} from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// =============================================================================
// HELPERS
// =============================================================================

const sourceFileNames = new Map<string, string>()

function readSourceFile(relativePath: string, displayName = relativePath): string {
    const source = readFileSync(
        resolve(import.meta.dirname, relativePath),
        'utf-8',
    )
    sourceFileNames.set(source, displayName)
    return source
}

function sourceName(source: string): string {
    return sourceFileNames.get(source) ?? 'source excerpt'
}

function expectSourceToContain(source: string, snippet: string): void {
    expect(
        source.includes(snippet),
        `${sourceName(source)} should contain:\n${snippet}`,
    ).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string): void {
    expect(
        source.includes(snippet),
        `${sourceName(source)} should not contain:\n${snippet}`,
    ).toBe(false)
}

function expectExcerptToContain(excerpt: string, snippet: string, label = 'source excerpt'): void {
    expect(
        excerpt.includes(snippet),
        `${label} should contain:\n${snippet}`,
    ).toBe(true)
}

function expectExcerptNotToContain(excerpt: string, snippet: string, label = 'source excerpt'): void {
    expect(
        excerpt.includes(snippet),
        `${label} should not contain:\n${snippet}`,
    ).toBe(false)
}

function loadScss(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-canvas.scss').replace(
        "@import '@lixpi/canvas-components-lixpi-specific/styles/canvas-chrome';",
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-canvas-chrome.scss'),
    ).replace(
        "@import '@lixpi/canvas-components-lixpi-specific/styles/document-node';",
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/nodes/document-node.scss'),
    ).replace(
        "@import '@lixpi/canvas-components-lixpi-specific/styles/operation-status';",
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/nodes/operation-status-node.scss'),
    ).replace(
        "@import '@lixpi/canvas-components-lixpi-specific/styles/branch-marker';",
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/nodes/branch-reference-resolution.scss')
            + readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/nodes/branch-marker-content.scss'),
    ).replace(
        "@import '@lixpi/canvas-components-lixpi-specific/styles/nodes';",
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/nodes/workspace-node-shells.scss'),
    ).replace(
        "@import '@lixpi/canvas-components-lixpi-specific/styles/progress';",
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/progress/media-generation-progress.scss'),
    ).replace(
        "@import '@lixpi/canvas-components-lixpi-specific/styles/output-details';",
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/review/generated-output-details-sidebar.scss'),
    ).replace(
        "@import '@lixpi/canvas-components-lixpi-specific/styles/video-chrome';",
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/media/workspace-video-chrome.scss'),
    ).replace(
        "@import '@lixpi/canvas-components-lixpi-specific/styles/asset-views';",
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/review/workspace-asset-views.scss'),
    ).replace(
        "@import '@lixpi/canvas-components-lixpi-specific/styles/output-chrome';",
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/media/generated-output-node-chrome.scss'),
    ).replace(
        "@import '@lixpi/canvas-components-lixpi-specific/styles/right-panel';",
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-right-panel.scss'),
    ).replace(
        "@import '@lixpi/canvas-components-lixpi-specific/styles/output-details-content';",
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/review/workspace-output-details.scss'),
    )
}

function loadOutputChrome(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/media/workspace-output-chrome.ts')
}

function loadTs(): string {
    const source = `${loadNodeDeletion()}\n${loadNodeGestures()}\n${loadGenerationHandlers()}\n${readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-canvas.ts')}`
    sourceFileNames.set(source, 'workspace renderer and generation handlers')
    return source
}

function loadNodeDeletion(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/scene/workspace-node-deletion.ts')
}

function loadNodeGestures(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-node-gestures.ts')
}

function loadGenerationHandlers(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/media/workspace-generation-handlers.ts')
}

function loadWorkspacePreflightMethod(name: string, module = 'workspace-preflight-markers'): string {
    const source = readSourceFile(`../../packages/lixpi/canvas-components-lixpi-specific/src/shared/generation/${module}.ts`)
    const start = source.indexOf(`\n    ${name}(`)
    const end = source.indexOf('\n    }\n', start)
    expect(start, `Missing preflight method ${name}`).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return source.slice(start, end)
}

function loadRightPanel(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-right-panel.ts')
}

function extractMarqueeConfiguration(source: string): string {
    const configuration = source.match(/this\.marquee = this\.canvasRuntime.installMarquee\([\s\S]*?^            \}\)/m)?.[0]
    expect(configuration, 'Workspace must configure the engine marquee controller').toBeDefined()
    return configuration!
}

function loadPixiMediaLayer(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/media/workspace-media-layer.ts')
}

function loadViewportBridge(): string {
    return readSourceFile('../../packages/lixpi/canvas-engine/src/frontend/viewport/viewport-bridge.ts', 'packages/lixpi/canvas-engine/src/frontend/viewport/viewport-bridge.ts')
}

function loadPixiTravelingOutlineRenderer(): string {
    return readSourceFile('../../packages/lixpi/canvas-components/src/frontend/effects/outline/traveling-outline.ts')
}

function loadWorkspaceLoadingOutline(): string {
    return readSourceFile('../../packages/lixpi/canvas-components/src/frontend/loading/loading-overlay.ts', 'packages/lixpi/canvas-components/src/frontend/loading/loading-overlay.ts')
}

function loadWorkspaceLineageProjection(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/branch-tree-layout/workspace-lineage-projection.ts')
}

function loadWorkspaceMarkerHandoff(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/generation/workspace-branch-marker-handoff.ts')
}

function loadWorkspaceCanvasView(): string {
    return readSourceFile('../components/workspaceCanvasView/workspaceCanvasView.ts', 'components/workspaceCanvasView/workspaceCanvasView.ts')
        + readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-canvas-chrome.ts')
        + readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-canvas-surface.ts')
}

function loadCanvasMembershipStateRebase(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/scene/membership-state-rebase.ts')
}

function loadContextPreview(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/context/context-preview.ts', 'context-preview.ts')
}

function loadAiInteractionService(): string {
    return readSourceFile('../services/ai-interaction-service.ts', 'services/ai-interaction-service.ts')
}

function loadAiChatThreadPlugin(): string {
    return readSourceFile('../components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts', 'components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts')
}

function loadAiGeneratedImageNode(): string {
    return readSourceFile('../components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts', 'components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts')
}

function loadAiGeneratedMediaCanvasRouter(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/generation/canvas-generation-events.ts')
}

function loadAiPromptComposer(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/composer/ai-prompt-composer.ts', 'ai-prompt-composer.ts')
}

function loadWorkspaceComposerStyles(): string {
    return readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/composer/workspace-prompt-composer.scss')
}

describe('Branch prompt-reference theme integration', () => {
    it('uses a lighter Capability accent on the dark branch message without changing marker layout', () => {
        const scss = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-canvas.scss')
        const componentScss = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/nodes/branch-marker-content.scss')
        const selector = '.workspace-branch-marker-message-text .prompt-reference-chip {'
        const ruleStart = componentScss.indexOf(selector)
        const ruleEnd = componentScss.indexOf('\n}', ruleStart)
        const rule = ruleStart >= 0 && ruleEnd >= 0 ? componentScss.slice(ruleStart, ruleEnd) : ''
        // The dark palette is declared once on the marker surface, so every chip
        // inside it — prompt line, reference row, pipeline trace — inherits it.
        // Anchored to the newline so this finds the top-level rule rather than the
        // indented responsive override that shares the selector.
        const theme = readSourceFile('./workspace-theme.scss')
        const markerSurfaceStart = theme.indexOf('\n.workspace-branch-marker-content,')
        const markerSurfaceEnd = theme.indexOf('\n}', markerSurfaceStart)
        const markerSurfaceRule = markerSurfaceStart >= 0 && markerSurfaceEnd >= 0
            ? theme.slice(markerSurfaceStart, markerSurfaceEnd)
            : ''

        expectSourceToContain(rule, 'font-size: inherit;')
        expectSourceToContain(markerSurfaceRule, '@include prompt-reference-chip-on-dark-surface;')
        expectSourceNotToContain(scss, '--prompt-reference-color: #d7e6ff;')
        expectSourceNotToContain(scss, '--prompt-reference-capability-module-color: #eca983;')
        expectSourceNotToContain(scss, '.workspace-branch-marker-message > .prompt-reference-chip {')
        expectSourceNotToContain(scss, '.workspace-branch-marker-message-text:has(.context-preview-inline.is-open)')
    })
})

function loadSidePanel(): string {
    return readSourceFile('../../packages/lixpi/ui-kit/src/components/sidePanel/sidePanel.ts', 'packages/lixpi/ui-kit/src/components/sidePanel/sidePanel.ts')
}

function loadSidePanelScss(): string {
    return readSourceFile('../../packages/lixpi/ui-kit/src/components/sidePanel/side-panel.scss', 'packages/lixpi/ui-kit/src/components/sidePanel/side-panel.scss')
}

function loadMediaModelBadgeScss(): string {
    return readSourceFile('../../packages/lixpi/ui-kit/src/components/mediaModelBadge/media-model-badge.scss', 'packages/lixpi/ui-kit/src/components/mediaModelBadge/media-model-badge.scss')
}

function loadCanvasNodeFooterScss(): string {
    return readSourceFile('../../packages/lixpi/ui-kit/src/components/canvasNodeFooter/canvas-node-footer.scss', 'packages/lixpi/ui-kit/src/components/canvasNodeFooter/canvas-node-footer.scss')
}

function loadLayout(): string {
    return readSourceFile('../views/layouts/layout.ts', 'views/layouts/layout.ts')
}

function loadNavigationSidePanel(): string {
    return readSourceFile('../components/navigationSidePanel/navigationSidePanel.ts', 'components/navigationSidePanel/navigationSidePanel.ts')
}

function loadNavigationSidePanelScss(): string {
    return readSourceFile('../components/navigationSidePanel/navigation-side-panel.scss', 'components/navigationSidePanel/navigation-side-panel.scss')
}

function loadSettings(): string {
    return [
        readSourceFile('../settings.ts', 'settings.ts'),
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/settings/canvas-settings.ts'),
        readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/settings/types.ts'),
    ].join('\n')
}

function loadSvgIcons(): string {
    return readSourceFile('../../packages/lixpi/ui-kit/src/svg/svgIcons.ts', 'ui-kit/svg/svgIcons.ts')
}

function extractBlock(scss: string, selector: string): string {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`${escapedSelector}\\s*\\{`)
    const match = pattern.exec(scss)
    if (!match) return ''

    let depth = 0
    let start = match.index + match[0].length
    let end = start

    for (let i = start; i < scss.length; i++) {
        if (scss[i] === '{') depth++
        if (scss[i] === '}') {
            if (depth === 0) {
                end = i
                break
            }
            depth--
        }
    }

    return scss.slice(match.index, end + 1)
}

function extractBlockContainingSelector(scss: string, selector: string): string {
    const selectorIndex = scss.indexOf(selector)
    if (selectorIndex === -1) return ''

    const openIndex = scss.indexOf('{', selectorIndex)
    if (openIndex === -1) return ''

    let depth = 0
    let end = openIndex

    for (let i = openIndex + 1; i < scss.length; i++) {
        if (scss[i] === '{') depth++
        if (scss[i] === '}') {
            if (depth === 0) {
                end = i
                break
            }
            depth--
        }
    }

    return scss.slice(selectorIndex, end + 1)
}

function extractBoxShadowValues(block: string): string[] {
    const matches = [...block.matchAll(/box-shadow:\s*([^;]+);/g)]
    return matches.map(m => m[1].trim())
}

function extractFunctionBody(source: string, functionName: string): string {
    const functionIndex = source.indexOf(`private ${functionName} =`) >= 0
        ? source.indexOf(`private ${functionName} =`)
        : source.indexOf(`function ${functionName}`)
    if (functionIndex === -1) return ''

    const signatureCloseIndex = source.indexOf(')', functionIndex)
    if (signatureCloseIndex === -1) return ''

    const trailingSignature = source.slice(signatureCloseIndex + 1)
    const returnTypeObjectStart = trailingSignature.match(/^\s*:\s*\{/)
    let bodySearchIndex = signatureCloseIndex
    if (returnTypeObjectStart) {
        const returnTypeOpenIndex = signatureCloseIndex + 1 + returnTypeObjectStart[0].lastIndexOf('{')
        let returnTypeDepth = 0
        for (let i = returnTypeOpenIndex + 1; i < source.length; i++) {
            if (source[i] === '{') returnTypeDepth++
            if (source[i] === '}') {
                if (returnTypeDepth === 0) {
                    bodySearchIndex = i
                    break
                }
                returnTypeDepth--
            }
        }
    }

    const arrowBodyIndex = source.startsWith('private ', functionIndex) ? source.indexOf('=> {', functionIndex) + 3 : -1
    const openIndex = arrowBodyIndex >= 3 ? arrowBodyIndex : source.indexOf('{', bodySearchIndex)
    if (openIndex === -1) return ''

    let depth = 0
    let endIndex = openIndex

    for (let i = openIndex + 1; i < source.length; i++) {
        if (source[i] === '{') depth++
        if (source[i] === '}') {
            if (depth === 0) {
                endIndex = i
                break
            }
            depth--
        }
    }

    return source.slice(functionIndex, endIndex + 1)
}

describe('Capability Artifact generated-output chrome parity', () => {
    it('uses registered branch surfaces within the canvas world root', () => {
        const source = loadTs()
        expectSourceToContain(source, 'branch: this.createBranchMarkerNode,')
        expectSourceNotToContain(source, 'pendingBranchMarkerOverlayEl')
        expectSourceNotToContain(source, 'workspace-branch-marker-screen-fixed')
    })

    it('uses the same unified details renderer, editable metadata, and Asset details contract as generated media', () => {
        const ts = loadTs()
        const renderDetails = extractFunctionBody(ts, 'renderGeneratedOutputDetailsContent')
        expectExcerptToContain(renderDetails, 'assets: this.createAssetViewPorts()', 'generated media details')
        expectExcerptToContain(renderDetails, 'getArtifactDefinition: typeId => this.host.capabilities.frontend.require(typeId)', 'Capability Artifact details')
        expectExcerptToContain(renderDetails, "getArtifactDocument: assetId => this.host.assets.readDocument(assetId, 'capabilityArtifact')?.doc", 'Capability Artifact details')
    })
})

describe('Workspace canvas — durable media request recovery and identity', () => {
    const ts = loadTs()
    const identityControl = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/review/asset-subject-identity-control.ts')
    const library = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/library/media-library-panel.ts')

    it('uses the scope selector dropdown for all five subject identity options in both Asset surfaces', () => {
        expectSourceToContain(identityControl, "{ title: 'Unknown', value: 'unknown'")
        expectSourceToContain(identityControl, "{ title: 'No person', value: 'no-person'")
        expectSourceToContain(identityControl, "{ title: 'Fictional', value: 'fictional'")
        expectSourceToContain(identityControl, "{ title: 'Me', value: 'self'")
        expectSourceToContain(identityControl, "{ title: 'Authorized', value: 'authorized-real-person'")
        expectSourceToContain(identityControl, 'this.dropdown = createPureDropdown({')
        expectSourceToContain(identityControl, "theme: 'dark'")
        expectSourceToContain(identityControl, 'ignoreColorValuesForOptions: true')
        expectSourceToContain(identityControl, 'ignoreColorValuesForSelectedValue: true')
        expectSourceToContain(identityControl, 'renderIconForSelectedValue: false')
        expectSourceToContain(identityControl, 'renderIconForOptions: false')
        expectSourceToContain(identityControl, 'mountToBody: false')
        expectSourceToContain(identityControl, 'disableAutoPositioning: true')
        expectSourceToContain(identityControl, 'this.options.attestSubjectIdentity(')
        expectSourceToContain(identityControl, 'requestedAssetId,')
        expectSourceToContain(identityControl, 'this.currentAsset.revision,')
        expectSourceToContain(identityControl, 'nextClassification,')
        expectSourceToContain(identityControl, 'this.syncSelectedClassification(previousClassification)')
        expectSourceNotToContain(identityControl, 'createSlidingSwitch')
        expectSourceToContain(ts, 'this.canvasAssetViews = new WorkspaceAssetViews(this.createAssetViewPorts)')
        expectSourceToContain(ts, 'assets: this.createAssetViewPorts(),')
        expectSourceToContain(library, 'mountAssetSubjectIdentityControl({')
        expectSourceNotToContain(identityControl, 'modal')
    })

    it('delegates scoped operation fetch, subscription and replay to the package', () => {
        const recovery = extractFunctionBody(ts, 'ensureMediaGenerationOperationRecovery')
        expectExcerptToContain(recovery, 'void this.mediaOperationRecovery.ensure(node)', 'operation recovery')
        expectSourceToContain(ts, 'fetch: this.host.generation.get,')
        expectSourceToContain(ts, 'replay: this.host.generation.replay,')
        expectSourceToContain(ts, 'subscribe: this.host.generation.subscribe,')
        expectSourceToContain(ts, 'this.mediaOperationRecovery?.destroy()')
    })

    it('replaces terminal partial media with the live failure card without a workspace reload', () => {
        const recovery = extractFunctionBody(ts, 'applyMediaOperationRecoveryResult')
        expectExcerptToContain(recovery, 'rebalanceGeneratedMediaTrees(result.state.nodes, result.state.edges)', 'failure recovery')
        expectExcerptToContain(recovery, 'commitTransientCanvasStatePreservingEditors({ ...result.state, nodes: rebalancedNodes })', 'failure recovery')
        expectExcerptToContain(recovery, 'syncCanvasNodeDomGeometry(', 'failure recovery')
        expectExcerptToContain(recovery, 'removeApiCanvasRemovedNodesFromDOM(result.removedNodeIds)', 'failure recovery')
        expectExcerptToContain(recovery, "updatedNode?.type === 'operationStatus'", 'failure recovery')
        expectExcerptToContain(recovery, '...replacedGeneratedMediaNodeIds', 'failure recovery')
        expectExcerptToContain(recovery, 'canvasMediaLayer?.setTransientImageSource(nodeId, null)', 'failure recovery')
        expectExcerptToContain(recovery, 'syncExistingOperationStatusNodeToDOM(updatedNode)', 'failure recovery')
        expectExcerptToContain(recovery, 'scheduleGeneratedMediaChromeSync()', 'failure recovery')
        expectExcerptNotToContain(recovery, 'loadWorkspaceRouteData(workspaceId)', 'failure recovery')
    })

    it('applies progress heartbeats as child updates without synchronizing or rerendering canvas nodes', () => {
        const progressUpdate = extractFunctionBody(ts, 'applyMediaOperationProgressResult')
        const eventUpdate = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/generation/workspace-media-operation-recovery.ts')

        expectExcerptToContain(progressUpdate, 'currentCanvasState = result.state', 'progress-only recovery')
        expectExcerptToContain(progressUpdate, 'syncLiveMediaGenerationProgressInstancesForState(result.state)', 'progress-only recovery')
        expectExcerptNotToContain(progressUpdate, 'commitTransientCanvasStatePreservingEditors', 'progress-only recovery')
        expectExcerptNotToContain(progressUpdate, 'syncCanvasNodeDomGeometry', 'progress-only recovery')
        expectExcerptNotToContain(progressUpdate, 'syncCanvasMediaLayer', 'progress-only recovery')
        expectExcerptNotToContain(progressUpdate, 'syncBranchMarkerNodeContents', 'progress-only recovery')
        expectExcerptToContain(
            eventUpdate,
            "event.status === 'MEDIA_GENERATION_PROGRESS'",
            'progress event recovery',
        )
        expectSourceToContain(ts, 'if (progressOnly) this.applyMediaOperationProgressResult(result)')
    })

    it('updates the selected unified-sidebar trace directly from progress heartbeats', () => {
        const progressSync = extractFunctionBody(ts, 'syncLiveMediaGenerationProgressInstancesForState')
        expectExcerptToContain(progressSync, 'syncGeneratedOutputNodeFooters(canvasState)', 'trace heartbeat sync')
        expectExcerptToContain(progressSync, 'activeOutputDetails?.sync(canvasState)', 'trace heartbeat sync')
        expectExcerptNotToContain(progressSync, 'commitCanvasState', 'trace heartbeat sync')
        expectSourceNotToContain(ts, 'activeMediaGenerationTraceProgress')
    })

    it('attaches reference ambiguity to the submitted prompt with canonical Asset references', () => {
        const markerContent = extractFunctionBody(ts, 'createBranchMarkerContent')
        const referenceResolution = extractFunctionBody(ts, 'createBranchMarkerReferenceResolution')
        const resolutionStyles = extractBlock(loadScss(), '.workspace-branch-reference-resolution')
        expectSourceToContain(ts, 'if (isMediaGenerationReferenceResolutionOperation(node)) return false')
        expectExcerptToContain(markerContent, 'getMediaGenerationReferenceResolutionForMarker(this.currentCanvasState.nodes, node)', 'branch marker content')
        expectExcerptToContain(markerContent, 'referenceResolution: resolutionOperation ? this.createBranchMarkerReferenceResolution(resolutionOperation)', 'branch marker content')
        expectExcerptToContain(referenceResolution, 'createBranchReferenceResolution({', 'reference resolution')
        expectExcerptToContain(referenceResolution, "referenceType: 'media'", 'reference resolution')
        expectExcerptToContain(referenceResolution, 'this.host.generation.resolveReference({', 'reference resolution')
        expectExcerptNotToContain(referenceResolution, '<button', 'reference resolution')
        expectExcerptToContain(resolutionStyles, 'right: 0', 'reference resolution styles')
        expectExcerptToContain(resolutionStyles, 'bottom: calc(100% + 7px)', 'reference resolution styles')
        expectSourceNotToContain(ts, 'workspace-media-operation-candidate')
    })

    it('renders provider verification, failure, edit, cancel, and dismiss actions', () => {
        expectSourceToContain(ts, 'new OperationStatusNode(node, this.nodeShells, {')
        expectSourceToContain(ts, 'response.checkpoint.selectedReferences.flatMap')
        expectSourceToContain(ts, 'addContextChips(restoredContextNodeIds)')
    })
})

// =============================================================================
// workspace-image-node — consistent box-shadow
// =============================================================================

describe('workspace node CSS — box-shadow consistency', () => {
    const scss = loadScss()
    const docNodeBlock = extractBlock(scss, '.workspace-document-node')
    const imageNodeBlock = extractBlock(scss, '.workspace-image-node')

    it('.workspace-document-node has exactly one box-shadow (base only)', () => {
        const allShadows = extractBoxShadowValues(docNodeBlock)
        expect(allShadows).toHaveLength(1)
        expect(allShadows[0]).not.toBe('none')
    })

    it('no hover box-shadow override on any node', () => {
        const hoverDocBlock = extractBlock(docNodeBlock, '&:hover')
        expect(extractBoxShadowValues(hoverDocBlock)).toHaveLength(0)

        const hoverImgBlock = extractBlock(imageNodeBlock, '&:hover')
        expect(extractBoxShadowValues(hoverImgBlock)).toHaveLength(0)
    })

    it('keeps document selected/focus styling from adding box-shadow', () => {
        expect(docNodeBlock).not.toMatch(/is-selected[\s\S]*?box-shadow/)
        expect(docNodeBlock).not.toMatch(/focus-within[\s\S]*?box-shadow/)
    })

    it('no box-shadow transition on any node', () => {
        expectExcerptNotToContain(docNodeBlock, 'transition: box-shadow')
        expectExcerptNotToContain(docNodeBlock, 'transition:box-shadow')
    })

    it('.workspace-image-node base uses the theme-configured default box-shadow', () => {
        expect(imageNodeBlock).toMatch(/^\s*box-shadow:\s*var\(--workspace-media-node-default-box-shadow\);/m)
    })

    it('keeps generated media model chrome free of badge and button shadows', () => {
        const badgeBlock = extractBlock(loadMediaModelBadgeScss(), '.media-model-badge')
        const infoButtonBlock = extractBlock(
            loadCanvasNodeFooterScss(),
            '.canvas-node-footer-info-button,\n.canvas-node-footer-progress-button',
        )

        expect(extractBoxShadowValues(badgeBlock)).toHaveLength(0)
        expect(extractBoxShadowValues(infoButtonBlock)).toHaveLength(0)
    })

    it('uses a theme-configured shadow for selected image nodes', () => {
        const selectedBlock = extractBlockContainingSelector(imageNodeBlock, '&.is-selected')
        expectExcerptToContain(selectedBlock, 'box-shadow: var(--workspace-media-node-selected-box-shadow)', 'selected image selector block')
        expectExcerptNotToContain(selectedBlock, 'outline:', 'selected image selector block')
    })

    it('renders generated media icon chrome with bounded screen-space zoom scaling', () => {
        const ts = loadTs()
        const chromeLayerBlock = extractBlock(scss, '.workspace-generated-media-chrome-layer,\n.workspace-generated-media-pending-icon-layer')
        const footerScss = loadCanvasNodeFooterScss()
        const actionsBlock = extractBlock(footerScss, '.canvas-node-footer')
        const infoButtonBlock = extractBlock(
            footerScss,
            '.canvas-node-footer-info-button,\n.canvas-node-footer-progress-button',
        )
        const infoIconBlock = extractBlock(footerScss, '.canvas-node-footer-info-icon svg')
        expectSourceToContain(ts, 'this.paneEl.append(this.outputChrome.element, this.outputChrome.pendingElement)')
        expectSourceToContain(ts, 'settings: this.host.settings.mediaNode.generatedMediaChrome,')
        expectSourceToContain(ts, 'outputChrome.update(nodeId, { ...position, ...dimensions }, viewport)')
        expectSourceToContain(ts, 'outputChrome.sync(canvasState)')
        expectSourceToContain(ts, 'createModelBadge: options => this.host.models.createBadge(options)')
        expectSourceNotToContain(ts, 'generatedMediaInfoPanelLayerEl')
        expectSourceNotToContain(ts, 'createGeneratedMediaInfoPanelChrome')
        expectExcerptToContain(chromeLayerBlock, 'pointer-events: none', 'generated media chrome layer')
        expectExcerptToContain(actionsBlock, 'gap: 6px', 'canvas node footer')
        expectExcerptToContain(infoButtonBlock, 'width: var(--canvas-node-footer-icon-size, 34px)', 'media info button')
        expectExcerptToContain(infoIconBlock, 'width: 79.5918%', 'media info icon')
    })
})

// =============================================================================
// PIXI media layer — first sync geometry
// =============================================================================

describe('PIXI media layer — first sync geometry', () => {
    const ts = loadPixiMediaLayer()

    it('initializes new image sprite and placeholder geometry during first upsert', () => {
        const host = loadTs()
        expectSourceToContain(host, "from '@lixpi/canvas-components-lixpi-specific/frontend/media'")
        expectSourceToContain(host, 'createWorkspaceMediaLayer({')
        expectSourceNotToContain(host, 'getVideoLayer')
        expectSourceNotToContain(host, 'createVideoNodeHandler')
        expectSourceNotToContain(host, "from 'pixi.js'")
    })
})

// =============================================================================
// Generated image previews — PIXI-backed state and progress rendering
// =============================================================================

describe('Workspace canvas — generated image preview rendering', () => {
    const ts = loadTs()
    const scss = loadScss()

    it('commits progressive preview pixels through canvas state instead of a DOM image', () => {
        const partialStart = ts.indexOf('onImagePartialToCanvas:')
        const completeStart = ts.indexOf('onImageCompleteToCanvas:', partialStart)
        expect(partialStart).toBeGreaterThan(-1)
        expect(completeStart).toBeGreaterThan(partialStart)

        const partialHandler = ts.slice(partialStart, completeStart)
        expectExcerptToContain(partialHandler, 'this.ports.setTransientImageSource(existing.nodeId, imageUrl)')
        expectExcerptToContain(partialHandler, 'this.ports.commitTransientCanvasStatePreservingEditors({ ...this.currentCanvasState, nodes: resolvedNodes })')
        expectExcerptNotToContain(partialHandler, 'imgEl.src', 'partial image handler')
    })

    it('renders the generating-image snake border through PIXI until the image leaves partial state', () => {
        const pixiLayerTs = loadPixiMediaLayer()
        const outlineRendererTs = loadPixiTravelingOutlineRenderer()
        const settingsTs = loadSettings()
        const partialStart = ts.indexOf('onImagePartialToCanvas:')
        const completeStart = ts.indexOf('onImageCompleteToCanvas:', partialStart)
        const partialHandler = ts.slice(partialStart, completeStart)
        const completeEnd = ts.indexOf('onVideoPendingToCanvas:', completeStart)
        const completeHandler = ts.slice(completeStart, completeEnd)

        expectSourceToContain(ts, 'canvasMediaLayer?.setGeneratingImageNodes(')
        expectSourceToContain(pixiLayerTs, 'new TravelingOutline({')
        expectSourceToContain(pixiLayerTs, 'this.outlines.sync(datums)')
        expectSourceToContain(outlineRendererTs, 'export class TravelingOutline {')
        expectSourceNotToContain(outlineRendererTs, "from 'pixi.js'")
        expectSourceToContain(settingsTs, 'gap: 3')
        expectSourceToContain(settingsTs, 'preFrameCircleScale: mediaGenerationLayoutSettings.preFrameCircleScale')
        expectSourceToContain(settingsTs, 'snakeWidth: 9')
        expectSourceToContain(settingsTs, 'snakeTailWidthFraction: 0.14')
        expectSourceToContain(settingsTs, 'snakeLengthFraction: 0.24')
        expectSourceToContain(settingsTs, "'#ff0084'")
        expectSourceToContain(settingsTs, 'animationDurationMs: 3200')
        expectSourceNotToContain(ts, 'SvgGradientRenderer')
        expectSourceNotToContain(ts, 'image-generating-border')
        expectSourceNotToContain(ts, 'image-generating-spinner')
        expectSourceNotToContain(ts, 'img-dot-bounce')
        expectSourceNotToContain(scss, '.workspace-image-progress-viewport')
        expectExcerptToContain(partialHandler, 'if (existing && !this.getCurrentCanvasMediaNode(existing.nodeId)) {', 'partial image handler')
        expectExcerptToContain(partialHandler, 'this.ports.trackers.images.delete(runKey)', 'partial image handler')
        expectExcerptToContain(completeHandler, 'this.ports.visuals.keepCompletion(runKey, completionTracker, completedImageNode)')
        expectExcerptToContain(completeHandler, "'image-complete-apply'")
        expectExcerptNotToContain(completeHandler, 'commitCanvasState({', 'complete image handler')
    })

    it('finalizes generated images only from API-resolved geometry', () => {
        const completeStart = ts.indexOf('onImageCompleteToCanvas:')
        const callbackEnd = ts.indexOf('onVideoPendingToCanvas:', completeStart)
        expect(completeStart).toBeGreaterThan(-1)
        expect(callbackEnd).toBeGreaterThan(completeStart)

        const completeHandler = ts.slice(completeStart, callbackEnd)
        expectExcerptToContain(completeHandler, 'missing image completion geometry; refusing local canvas topology mutation', 'complete image handler')
        expectExcerptToContain(completeHandler, "'image-complete-apply'", 'complete image handler')
        expectExcerptToContain(completeHandler, 'applyApiCanvasGeometry(data.canvasGeometry)', 'complete image handler')
        expectExcerptToContain(completeHandler, 'appendCanvasNodeToDOM(completedImageNode)', 'complete image handler')
        expectExcerptNotToContain(completeHandler, 'const imageSrc = buildGeneratedImageFrameSrc({', 'complete image handler')
        expectExcerptNotToContain(completeHandler, 'commitCanvasState({', 'complete image handler')
        expectExcerptNotToContain(completeHandler, 'const deduped = withoutGeneratedMediaDuplicateNodes({', 'complete image handler')
        expectExcerptNotToContain(completeHandler, 'rebalanceGeneratedMediaTrees(deduped.state.nodes, deduped.state.edges)', 'complete image handler')
        expectExcerptNotToContain(completeHandler, 'imgEl.src', 'complete image handler')
    })

    it('arms the final original rendition before completion can release the transient frame', () => {
        const completeStart = ts.indexOf('onImageCompleteToCanvas:')
        const callbackEnd = ts.indexOf('onVideoPendingToCanvas:', completeStart)
        expect(completeStart).toBeGreaterThan(-1)
        expect(callbackEnd).toBeGreaterThan(completeStart)

        const completeHandler = ts.slice(completeStart, callbackEnd)
        const handoffIndex = completeHandler.indexOf('prepareGeneratedImageCompletionTextureHandoff(')
        const missingGeometryBranchIndex = completeHandler.indexOf('if (!data.canvasGeometry)')
        const transientReleaseIndex = completeHandler.lastIndexOf('this.ports.setTransientImageSource(pendingNodeId, null)')
        const geometryApplyIndex = completeHandler.indexOf('applyApiCanvasGeometry(data.canvasGeometry)')

        expect(handoffIndex).toBeGreaterThan(-1)
        expect(missingGeometryBranchIndex).toBeGreaterThan(handoffIndex)
        expect(completeHandler.slice(0, missingGeometryBranchIndex)).not.toContain('setTransientImageSource(')
        expect(transientReleaseIndex).toBeGreaterThan(handoffIndex)
        expect(geometryApplyIndex).toBeGreaterThan(handoffIndex)
        expect(transientReleaseIndex).toBeGreaterThan(geometryApplyIndex)
    })

    it('anchors completed-image connectors to the final media rectangle during texture handoff', () => {
        const connectorNodesStart = ts.indexOf('geometry: type => ({')
        const connectorEdgesStart = ts.indexOf('movable: true,', connectorNodesStart)
        const clearOutlineStart = ts.indexOf('onFinalized: nodeId => {')
        const clearOutlineEnd = ts.indexOf('this.canvasSelectionColors =', clearOutlineStart)
        expect(connectorNodesStart).toBeGreaterThan(-1)
        expect(connectorEdgesStart).toBeGreaterThan(connectorNodesStart)
        expect(clearOutlineStart).toBeGreaterThan(-1)
        expect(clearOutlineEnd).toBeGreaterThan(clearOutlineStart)

        const connectorNodes = ts.slice(connectorNodesStart, connectorEdgesStart)
        const clearOutline = ts.slice(clearOutlineStart, clearOutlineEnd)
        expectExcerptToContain(
            connectorNodes,
            'generationVisuals.isFinalizing(node.nodeId)',
            'connector node geometry',
        )
        expectExcerptToContain(
            connectorNodes,
            ': this.getPendingGeneratedMediaBeforeFrameVisualGeometry(node.nodeId, node.position, node.dimensions)',
            'connector node geometry',
        )
        expectExcerptToContain(
            clearOutline,
            'syncConnectionManagerForCurrentCanvasState({ flushRenderer: true })',
            'completion texture handoff cleanup',
        )
    })

    it('keeps terminal candidate controls usable while the local Asset cache catches up', () => {
        const readiness = extractFunctionBody(ts, 'isGeneratedOutputReviewReady')
        const accepted = extractFunctionBody(ts, 'isGeneratedOutputAccepted')
        const chrome = loadOutputChrome()
        const chromeKey = loadOutputChrome()

        expectExcerptToContain(readiness, 'outputReview.isGeneratedOutputReviewReady(node)', 'generated output readiness')
        expectExcerptToContain(accepted, 'outputReview.isGeneratedOutputAccepted(node)', 'generated output accepted state')
        expectExcerptToContain(chrome, 'isGeneratedOutputRejectableForCanvas(reviewContext)', 'reject control')
        expectExcerptToContain(chromeKey, "node.generatedBy?.generationRequestId ?? ''", 'generated media chrome key')
        expectExcerptToContain(chromeKey, "node.generatedBy?.branchOriginNodeId ?? ''", 'generated media chrome key')
        expectExcerptToContain(chromeKey, "asset?.media?.renditions.original?.status ?? ''", 'generated media chrome key')
        expectExcerptToContain(chromeKey, "asset?.generatedOutputReview?.status ?? ''", 'generated media chrome key')
        expectSourceToContain(ts, 'this.documentNodes.syncDocuments(this.currentDocuments)\n            this.syncBranchMarkerNodeContents()')
    })

    it('preserves workspace panel metadata when image workflows write canvas state', () => {
        const imageCallbacksStart = ts.indexOf('events.subscribeImages({')
        const errorStart = ts.indexOf('onImageErrorToCanvas:', imageCallbacksStart)
        const partialStart = ts.indexOf('onImagePartialToCanvas:', imageCallbacksStart)
        const completeStart = ts.indexOf('onImageCompleteToCanvas:', imageCallbacksStart)
        const videoStart = ts.indexOf('events.subscribeVideos', errorStart)
        const partialHandler = ts.slice(partialStart, completeStart)
        const completeHandler = ts.slice(completeStart, videoStart)
        const errorHandler = ts.slice(errorStart, partialStart)

        expectExcerptToContain(partialHandler, '...this.currentCanvasState,', 'partial image handler')
        expectExcerptToContain(completeHandler, 'applyApiCanvasGeometry(data.canvasGeometry)', 'complete image handler')
        expectExcerptNotToContain(completeHandler, 'currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 }', 'complete image handler')
        expectExcerptToContain(errorHandler, 'const existing = this.ports.trackers.images.get(runKey)', 'error image handler')
        expectExcerptNotToContain(errorHandler, 'removeFailedGeneratedMediaNodeFromCanvas(existing.nodeId)', 'error image handler')
        expectExcerptToContain(errorHandler, 'finishFailedGeneratedMediaRun(threadId, generationRun)', 'error image handler')
        expectSourceToContain(ts, 'commitCanvasStatePreservingEditors({')
        expectSourceToContain(ts, 'commitCanvasState({')
    })

    it('re-tidies generated-media trees when final image proportions resolve', () => {
        expectSourceToContain(loadWorkspaceLineageProjection(), 'computeCenteredPositionToRightOfRect(')
        expectSourceToContain(ts, 'const resolvedNodes = this.isGeneratedMediaNode(imageNode)')
        expectSourceToContain(ts, 'const resolvedNodes = this.isGeneratedMediaNode(videoNode)')
        expectSourceToContain(ts, '? this.rebalanceGeneratedMediaTrees(updatedNodes, this.currentCanvasState.edges)')
        expectSourceToContain(ts, 'if (!needsRerender) this.syncCanvasNodeDomGeometry(this.currentCanvasState.nodes)')
        expectSourceNotToContain(ts, 'getGeneratedImageLineageAnchorRect(')
        expectSourceNotToContain(ts, '? computeVerticallyCenteredY(lineageAnchorRect, fittedDimensions.height)')
    })

    it('routes generated-media add/remove through the centralized tree rebalance', () => {
        const rebalancePipeline = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/branch-tree-layout/generated-media-rebalance.ts')
        expectSourceToContain(ts, "from '@lixpi/canvas-components-lixpi-specific/shared'")
        expectSourceToContain(rebalancePipeline, "import { getStartedLineageMarkerState } from './branch-lineage-state.ts'")
        expectSourceToContain(ts, 'private createGeneratedMediaRebalancePipeline = (): GeneratedMediaRebalancePipeline')
        expectSourceToContain(ts, 'private rebalanceGeneratedMediaTrees = (nodes: CanvasNode[], edges: WorkspaceEdge[]): CanvasNode[]')
        expectSourceToContain(ts, 'const result = this.createGeneratedMediaRebalancePipeline().rebalance(nodes, edges)')
        expectSourceToContain(ts, 'clearStartedBranchMarkerProjectionOverrides(result.startedMarkerNodeIds)')
        expectSourceToContain(ts, 'return this.workspaceGeometry.createGeneratedMediaRebalancePipeline()')
        // Layout boxes equal rendered boxes: pending media use the compact
        // pre-frame circle for collision/layout purposes until a frame exists.
        expectSourceToContain(ts, 'getPendingGeneratedMediaBeforeFrameCircleGeometry(')
        expectSourceNotToContain(ts, 'getPendingGeneratedMediaBeforeFrameInsertionPosition')
        expectSourceNotToContain(ts, 'getFullFramePositionFromPendingGeneratedMediaPosition')
        expectSourceNotToContain(ts, "import { rebalanceBranchTreesAndResolve } from '$src/infographics/workspace/branchTreeLayout.ts'")
        // Wired into in-progress generated-media placeholder paths. Completion
        // topology is API-owned and arrives through CanvasGeometryUpdate.
        expectSourceToContain(ts, 'const rebalancedNodes = this.ports.rebalanceGeneratedMediaTrees(nodesWithImage, newEdges)')
        // Video pending placeholders are now entirely API-owned: onVideoPendingToCanvas
        // applies the server's canvasGeometry instead of building a local node tree.
        expectSourceNotToContain(ts, 'rebalanceGeneratedMediaTrees(nodesWithVideo, newEdges)')
        // Re-tidies on delete only when the removed node was a lineage member.
        expectSourceToContain(ts, '(isGeneratedOutputCanvasNode(deletedNode) && Boolean(deletedNode.generatedBy?.branchId)) || isBranchMarkerNode(deletedNode)')
        expectSourceToContain(ts, 'this.ports.resolveTree(remainingNodes, updatedEdges)')
        expectSourceNotToContain(ts, ['stripLegacy', 'Branch', 'Origin', 'Nodes'].join(''))
    })

    it('applies API-resolved authoritative canvas geometry instead of recomputing generation layout', () => {
        const geometry = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/scene/workspace-api-canvas-geometry.ts')
        // The API runs the shared branch-tree layout and broadcasts resolved
        // geometry over the chat stream; the client applies it transiently (no
        // re-persist, the API already wrote it) with a monotonic revision guard.
        expectSourceToContain(geometry, 'applyCanvasGeometryUpdateToState')
        expectSourceToContain(ts, 'private applyApiCanvasGeometry = (canvasGeometry: CanvasGeometryUpdate): void')
        expectSourceToContain(geometry, 'if (canvasGeometry.layoutRevision <= this.lastAppliedApiLayoutRevision) return')
        expectSourceToContain(geometry, 'if (canvasGeometry.layoutRevision < this.highestObservedApiLayoutRevision) return')
        expectSourceToContain(geometry, 'const result = applyCanvasGeometryUpdateToState(preflight.state, canvasGeometry)')
        expectSourceToContain(geometry, 'nodeSnapshotCount: canvasGeometry.nodeSnapshots?.length ?? 0')
        expectSourceToContain(geometry, 'edgeSnapshotCount: canvasGeometry.edgeSnapshots?.length ?? 0')
        expectSourceToContain(geometry, 'removedNodeIds: canvasGeometry.removedNodeIds ?? []')
        expectSourceToContain(geometry, 'upsertedEdgeIds: result.upsertedEdgeIds')
        expectSourceToContain(ts, 'this.pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(this.currentCanvasState)')
        expectSourceToContain(geometry, 'this.ports.commit(result.state)')
        expectSourceToContain(geometry, "this.ports.log('removed-dom-nodes', { removedNodeIds: [...preflight.removedNodeIds, ...result.removedNodeIds] })")
        expectSourceToContain(geometry, 'const replacedMediaNodeIds = result.updatedNodeIds.filter(nodeId => {')
        expectSourceToContain(geometry, '...replacedMediaNodeIds')
        expectSourceToContain(ts, 'onCanvasGeometryResolvedToCanvas: ({ workspaceId: eventWorkspaceId, canvasGeometry }) => {')
        // Complete handlers only apply API geometry and refuse local topology mutation.
        expectSourceToContain(ts, "'image-complete-apply'")
        expectSourceToContain(ts, "'video-complete-apply'")
        expectSourceToContain(ts, 'missing image completion geometry; refusing local canvas topology mutation')
        expectSourceToContain(ts, 'missing video completion geometry; refusing local canvas topology mutation')
        expectSourceToContain(ts, 'appendCanvasNodeToDOM(completedImageNode)')
        expectSourceToContain(ts, 'appendCanvasNodeToDOM(completedVideoNode)')
        expectSourceToContain(ts, 'applyApiCanvasGeometry(data.canvasGeometry)')
        const snapshotSync = loadWorkspacePreflightMethod('syncApiCanvasSnapshotNodesToDOM', '../scene/workspace-api-canvas-geometry')
        expectExcerptToContain(
            snapshotSync,
            "if (node.type === 'operationStatus') this.ports.syncOperationNode(node)",
            'failed operation-status snapshot DOM sync',
        )
        const replacement = extractFunctionBody(ts, 'syncExistingOperationStatusNodeToDOM')
        expectExcerptToContain(replacement, 'appendCanvasNodeToDOM(node)', 'operation status reconciliation')
        const waitingForFrameStart = ts.indexOf('private isGeneratedMediaCanvasNodeWaitingForFrame = ')
        const waitingForFrameEnd = ts.indexOf('private isPendingGeneratedMediaBeforeFirstFrame = ', waitingForFrameStart)
        expect(waitingForFrameStart).toBeGreaterThan(-1)
        expect(waitingForFrameEnd).toBeGreaterThan(waitingForFrameStart)
        const waitingForFrame = ts.slice(waitingForFrameStart, waitingForFrameEnd)
        expectExcerptToContain(waitingForFrame, 'return this.generationVisuals.isWaitingForFrame(node)', 'terminal media progress guard')
    })

    it('swaps partial pixels without replaying geometry or blanking the prior texture', () => {
        const pixiLayerTs = loadPixiMediaLayer()
        const intrinsicStart = ts.indexOf('private handleImageIntrinsicSize = ')
        const intrinsicEnd = ts.indexOf('private applyApiCanvasGeometry = ', intrinsicStart)
        expect(intrinsicStart).toBeGreaterThan(-1)
        expect(intrinsicEnd).toBeGreaterThan(intrinsicStart)
        const intrinsicHandler = ts.slice(intrinsicStart, intrinsicEnd)

        expectExcerptToContain(intrinsicHandler, 'if (size.preserveNodeGeometry) return', 'intrinsic image handler')
        expectSourceToContain(pixiLayerTs, 'new WorkspaceMediaNodes({ ...options,')
        expectSourceToContain(loadGenerationHandlers(), 'this.ports.syncCanvasMediaLayer(this.currentCanvasState)')
        expectSourceToContain(loadGenerationHandlers(), 'this.ports.syncCanvasNodeDomGeometry([imageNode])')
        expectSourceToContain(loadGenerationHandlers(), 'this.ports.renderNow()')
    })

    it('keeps in-progress generated media aligned with API-owned lineage identity', () => {
        const history = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/review/workspace-history.ts')
        expectSourceToContain(history, 'buildBranchMarkerTurnProjectionFromThreadContent')
        expectSourceToContain(ts, 'getPendingGeneratedMediaNodeId')
        expectSourceToContain(history, 'allowLatestTurnFallback: this.canUseLatestBranchMarkerTurnFallback(marker)')
        expectSourceToContain(history, '|| Boolean(node.pendingState)')
        expectSourceToContain(history, '|| this.getBranchMarkerGeneratedArtifactNodes(node).length > 0')
        expectSourceToContain(ts, "const expectedNodeId = lineageAssignment ? getPendingGeneratedMediaNodeId(lineageAssignment) : ''")
        expectSourceToContain(ts, "const completedNodeId = generationRun?.lineageAssignment\n                        ? getPendingGeneratedMediaNodeId(generationRun.lineageAssignment)\n                        : ''")
        expectSourceToContain(ts, 'const nodeId = getPendingGeneratedMediaNodeId(lineageAssignment)')
        expectSourceToContain(loadWorkspaceLineageProjection(), 'const lineageParentNodeId = lineageAssignment?.lineageParentNodeId')
        expectSourceNotToContain(ts, 'const nodeId = `node-${fileId || uuidv4()}`')
    })
})

describe('Workspace canvas — generated video canvas state', () => {
    const ts = loadTs()

    it('preserves workspace panel metadata when video workflows use API geometry', () => {
        // Regression: the video callbacks used to build a fresh { viewport, nodes,
        // edges } object, dropping aiChatPanel / sidebar tabs and collapsing the
        // chat panel. Video pending/complete now apply the API's canvasGeometry
        // directly onto currentCanvasState instead of rebuilding it locally.
        const pendingStart = ts.indexOf('onVideoPendingToCanvas:')
        const generatingStart = ts.indexOf('onVideoGeneratingToCanvas:', pendingStart)
        const completeStart = ts.indexOf('onVideoCompleteToCanvas:', generatingStart)
        const errorStart = ts.indexOf('onVideoErrorToCanvas:', completeStart)
        const errorEnd = ts.indexOf('this.resizeObserver = new ResizeObserver', errorStart)

        expect(pendingStart).toBeGreaterThan(-1)
        expect(completeStart).toBeGreaterThan(pendingStart)
        expect(errorStart).toBeGreaterThan(completeStart)
        expect(errorEnd).toBeGreaterThan(errorStart)

        const pendingHandler = ts.slice(pendingStart, generatingStart)
        const completeHandler = ts.slice(completeStart, errorStart)
        const errorHandler = ts.slice(errorStart, errorEnd)

        expectExcerptToContain(pendingHandler, 'applyApiCanvasGeometry(canvasGeometry)', 'video pending handler')
        expectExcerptToContain(completeHandler, 'applyApiCanvasGeometry(data.canvasGeometry)', 'video complete handler')
        expectExcerptNotToContain(completeHandler, 'commitCanvasState({', 'video complete handler')
        expectExcerptToContain(errorHandler, 'this.ports.trackers.videos.delete(runKey)', 'video error handler')
        expectExcerptNotToContain(errorHandler, 'removeFailedGeneratedMediaNodeFromCanvas(existing.nodeId)', 'video error handler')
    })

    it('supplies ready videos and live geometry to the package chrome', () => {
        expectSourceToContain(ts, 'video: this.videoChrome,')
        expectSourceToContain(ts, 'getAsset: assetId => this.host.assets.read(assetId),')
        expectSourceToContain(ts, 'outputChrome.update(nodeId, { ...position, ...dimensions }, viewport)')
    })

    it('syncs video chrome after video handler entries exist', () => {
        const renderStart = ts.indexOf('render = (newCanvasState: CanvasState | null')
        const pixiSync = ts.indexOf('this.syncCanvasMediaLayer(this.currentCanvasState)', renderStart)
        const chromeSync = ts.indexOf('this.syncGeneratedMediaChrome(this.currentCanvasState)', renderStart)

        expect(renderStart).toBeGreaterThan(-1)
        expect(pixiSync).toBeGreaterThan(-1)
        expect(chromeSync).toBeGreaterThan(pixiSync)
        expectSourceToContain(ts, 'onPlaybackReady: () => this.scheduleGeneratedMediaChromeSync(),')
    })

    it('counts prior videos as siblings when positioning a new generated output', () => {
        // Regression: getGeneratedChildOutputs used to match only images, so a new
        // video could not see a previously generated video and the two stacked on
        // the same spot. Both media types must qualify as sibling outputs.
        expectSourceToContain(loadWorkspaceLineageProjection(), "if ((node.type !== 'image' && node.type !== 'video') || node.parentId) return false")
    })

    it('uses only API geometry when a video completes', () => {
        const completeStart = ts.indexOf('onVideoCompleteToCanvas:')
        const errorStart = ts.indexOf('onVideoErrorToCanvas:', completeStart)
        const completeHandler = ts.slice(completeStart, errorStart)

        expectExcerptToContain(completeHandler, 'missing video completion geometry; refusing local canvas topology mutation', 'video complete handler')
        expectExcerptToContain(completeHandler, "'video-complete-apply'", 'video complete handler')
        expectExcerptToContain(completeHandler, 'applyApiCanvasGeometry(data.canvasGeometry)', 'video complete handler')
        expectExcerptNotToContain(completeHandler, 'const edges = currentCanvasState.edges.map((edge: WorkspaceEdge) => {', 'video complete handler')
        expectExcerptNotToContain(completeHandler, 'rebalanceGeneratedMediaTrees(deduped.state.nodes, deduped.state.edges)', 'video complete handler')
    })

    it('queues completed video analysis from the API-materialized node', () => {
        const completeStart = ts.indexOf('onVideoCompleteToCanvas:')
        const errorStart = ts.indexOf('onVideoErrorToCanvas:', completeStart)
        const completeHandler = ts.slice(completeStart, errorStart)
        expectExcerptToContain(completeHandler, 'const completedVideoNode = this.getCurrentCanvasMediaNode(completedNodeId)', 'video complete handler')
        expectExcerptToContain(completeHandler, 'void this.ports.analysis.refreshCompleted(completedVideoNode)', 'video complete handler')
        const analysis = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/generation/workspace-media-analysis.ts')
        expectSourceToContain(analysis, 'async refreshCompleted(node: MediaNode)')
        expectSourceToContain(analysis, 'await this.ports.refreshAsset(work.assetId, work.workspaceId)')
    })

    it('opens a node-scoped generation timeline through the shared footer and unified details target', () => {
        const renderDetails = extractFunctionBody(ts, 'renderGeneratedOutputDetailsContent')
        const resolveTraceState = extractFunctionBody(ts, 'getMediaGenerationTraceState')
        const resolveProgress = extractFunctionBody(ts, 'isGeneratedOutputProgressActive')
        const detailsBody = extractBlock(loadScss(), '.workspace-generated-output-details-panel-body.workspace-generated-output-details-content')
        const traceProgressBlock = extractBlock(loadScss(), '.workspace-media-generation-sidebar-progress')
        expectExcerptToContain(ts, "onOpenDetails: nodeId => this.openGeneratedOutputDetails({ kind: 'output', nodeId }, { toggle: true })", 'canvas node footer')
        expectExcerptToContain(resolveTraceState, 'return this.workspaceHistory.getMediaGenerationTraceState(node)', 'live generation trace state')
        expectExcerptToContain(resolveProgress, "traceState?.status === 'pending'", 'active footer progress')
        expectExcerptToContain(resolveProgress, "traceState?.status === 'awaiting-provider-verification'", 'active footer progress')
        expectExcerptToContain(renderDetails, 'progressDetails: this.getExecutionTraceTimelineDetail()', 'sidebar timeline')
        expectExcerptToContain(renderDetails, 'getProgress: this.getMediaGenerationTraceState,', 'sidebar timeline')
        expectExcerptToContain(detailsBody, 'overflow-y: auto', 'details scroll surface')
        expectExcerptToContain(traceProgressBlock, '--progress-timeline-title-size: var(--workspace-right-sidebar-content-font-size)', 'timeline title typography')
    })

    it('uses the standard chat projection for Capability Artifact lineage history', () => {
        const renderDetails = extractFunctionBody(ts, 'renderGeneratedOutputDetailsContent')
        const artifactHistory = extractFunctionBody(ts, 'mountCapabilityArtifactHistory')
        expectExcerptToContain(renderDetails, 'mountArtifactHistory: ({ host, node, signal }) => this.mountCapabilityArtifactHistory(host, node, signal)', 'Capability Artifact details')
        expectExcerptToContain(artifactHistory, 'new WorkspaceGenerationHistory({ host: mount, projection, signal }, this.getGenerationHistoryPorts())', 'Capability Artifact history')
        expectSourceToContain(ts, 'return this.workspaceHistory.buildCapabilityArtifactTurnProjectionContent(node)')
        expectSourceToContain(readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/review/workspace-history.ts'), 'allowLatestTurnFallback: false')
        expectSourceNotToContain(ts, 'createCapabilityArtifactBranchHistoryPanel')
    })

    it('routes Timeline, lineage, and historical message references through the shared preview renderer', () => {
        const capabilityReferenceView = extractFunctionBody(ts, 'createCapabilityArtifactAssetReferenceView')
        const previewNodeResolver = extractFunctionBody(ts, 'getPromptReferencePreviewNode')
        const markerContent = extractFunctionBody(ts, 'createBranchMarkerContent')

        expectExcerptToContain(capabilityReferenceView, 'createMediaPromptReferencePreview(', 'Timeline references')
        expectExcerptToContain(capabilityReferenceView, 'displayName: asset.title.trim()', 'Timeline reference title')
        expectExcerptToContain(capabilityReferenceView, 'getPromptReferencePreviewRenderer({ inlinePopover: true })', 'Timeline reference hover')
        expectExcerptNotToContain(capabilityReferenceView, "mediaKind === 'audio'", 'Timeline audio references')
        expectExcerptToContain(previewNodeResolver, 'return this.referenceProjection.getPromptReferencePreviewNode(reference)', 'audio preview nodes')
        expectSourceToContain(ts, 'createAssetReferenceView: this.createCapabilityArtifactAssetReferenceView')
        expectSourceNotToContain(ts, 'resolveThumbnailUrl: assetId =>')
        expectSourceToContain(ts, 'new WorkspaceCapabilityNode(node, this.nodeShells, {')
        expectSourceToContain(ts, 'ensureAssetsLoaded: assetIds => this.host.assets.ensureAssetsLoaded(assetIds)')
        expectExcerptToContain(markerContent, 'previewRenderer: this.getPromptReferencePreviewRenderer({ inlinePopover: true })', 'branch marker references')
        expectSourceToContain(ts, 'promptReferencePreviewRenderer: this.getPromptReferencePreviewRenderer({ inlinePopover: true }),')
        expectSourceNotToContain(loadScss(), '.workspace-branch-marker-message-text:has(.context-preview-inline.is-open)')
    })

    it('combines media metadata and history in the unified details renderer while using one footer for Artifacts', () => {
        const renderDetails = extractFunctionBody(ts, 'renderGeneratedOutputDetailsContent')
        const detailsProjection = extractFunctionBody(ts, 'mountGeneratedMediaDetailsProjection')
        const chatProjection = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/review/workspace-generation-history.ts')
        const artifactChrome = loadOutputChrome()
        expectExcerptToContain(renderDetails, 'assets: this.createAssetViewPorts()', 'generated media details')
        expectExcerptToContain(renderDetails, 'new WorkspaceOutputDetails(body, node, {', 'generated media history')
        expectExcerptToContain(renderDetails, 'mountGeneratedMediaDetailsProjection(host, target, onProgress, signal)', 'generated media history')
        expectExcerptToContain(detailsProjection, 'return mountWorkspaceMediaHistory({', 'generated media history')
        expectExcerptToContain(chatProjection, 'includeGenerationProgressTimeline: true', 'generated media history')
        expectExcerptToContain(chatProjection, 'resolveMediaGenerationHistoryProgress({', 'generated media history')
        expectExcerptToContain(artifactChrome, 'new GeneratedOutputNodeChrome({', 'generated Artifact chrome')
        expectSourceNotToContain(ts, 'createGeneratedOutputHistoryButton')
        expectSourceNotToContain(loadScss(), '.media-history-button')
    })

    it('removes the ProseMirror ordered-list indent from every generated-media timeline level', () => {
        const scss = loadScss()
        const timelineBlock = extractBlock(
            scss,
            '.canvas-generated-media-projection-editor .ai-media-generation-progress > .progress-timeline,\n'
                + '.canvas-generated-media-projection-editor .ai-media-generation-progress .progress-timeline-children',
        )
        const historyTimelineBlock = extractBlock(
            scss,
            '.canvas-generated-media-history-panel > .workspace-media-generation-progress,\n'
                + '.canvas-generated-media-history-panel .ai-media-generation-progress',
        )

        expectExcerptToContain(timelineBlock, 'padding-left: 0;', 'generated media timeline')
        expectExcerptToContain(historyTimelineBlock, 'margin: 18px 0 0;', 'generated media history timeline')
    })

    it('uses the package chrome for media and Capability Artifact nodes with their progress state', () => {
        const progress = extractFunctionBody(ts, 'isGeneratedOutputProgressActive')
        expectSourceToContain(ts, 'this.outputChrome = new WorkspaceOutputChrome({')
        expectSourceToContain(ts, 'isProgressActive: this.isGeneratedOutputProgressActive,')
        expectExcerptToContain(progress, '.get(generatedBy.capabilityRunId)', 'Capability Artifact progress')
        expectExcerptToContain(progress, "status === 'pending' || status === 'running'", 'Capability Artifact progress')
    })

    it('mounts details through the package right-panel content port', () => {
        const content = extractFunctionBody(ts, 'mountWorkspaceRightPanelContent')
        expectSourceToContain(ts, 'mountContent: this.mountWorkspaceRightPanelContent,')
        expectExcerptToContain(content, 'createGeneratedOutputDetailsSidebar({', 'right sidebar')
        expectExcerptToContain(content, 'host.appendChild(this.activeGeneratedOutputDetailsPanel.element)', 'right sidebar')
        expectSourceNotToContain(ts, 'generatedMediaInfoPanelLayerEl')
    })
})

// =============================================================================
// Video node interaction (drag + resize parity with images)
// =============================================================================

describe('Workspace canvas — video node interaction', () => {
    const scss = loadScss()

    it('gives the video node + drag overlay the same box/pointer wiring as images', () => {
        // Without these the transparent drag overlay has no box, so pointer events
        // fall through to the canvas and a node drag becomes a canvas pan.
        // extractBlock matches the first occurrence of the selector; a nested
        // `.is-pending-generated-media-before-frame .video-drag-overlay` override
        // now precedes the top-level rule, so anchor to line start to get the base rule.
        const overlay = extractBlock(scss, '\n.video-drag-overlay')
        const imageOverlay = extractBlock(scss, '\n.image-drag-overlay')
        expectExcerptToContain(overlay, 'position: absolute', '.video-drag-overlay')
        expectExcerptToContain(overlay, 'z-index: 15', '.video-drag-overlay')
        expectExcerptToContain(overlay, 'top: 0', '.video-drag-overlay')
        expectExcerptToContain(overlay, 'left: 0', '.video-drag-overlay')
        expectExcerptToContain(overlay, 'right: 0', '.video-drag-overlay')
        expectExcerptToContain(overlay, 'bottom: 0', '.video-drag-overlay')
        expectExcerptToContain(overlay, 'background: transparent', '.video-drag-overlay')
        // Keep drag-hit parity with image drag overlays.
        expectExcerptToContain(imageOverlay, 'position: absolute', '.image-drag-overlay')
        expectExcerptToContain(imageOverlay, 'z-index: 15', '.image-drag-overlay')
        expectExcerptToContain(imageOverlay, 'top: 0', '.image-drag-overlay')
        expectExcerptToContain(imageOverlay, 'left: 0', '.image-drag-overlay')
        expectExcerptToContain(imageOverlay, 'right: 0', '.image-drag-overlay')
        expectExcerptToContain(imageOverlay, 'bottom: 0', '.image-drag-overlay')
        const nodeBlock = extractBlock(scss, '.workspace-video-node')
        expectExcerptToContain(nodeBlock, '&.is-dragging', '.workspace-video-node')
    })

    it('lets the visible video chrome and controls own hover while preserving pointer interaction', () => {
        const chrome = extractBlock(scss, '.workspace-video-chrome')
        const surface = extractBlock(scss, '.workspace-video-surface')
        const controlsHost = extractBlock(scss, '.workspace-video-controls-host')

        expectExcerptToContain(chrome, 'pointer-events: none', '.workspace-video-chrome')
        expectExcerptToContain(surface, 'pointer-events: auto', '.workspace-video-surface')
        expectExcerptToContain(controlsHost, 'pointer-events: none', '.workspace-video-controls-host')
        expectExcerptNotToContain(controlsHost, '&.is-visible', '.workspace-video-controls-host')
    })

    it('shows resize handles on video node hover/selection', () => {
        expectSourceToContain(scss, '.workspace-video-node:hover .workspace-handle')
        expectSourceToContain(scss, '.workspace-video-node.is-selected .workspace-handle')
    })
})

// =============================================================================
// Media descriptors
// =============================================================================

describe('Workspace canvas — media descriptors', () => {
    const ts = loadTs()
    const workspaceCanvasViewSource = loadWorkspaceCanvasView()
    const scss = loadScss()

    it('delegates generated-media descriptor requests to the package analysis owner', () => {
        expectSourceToContain(ts, 'this.mediaAnalysis = new WorkspaceMediaAnalysis({')
        expectSourceToContain(ts, 'describe: this.host.generation.describeMedia,')
        expectSourceToContain(ts, 'mediaAnalysis.queue(nodeId, stillAssetId)')
    })
    it('captions uploaded media from a still (never the MP4) with an analyzing → ready flow', () => {
        // Images and videos share one Asset-owned still resolver: the API always
        // exposes a still-image rendition (the video's representative frame for
        // video Assets), so there is no separate fileId/posterFileId branch anymore.
        expectSourceToContain(ts, 'this.queueCanvasMediaAnalysis(preparedNode.nodeId, this.getMediaDescriptorStillAssetId(preparedNode))')
        expectSourceToContain(ts, 'this.queueCanvasMediaAnalysis(node.nodeId, this.getMediaDescriptorStillAssetId(node))')
        expectSourceToContain(ts, 'private getMediaDescriptorStillAssetId = (node: ImageCanvasNode | VideoCanvasNode): string | undefined => {\n        return node.assetId || undefined\n    }')
        expectSourceToContain(ts, 'private queueCanvasMediaAnalysis = (nodeId: string, stillAssetId: string | undefined): void')
    })

    it('lets a Media Library insert carry its Asset-owned descriptor without a separate analysis pass', () => {
        // The descriptor lives on the shared Asset record now (assetsStore), not a
        // per-node copy that had to be captured and restored on re-insert. Inserting
        // an existing Asset onto the canvas does not re-trigger media analysis.
        const insertStart = ts.indexOf('onInsertAsset: async (item: AssetMeta) => {')
        const insertEnd = ts.indexOf('},', insertStart)
        expect(insertStart).toBeGreaterThan(-1)
        expect(insertEnd).toBeGreaterThan(insertStart)
        const insertHandler = ts.slice(insertStart, insertEnd)
        expectExcerptToContain(insertHandler, 'assetId: item.assetId,', 'media library insert handler')
        expectExcerptNotToContain(insertHandler, 'queueCanvasMediaAnalysis', 'media library insert handler')
    })

    it('shows an unobtrusive animated analyzing indicator with an explanation', () => {
        expectSourceToContain(loadOutputChrome(), "this.ports.getDescriptor(node)?.status === 'analyzing'")
        const buttonBlock = extractBlock(scss, '.canvas-node-footer-info-button.is-analyzing')
        expectExcerptToContain(buttonBlock, 'animation: workspace-media-analyzing-pulse', '.canvas-node-footer-info-button.is-analyzing')
        expectSourceToContain(scss, '@keyframes workspace-media-analyzing-pulse')
        const descriptorBlock = extractBlock(scss, '.canvas-media-descriptor')
        expectExcerptToContain(descriptorBlock, '&.is-analyzing', '.canvas-media-descriptor')
    })

    it('keeps uploaded exotic media inert until the canonical object is returned', () => {
        expectSourceToContain(workspaceCanvasViewSource, 'this.actions = new WorkspaceCanvasActions({')
        expectSourceToContain(workspaceCanvasViewSource, 'this.actions = new WorkspaceCanvasActions({')
        expectSourceToContain(workspaceCanvasViewSource, 'this.renderer?.replaceUploadPlaceholder(placeholderId, node, false)')
        expectSourceToContain(workspaceCanvasViewSource, 'this.renderer?.commitTransientCanvasNodeInsertion(state, nodeId, placeholderId)')
        expectSourceToContain(ts, "candidate.type === 'operationStatus' && candidate.operation === 'upload' && candidate.nodeId === placeholderNodeId")
        expectSourceToContain(ts, 'selection.remove(replacedPlaceholderNodeId)')
        expectSourceToContain(ts, 'appendCanvasNodeToDOM(insertedNode)')
        expectSourceToContain(ts, 'this.queueCanvasMediaAnalysis(preparedNode.nodeId, this.getMediaDescriptorStillAssetId(preparedNode))')
        expectSourceToContain(ts, 'if (this.observedAssetRevisions.get(assetId) !== revision) changedAssetIds.add(assetId)')
        expectSourceToContain(ts, 'canvasMediaLayer?.refreshAssets(changedAssetIds)')
        const insertionCommitStart = ts.indexOf('private commitTransientCanvasNodeInsertionToScene = (')
        const insertionCommitEnd = ts.indexOf('private commitCanvasMetadataState = (', insertionCommitStart)
        const insertionCommit = ts.slice(insertionCommitStart, insertionCommitEnd)
        expectExcerptNotToContain(insertionCommit, 'selectNode(', 'transient upload insertion commit')
        expectSourceNotToContain(workspaceCanvasViewSource, 'new Image()')
    })

    it('renders generic operation status and non-image upload node shells after reload', () => {
        expectSourceToContain(ts, "node.type === 'mediaDocument'")
        expectSourceToContain(ts, "node.type === 'audio'")
        expectSourceToContain(ts, "node.type === 'operationStatus'")
        expectSourceToContain(ts, 'private createOperationStatusNode = (node: OperationStatusCanvasNode): HTMLElement')
        expectSourceToContain(scss, '.workspace-upload-placeholder-node')
        const loadingSpinnerBlock = extractBlock(scss, '.workspace-upload-placeholder-loading-spinner')
        expectExcerptNotToContain(loadingSpinnerBlock, 'border:', '.workspace-upload-placeholder-loading-spinner')
        expectExcerptNotToContain(loadingSpinnerBlock, 'animation: spin', '.workspace-upload-placeholder-loading-spinner')
    })
})

// =============================================================================
// Content descriptors (documents & threads)
// =============================================================================

describe('Workspace canvas — content descriptors (documents & threads)', () => {
    const ts = loadTs()

    it('lets the API self-heal weak or missing text descriptors instead of analyzing text on the client', () => {
        // Text/document descriptor generation used to run client-side
        // (analyzeTextNode/patchTextNodeDescriptor/scheduleTextNodeDescriptor). It
        // now happens server-side: workspace-context resolution reports which
        // descriptors it improved, and the client just reloads those Assets.
        expectSourceNotToContain(ts, 'async function analyzeTextNode(')
        expectSourceNotToContain(ts, 'function patchTextNodeDescriptor(')
        expectSourceNotToContain(ts, 'function scheduleTextNodeDescriptor(')
        expectSourceToContain(ts, 'private patchWorkspaceContextImprovedDescriptors = (improvedDescriptors: Record<string, ContentDescriptor> | undefined): void')
        expectSourceToContain(ts, 'void this.mediaAnalysis.refreshWorkspaceDescriptors(improvedDescriptors)')
    })

    it('feeds improved descriptors from workspace-context resolution into the Asset reload path', () => {
        const resolutionStart = ts.indexOf('private handleWorkspaceContextResolution = (')
        const resolutionEnd = ts.indexOf('\n    }', resolutionStart)
        expect(resolutionStart).toBeGreaterThan(-1)
        expect(resolutionEnd).toBeGreaterThan(resolutionStart)
        const resolutionBody = ts.slice(resolutionStart, resolutionEnd)
        expectExcerptToContain(resolutionBody, 'patchWorkspaceContextImprovedDescriptors(resolution.improvedDescriptors)', 'handleWorkspaceContextResolution')
    })

    it('clears pending descriptor timers on destroy', () => {
        expectSourceToContain(ts, 'this.mediaAnalysis?.destroy()')
    })
})

// =============================================================================
// Parent-child world positioning
// =============================================================================

describe('Workspace canvas — parent-child world positioning', () => {
    const ts = loadTs()

    it('keeps existing branch-marker DOM geometry in lockstep with rebalanced pending media', () => {
        const geometry = extractFunctionBody(ts, 'syncCanvasNodeDomGeometry')
        expectExcerptToContain(geometry, 'this.getNodeWorldPosition(node, nodesById)')
        expectExcerptToContain(geometry, 'this.canvasMediaLayer?.setNodeLiveTransform(node.nodeId, position, dimensions)')
        expectSourceToContain(ts, 'mountDom: node => this.domNodes.mount(node)')
        expectSourceToContain(ts, 'updateBranch: this.syncBranchMarkerNodeContent,')
    })
})

// =============================================================================
// Workspace AI chat panel — stable reload path
// =============================================================================

describe('Workspace canvas — unified generated-output details reload stability', () => {
    const ts = loadTs()

    it('uses persisted generated-output details state as the only selected target', () => {
        expectSourceToContain(ts, 'generatedOutputDetailsTarget: target,')
        expectSourceToContain(ts, 'const target = this.aiChatPanelState.generatedOutputDetailsTarget')
        expectSourceToContain(ts, 'resolveGeneratedOutputDetailsNode(target)')
        expectSourceNotToContain(ts, 'let activeGeneratedOutputDetailsTarget')
        expectSourceNotToContain(ts, 'activeAiChatPanelThreadId')
        expectSourceNotToContain(ts, 'activeAiChatThreadId')
    })

    it('restores the unified component after canvas state hydration', () => {
        expectSourceToContain(ts, 'this.aiChatPanelState = getAiChatPanelState(this.currentCanvasState)')
        expectSourceToContain(ts, 'activeGeneratedOutputDetailsPanel = createGeneratedOutputDetailsSidebar({')
        expectSourceToContain(ts, 'renderContent: body => this.renderGeneratedOutputDetailsContent(body, node)')
        expectSourceToContain(ts, 'if (this.aiChatPanelState.isOpen && !this.rightPanel.element) this.renderActiveAiChatPanel()')
        expectSourceNotToContain(ts, 'refreshActiveAiChatPanelWhenContentLoads')
        expectSourceNotToContain(ts, 'threadEditors.set(')
    })

    it('keys canvas rerender detection on thread id plus loaded/pending content state', () => {
        const fnBody = extractFunctionBody(ts, 'getAiChatThreadsKey')
        expectExcerptToContain(fnBody, 'return threads')
        expectExcerptToContain(fnBody, '.filter(t => !this.isDetachedCanvasThreadId(t.threadId))')
        expectExcerptToContain(fnBody, ".map(t => `${t.threadId}:${t.content ? 'loaded' : 'pending'}`)")
        expectExcerptToContain(fnBody, ".join(',')")
    })

    it('preserves local visual drag commits when details renders arrive stale', () => {
        expectSourceToContain(ts, 'mergeIncomingCanvasStateWithPendingVisualCommit,')
        expectSourceToContain(ts, 'this.pendingLocalCanvasVisualCommit = null')
        expectSourceToContain(ts, 'pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(persistedCanvasState)')
        expectSourceToContain(ts, 'const renderStatePlan = mergeIncomingCanvasStateWithPendingVisualCommit({')
        expectSourceToContain(ts, 'currentCanvasState = shouldPreserveLiveViewport && effectiveCanvasState')
    })
})

// =============================================================================
// Workspace canvas — detached generation resume stability
// =============================================================================

describe('Workspace canvas — detached generation resume stability', () => {
    const ts = loadTs()

    it('reattaches hidden receive-only editors for active detached canvas runs after reload', () => {
        const getActiveThreadIdsBody = extractFunctionBody(ts, 'getActiveDetachedCanvasRunThreadIds')
        const reattachBody = extractFunctionBody(ts, 'reattachDetachedCanvasRunListenersForActiveMarkers')
        const createEditorBody = extractFunctionBody(ts, 'createDetachedCanvasThreadEditor')

        expectExcerptToContain(getActiveThreadIdsBody, 'if (this.currentCanvasState) {', 'detached run active thread lookup')
        expectExcerptToContain(getActiveThreadIdsBody, 'for (const node of this.currentCanvasState.nodes)', 'detached run active thread lookup')
        expectExcerptToContain(getActiveThreadIdsBody, 'for (const thread of this.currentAiChatThreads)', 'detached run active thread lookup')
        expectExcerptToContain(getActiveThreadIdsBody, 'thread.workspaceId !== this.workspaceId', 'detached run active thread lookup')
        expectExcerptToContain(getActiveThreadIdsBody, 'hasDetachedCanvasRunCanvasProjection(thread.threadId)', 'detached run active thread lookup')
        expectExcerptToContain(getActiveThreadIdsBody, 'isRecentDetachedCanvasThreadUpdate(thread)', 'detached run active thread lookup')
        expectExcerptToContain(getActiveThreadIdsBody, 'aiChatThreadHasRecoverableDetachedCanvasTurn(thread)', 'detached run active thread lookup')
        expectSourceNotToContain(ts, 'aiChatThreadHasSubmittedUserMessageWithoutResponse')
        const restoreIndex = reattachBody.indexOf('restoreDetachedCanvasPreflightMarkersForActiveThreads()')
        const loopIndex = reattachBody.indexOf('for (const threadId of this.getActiveDetachedCanvasRunThreadIds())')
        expect(restoreIndex).toBeGreaterThan(-1)
        expect(loopIndex).toBeGreaterThan(restoreIndex)
        expectExcerptToContain(reattachBody, 'for (const threadId of this.getActiveDetachedCanvasRunThreadIds())', 'detached run reattach')
        expectExcerptToContain(reattachBody, 'detachedAiChatThreadEditors.activate(threadId)', 'detached run reattach')
        expectExcerptToContain(reattachBody, 'createDetachedCanvasThreadEditor({ thread })', 'detached run reattach')
        expectExcerptToContain(createEditorBody, 'mountEditor: this.editors.createConversation({', 'detached canvas editor')
        expectExcerptToContain(createEditorBody, 'connect: this.host.generation.connect,', 'detached canvas editor')
        expectSourceToContain(ts, 'reattachDetachedCanvasRunListenersForActiveMarkers()')
    })

    it('creates detached canvas threads with the submitted user message already persisted', () => {
        const submitBody = extractFunctionBody(ts, 'submitCanvasGenerationRun')
        const submitPersistedBody = extractFunctionBody(ts, 'submitPersistedDetachedCanvasThreadMessage')
        const markerContentBody = extractFunctionBody(ts, 'createBranchMarkerContent')

        expectExcerptToContain(submitBody, 'await this.canvasGenerationSubmission.submit(data, options)', 'detached run submit')
        expectSourceToContain(ts, 'createDetachedCanvasThreadEditor({ ...request, thread })')
        expectSourceToContain(ts, 'submitPersistedDetachedCanvasThreadMessage(thread.threadId)')
        expectExcerptNotToContain(submitBody, 'promptInputController.submitMessage', 'detached run submit')
        expectExcerptToContain(submitPersistedBody, 'detachedAiChatThreadEditors.get(threadId)?.submitPersisted()', 'persisted detached submit')
        expectExcerptToContain(markerContentBody, 'getBranchMarkerPromptPartsForNode(node, threadPreview)', 'detached marker Capability badge order')
        expectExcerptToContain(markerContentBody, 'renderReference: createCanvasPromptReferenceRenderer({', 'detached marker reference renderer port')
        expectExcerptNotToContain(markerContentBody, '${promptReferenceBadges}', 'detached marker Capability badge order')
    })

    it('keeps exact submitted prompt atoms in the preflight marker and uses deterministic sizing', () => {
        const submitBody = extractFunctionBody(ts, 'createDetachedCanvasThreadEditor')
        const promptPartsBody = extractFunctionBody(ts, 'getBranchMarkerPromptPartsForNode')
        const persistedInsertBody = loadWorkspacePreflightMethod('insertPendingBranchMarkerForPersistedCanvasThread')

        expectExcerptToContain(submitBody, 'preflight: (placement, data, regeneration) => {', 'preflight prompt snapshot')
        expectExcerptToContain(submitBody, 'pendingGeneratedImagePlacements.set(threadId, placement)', 'preflight prompt snapshot')
        expectExcerptToContain(promptPartsBody, 'return this.referenceProjection.getBranchMarkerPromptPartsForNode(node, preview)', 'preflight prompt snapshot')
        expectExcerptNotToContain(promptPartsBody, 'if (node.pendingState)', 'preflight prompt snapshot')
        expectExcerptToContain(persistedInsertBody, 'estimateBranchMarkerDimensions(promptText)', 'preflight marker sizing')
        expectExcerptToContain(
            persistedInsertBody,
            'getRootBranchMarkerPositionBeforeGeneratedMedia(',
            'preflight marker canvas placement',
        )
        expectExcerptNotToContain(persistedInsertBody, 'getBranchMarkerScreenFixedDimensions', 'preflight marker sizing')
        expectSourceNotToContain(ts, 'applyPendingBranchMarkerScreenProjection')
    })

    it('restores preflight markers from persisted standalone canvas threads after early reload', () => {
        const restoreBody = loadWorkspacePreflightMethod('restoreDetachedCanvasPreflightMarkersForActiveThreads')
        const insertBody = loadWorkspacePreflightMethod('insertPendingBranchMarkerForPersistedCanvasThread')
        const activeTurnBody = extractFunctionBody(ts, 'aiChatThreadHasRecoverableDetachedCanvasTurn')

        expectExcerptToContain(activeTurnBody, 'aiChatThreadHasSubmittedUserMessage(thread)', 'recoverable detached turn')
        expectExcerptToContain(activeTurnBody, 'aiChatThreadHasInProgressContent(thread)', 'recoverable detached turn')
        expectExcerptToContain(restoreBody, 'for (const threadId of this.ports.activeThreadIds())', 'detached preflight restore')
        expectExcerptToContain(restoreBody, 'this.ports.readThread(threadId)', 'detached preflight restore')
        expectExcerptToContain(restoreBody, 'insertPendingBranchMarkerForPersistedCanvasThread(thread)', 'detached preflight restore')
        expectExcerptToContain(insertBody, 'const promptText = this.getLatestAiUserMessageText(thread)', 'persisted marker restore')
        expectExcerptToContain(insertBody, 'getDetachedThreadPendingModelStates(thread, promptText)', 'persisted marker restore')
        expectExcerptToContain(insertBody, 'const nodeId = `pending-branch-${threadId}-${index}`', 'persisted marker restore')
        expectExcerptToContain(
            insertBody,
            'const generationRequestId = this.ports.placements.placements.get(threadId)?.generationRequestId ?? threadId',
            'persisted marker restore',
        )
        expectExcerptToContain(insertBody, 'generationRequestId,', 'persisted marker restore')
        expectExcerptToContain(insertBody, 'this.ports.commit({', 'persisted marker restore')
        expectSourceToContain(ts, 'commit: this.commitTransientCanvasStatePreservingEditors,')
        expectExcerptToContain(insertBody, 'this.ports.append(pendingNode)', 'persisted marker restore')
        expectExcerptNotToContain(insertBody, 'syncPendingBranchMarkerScreenPlacements()', 'persisted marker restore')
    })

    it('recovers pending marker records and aliases in the package owner', () => {
        const placements = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/generation/workspace-generation-placements.ts')
        expectSourceToContain(placements, 'return this.recoverPendingBranchMarkerRecordFromCanvasState(threadId, generationRun)')
        expectSourceToContain(placements, 'this.setPendingBranchMarkerRecordAliases(threadId, generationRun, existing)')
        expectSourceToContain(loadWorkspaceMarkerHandoff(), 'this.ports.placements.ensurePendingBranchMarkerRecordForApiRun(threadId, generationRun)')
    })
    it('recreates preflight pending branch markers from replayed lineage plans after early reload', () => {
        const insertBody = loadWorkspacePreflightMethod('insertPendingBranchMarkersFromLineagePlan')
        const specBody = loadWorkspaceMarkerHandoff()
        const applyLineageBody = loadWorkspacePreflightMethod('applyMediaBranchLineagePlan', 'workspace-generation-settlement')
        const insertIndex = applyLineageBody.indexOf('insertPendingBranchMarkersFromLineagePlan(threadId, lineagePlan, generationRun)')
        const resolveIndex = applyLineageBody.indexOf('resolvePendingBranchMarkersForLineagePlan(threadId, lineagePlan, generationRun)')

        expectExcerptToContain(specBody, 'getUniqueLineageAssignmentsForMarkers(lineagePlan)', 'lineage preflight marker specs')
        expectExcerptToContain(specBody, 'buildGenerationRunFromLineageAssignment(lineagePlan, assignment, sourceGenerationRun)', 'lineage preflight marker specs')
        expectExcerptToContain(specBody, "phase: 'preflight'", 'lineage preflight marker specs')
        expectExcerptToContain(specBody, 'promptText: assignment.promptText || lineagePlan.promptText', 'lineage preflight marker specs')
        expectExcerptToContain(insertBody, 'const lineagePlacementKey = `${threadId}:${lineagePlan.generationRequestId}`', 'lineage preflight marker insert')
        expectExcerptToContain(insertBody, 'hasPendingBranchMarkerForPlacement(lineagePlacementKey)', 'lineage preflight marker insert')
        expectExcerptToContain(insertBody, 'hasCanvasBranchMarkerForPlacement(lineagePlacementKey)', 'lineage preflight marker insert')
        expectExcerptToContain(insertBody, 'generationRequestId: lineagePlan.generationRequestId', 'lineage preflight marker insert')
        expectExcerptToContain(insertBody, 'conversationAssetId: threadId', 'lineage preflight marker insert')
        expectExcerptToContain(insertBody, 'setPendingBranchMarkerRecordAliases(threadId, spec.generationRun, record)', 'lineage preflight marker insert')
        expectExcerptToContain(insertBody, 'this.ports.commit({', 'lineage preflight marker insert')
        expectExcerptToContain(applyLineageBody, '!hasCompletePlannedBranchMarkerGeometry(this.currentCanvasState.nodes, lineagePlan)', 'lineage marker geometry gate')
        expect(insertIndex).toBeGreaterThan(-1)
        expect(resolveIndex).toBeGreaterThan(insertIndex)
    })

    it('never rewrites API-planned branch marker geometry during lineage handoff', () => {
        const ensureOriginBody = loadWorkspaceLineageProjection()
        const ensureForkBody = loadWorkspaceLineageProjection()
        const ensureLineBody = loadWorkspaceLineageProjection()
        const resolveBody = extractFunctionBody(ts, 'resolvePendingBranchMarkerWithLineagePlan')
        const applyApiGeometryBody = loadWorkspacePreflightMethod('applyApiCanvasGeometry', '../scene/workspace-api-canvas-geometry')

        expectExcerptToContain(ensureOriginBody, "if (existing?.type === 'branchOrigin') {\n            return existing as BranchOriginCanvasNode", 'branch origin geometry ownership')
        expectExcerptToContain(ensureForkBody, "if (existing?.type === 'branchFork') {\n            return existing as BranchForkCanvasNode", 'branch fork geometry ownership')
        expectExcerptToContain(ensureLineBody, "if (existing?.type === 'branchLine' && existing.pendingState?.phase !== 'preflight') {\n            return existing as BranchLineCanvasNode", 'branch line geometry ownership')
        expectExcerptNotToContain(resolveBody, 'positionPendingBranchMarkerBeforeGeneratedMedia', 'pending marker promotion')
        expectExcerptToContain(applyApiGeometryBody, 'resolvePendingBranchMarkersAfterApiGeometry(canvasGeometry.generationRequestId)', 'API geometry lineage handoff')
        expectSourceNotToContain(ts, 'shouldReplaceApiFallbackFreshRootPosition')
    })

    it('keeps branch marker planning and pending-state clearing transient so they cannot overwrite API-owned media membership', () => {
        const settlement = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/generation/workspace-generation-settlement.ts')
        expectSourceToContain(settlement, 'this.ports.handoff.resolvePendingBranchMarkerWithLineagePlan(threadId, generationRun)')
        expectSourceToContain(settlement, 'this.ports.handoff.clearPendingBranchMarkerStateForRun(threadId, generationRun, options)')
        expectSourceToContain(ts, 'commit: this.commitTransientCanvasStatePreservingEditors,')
    })

    it('allows branch marker details once generated media has taken over stale pending state', () => {
        const phaseBody = extractFunctionBody(ts, 'getBranchMarkerUiPhase')
        const activeBody = extractFunctionBody(ts, 'isBranchMarkerGenerationActive')
        const pendingBody = extractFunctionBody(ts, 'isCurrentBranchMarkerPending')
        const clickBody = extractFunctionBody(ts, 'handleBranchMarkerInfoClick')
        const branchBody = extractFunctionBody(ts, 'createBranchMarkerNode')

        expectExcerptToContain(phaseBody, 'generationPlacements.getBranchMarkerUiPhase(node)', 'branch marker UI phase')
        expectExcerptToContain(activeBody, 'return this.branchActivity.isBranchMarkerGenerationActive(node)', 'branch marker active check')
        expectExcerptToContain(pendingBody, '&& !this.hasStartedGeneratedMediaForBranchMarkerNode(node.nodeId)', 'branch marker pending click guard')
        expectExcerptToContain(clickBody, "console.info('[CANVAS][branch-marker-info]', 'info-click'", 'branch marker info click')
        expectExcerptToContain(clickBody, 'wouldHaveBeenBlockedByPendingState', 'branch marker info click')
        expectExcerptToContain(clickBody, "openGeneratedOutputDetails({ kind: 'branch-marker', nodeId: node.nodeId }, { toggle: true })", 'branch marker info click')
        expectExcerptNotToContain(clickBody, 'if (blocked) return', 'branch marker info click')
        expectExcerptNotToContain(clickBody, 'if (wouldHaveBeenBlockedByPendingState) return', 'branch marker info click')
        expectExcerptToContain(branchBody, 'this.nodeShells.createBranchMarker(node, () => this.handleBranchMarkerInfoClick(node.nodeId))', 'branch marker node')
    })

    it('restores branch cancellation controls from persisted nonterminal output state after reload', () => {
        const activeBody = extractFunctionBody(ts, 'isBranchMarkerGenerationGroupActive')
        const stopBody = extractFunctionBody(ts, 'stopBranchMarkerGeneration')

        expectExcerptToContain(activeBody, 'return this.branchActivity.isBranchMarkerGenerationGroupActive(node)', 'branch group activity recovery')
        expectExcerptToContain(stopBody, 'conversationAssetId: threadId', 'reloaded branch cancellation')
        expectExcerptToContain(stopBody, 'generationRequestId: projectionGenerationRequestId', 'reloaded branch cancellation')
    })

    it('clears pending marker state and refreshes persisted thread content when a media run finishes', () => {
        const finishBody = loadWorkspacePreflightMethod('finishGeneratedMediaRun', 'workspace-generation-settlement')
        const clearIndex = finishBody.indexOf('clearPendingBranchMarkerStateForRun(threadId, generationRun)')
        const refreshIndex = finishBody.indexOf('this.ports.scheduleConversationRefresh(threadId)')
        const activeRunIndex = finishBody.indexOf('if (activeRunKeys.size > 0)')

        expect(clearIndex).toBeGreaterThan(-1)
        expect(refreshIndex).toBeGreaterThan(clearIndex)
        expect(activeRunIndex).toBeGreaterThan(refreshIndex)
        expectExcerptToContain(finishBody, 'if (generationRun.reasoningRunId) activeRunKeys.delete(generationRun.reasoningRunId)', 'finish generated media run')
        expectExcerptToContain(finishBody, 'if (generationRun.mediaRunId) activeRunKeys.delete(generationRun.mediaRunId)', 'finish generated media run')
        // The final settling run now schedules detached-canvas-run teardown so a
        // resumed background generation cleans up its hidden receive-only editor.
        expectExcerptToContain(finishBody, 'this.ports.settleConversation(threadId)', 'finish generated media run')
        expectExcerptToContain(finishBody, 'this.ports.scheduleTeardown(threadId)', 'finish generated media run')
    })

    it('delegates post-completion refresh to the scoped projection owner', () => {
        const scheduleBody = extractFunctionBody(ts, 'schedulePersistedAiChatThreadRefreshForBranchMarkers')
        expectExcerptToContain(scheduleBody, 'conversationProjection.schedule(threadId)', 'persisted conversation refresh')
        expectSourceToContain(ts, 'fetchThread: this.host.generation.fetchConversation,')
        expectSourceToContain(ts, 'this.conversationProjection?.destroy()')
        expectSourceToContain(ts, 'conversationProjection.clear()')
    })
})

// =============================================================================
// Workspace canvas — viewport ownership during store renders
// =============================================================================

describe('Workspace canvas — viewport ownership during store renders', () => {
    const ts = loadTs()
    const workspaceCanvasViewSource = loadWorkspaceCanvasView()

    it('routes same-workspace render decisions through the stale viewport planner', () => {
        expectSourceToContain(ts, 'shouldPreserveLiveViewportForScene({')
        expectSourceToContain(ts, 'incomingViewport: effectiveCanvasState?.viewport,')
        expectSourceToContain(ts, 'liveViewport,')
        expectSourceToContain(ts, 'workspaceChanged,')
    })

    it('keeps stale same-workspace renders from applying a transform jump', () => {
        expectSourceToContain(ts, 'const liveViewport = this.getLiveViewport()')
        expectSourceToContain(ts, 'currentCanvasState = shouldPreserveLiveViewport && effectiveCanvasState')
        expectSourceToContain(ts, 'panZoom?.syncViewport(liveViewport)')
        expectSourceNotToContain(ts, 'viewportBridge?.applyViewport(liveViewport)')
    })

    it('updates local canvas and pending commit viewports immediately during live pan or zoom', () => {
        expectSourceToContain(ts, 'private updateCurrentCanvasViewport = (viewport: Viewport): void')
        expectSourceToContain(ts, 'this.pendingLocalCanvasVisualCommit = updatePendingCanvasVisualCommitViewport(this.pendingLocalCanvasVisualCommit, viewport)')
        expectSourceToContain(ts, 'syncViewportInteractionState(vp)')
        expectSourceToContain(ts, 'updateCurrentCanvasViewport(vp)')
        expectSourceToContain(ts, 'viewportBridge?.applyViewport(vp)')
        expectSourceToContain(ts, 'onViewportChange?.(vp)')
    })

    it('persists every canvas-view save with the current live viewport', () => {
        expectSourceToContain(workspaceCanvasViewSource, 'const next = { ...state, viewport }')
        expectSourceToContain(workspaceCanvasViewSource, 'cloneViewport(state.viewport)')
        expectSourceToContain(workspaceCanvasViewSource, 'cloneViewport(this.renderer?.getViewport()) ?? this.viewport')
        expectSourceToContain(workspaceCanvasViewSource, 'this.ports.publishTransient(this.snapshot.workspaceId, next)')
        expectSourceToContain(workspaceCanvasViewSource, 'this.ports.session(this.snapshot.workspaceId).persistence.update(next)')
    })

    it('does not expose route workspace canvas state until the workspace load succeeds', () => {
        expectSourceToContain(workspaceCanvasViewSource, 'LoadingStatus')
        expectSourceToContain(workspaceCanvasViewSource, 'snapshot.workspaceId === snapshot.loadedWorkspaceId && snapshot.loadingStatus === LoadingStatus.success')
        expectSourceToContain(workspaceCanvasViewSource, '? snapshot.canvasState : null')
    })

    it('keeps workspace load feedback in the TypeScript canvas layer', () => {
        const loadingOutlineTs = loadWorkspaceLoadingOutline()

        expectSourceToContain(ts, 'workspaceLoadingOutline = createWorkspaceLoadingOutline({')
        expectSourceToContain(ts, 'this.workspaceLoadingOutline?.setErrorMessage(this.getWorkspaceLoadErrorMessage(error))')
        expectSourceToContain(loadingOutlineTs, 'export class LoadingOverlay')
        expectSourceToContain(loadingOutlineTs, 'setErrorMessage(message: string | null): void')
        expectSourceToContain(loadingOutlineTs, 'className="canvas-loading-error"')
        expectSourceNotToContain(workspaceCanvasViewSource, 'canvas-loading-error')
    })

    it('refuses to persist a debounced viewport after a newer viewport arrives', () => {
        expectSourceToContain(workspaceCanvasViewSource, 'this.viewportPersistence?.change(viewport)')
        expectSourceToContain(workspaceCanvasViewSource, 'this.viewportPersistence = new WorkspaceViewportPersistence(this.ports.session(workspaceId), {')
        expectSourceToContain(workspaceCanvasViewSource, 'this.lifetime.own(() => this.viewportPersistence?.destroy())')
    })

    it('does not own a fallback document-save debounce in the canvas view host', () => {
        // Document and conversation authority stays with the supplied editor adapter.
        expectSourceNotToContain(workspaceCanvasViewSource, 'onDocumentContentChange:')
        expectSourceNotToContain(workspaceCanvasViewSource, 'onAiChatThreadContentChange:')
        expectSourceNotToContain(workspaceCanvasViewSource, 'const documentSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()')
        expectSourceNotToContain(workspaceCanvasViewSource, 'const pendingDocumentUpdates = new Map<string, PendingDocumentUpdate>()')
        expectSourceNotToContain(workspaceCanvasViewSource, 'function scheduleDocumentUpdate(update: PendingDocumentUpdate): void')
    })
})

// =============================================================================
// Workspace AI chat panel — session history interactions
// =============================================================================

describe('Workspace right panel — single generated-output details renderer', () => {
    const ts = loadTs()
    const scss = loadScss()

    it('routes media info, active generation, and branch lineage through one opener', () => {
        const branchInfo = extractFunctionBody(ts, 'handleBranchMarkerInfoClick')
        expectExcerptToContain(ts, "onOpenDetails: nodeId => this.openGeneratedOutputDetails({ kind: 'output', nodeId }, { toggle: true })", 'generated output footer')
        expectExcerptToContain(branchInfo, "openGeneratedOutputDetails({ kind: 'branch-marker', nodeId: node.nodeId }, { toggle: true })", 'branch lineage')
    })

    it('mounts only the unified details component on the AI Threads surface', () => {
        const content = extractFunctionBody(ts, 'mountWorkspaceRightPanelContent')
        expectExcerptToContain(content, 'renderGeneratedOutputDetailsContent(body, node)', 'right panel content')
        expectExcerptToContain(content, 'workspace-generated-output-details-empty', 'right panel content')
        expectExcerptNotToContain(content, 'new ProseMirrorEditor', 'right panel content')
        expectExcerptToContain(extractFunctionBody(ts, 'renderActiveAiChatPanel'), 'rightPanel.render(options)', 'right panel mounting')
    })
    it('removes every session-list, chat-tab, and transcript renderer entry point', () => {
        expectSourceNotToContain(ts, 'createSlidingTabsSwitch')
        expectSourceNotToContain(ts, 'closeAiChatSidebarTab')
        expectSourceNotToContain(ts, 'deleteAiChatSession')
        expectSourceNotToContain(ts, 'ensureAiChatSidebarThreadTab')
        expectSourceNotToContain(ts, 'isSessionHistoryOpen')
        expectSourceNotToContain(ts, 'workspace-ai-chat-panel-session')
        expectSourceNotToContain(scss, '.workspace-ai-chat-panel-session')
        expectSourceNotToContain(scss, '.workspace-ai-chat-panel-tabs')
    })

    it('keeps the unified details body scrollable while nested content expands naturally', () => {
        const body = extractBlock(scss, '.workspace-generated-output-details-panel-body.workspace-generated-output-details-content')
        const nested = extractBlockContainingSelector(scss, '.workspace-generated-output-details-panel .ai-chat-thread-node-editor')
        expectExcerptToContain(body, 'overflow-x: hidden', 'details body')
        expectExcerptToContain(body, 'overflow-y: auto', 'details body')
        expectExcerptToContain(nested, 'max-height: none', 'details nested content')
        expectExcerptToContain(nested, 'overflow: visible', 'details nested content')
    })

    it('opens the capability library on the Tools surface', () => {
        expectSourceToContain(ts, "openRightSidePanelToMode('capabilities')")
        expectSourceToContain(ts, 'this.host.onOpenCapabilityLibrary?.(targetWorkspaceId => {')
        expectSourceToContain(readSourceFile('./workspace-canvas-host.ts'), "window.addEventListener('lixpi:open-capability-library', listener)")
    })
})

// =============================================================================
// AI chat thread — auto-grow CSS overrides
// =============================================================================

describe('AI chat thread — workspace CSS overrides for auto-grow', () => {
    const scss = loadScss()

    it('zeroes padding-bottom on .ai-chat-thread-wrapper inside workspace thread', () => {
        const block = extractBlock(scss, '.workspace-ai-chat-thread-node .ai-chat-thread-wrapper')
        expect(block).toMatch(/padding-bottom:\s*0/)
    })

    it('zeroes padding-bottom on .ai-chat-thread-content inside workspace thread', () => {
        const block = extractBlock(scss, '.workspace-ai-chat-thread-node .ai-chat-thread-wrapper .ai-chat-thread-content')
        expect(block).toMatch(/padding-bottom:\s*0/)
    })

    it('overrides ProseMirror min-height to 0 inside workspace thread', () => {
        // There are two rules with this selector — search the raw SCSS for
        // the min-height declaration scoped to the workspace thread.
        expect(scss).toMatch(/\.workspace-ai-chat-thread-node\s+\.ai-chat-thread-node-editor\s+\.ProseMirror\s*\{[^}]*min-height:\s*0/)
    })

    it('sets ProseMirror padding-bottom to 1rem inside workspace thread', () => {
        expect(scss).toMatch(/\.workspace-ai-chat-thread-node\s+\.ai-chat-thread-node-editor\s+\.ProseMirror\s*\{[^}]*padding:\s*0\s+0\s+1rem/)
    })
})

// =============================================================================
// AI chat thread — document title hidden (controlled by setting)
// =============================================================================

describe('Generated-output details — media title visibility', () => {
    const scss = loadScss()
    const ts = loadTs()

    it('renders the Asset metadata title without a hide-title modifier', () => {
        const appendMetadata = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/review/workspace-output-details.ts')
        expectExcerptToContain(appendMetadata, 'canvas-asset-metadata-editor is-details nopan', 'generated-output metadata')
        expectExcerptToContain(appendMetadata, "new WorkspaceAssetMetadataEditor(node.assetId, title, 'details', this.ports.assets)", 'generated-output metadata')
        expectSourceNotToContain(ts, 'workspace-ai-chat-thread-node-hide-title')
        expectSourceNotToContain(scss, '.workspace-ai-chat-thread-node-hide-title')
    })

    it('keeps sidebar metadata title at the full details size', () => {
        const titleBlock = extractBlock(scss, '.workspace-generated-output-details-content > .canvas-asset-metadata-editor.is-details')
        const contentBlock = extractBlock(scss, '.workspace-generated-output-details-content')
        expectExcerptToContain(titleBlock, 'margin-right: 3.5rem', 'details title container')
        expectExcerptToContain(contentBlock, '&.is-details', 'details metadata editor')
        expectExcerptToContain(contentBlock, 'h1.document-title', 'details metadata title')
        expectExcerptToContain(contentBlock, 'font-size: 1.55rem', 'details metadata title')
    })
})

// =============================================================================
// Resize handles - corner-hover visibility
// =============================================================================

describe('Resize handles - corner-hover visibility', () => {
    const scss = loadScss()
    const ts = loadTs()

    it('does not reveal all resize handles from node hover, selection, or resizing state', () => {
        const block = extractBlock(scss, '.workspace-document-node')

        expectExcerptNotToContain(block, '&:hover .document-resize-handle')
        expectExcerptNotToContain(block, '&.is-selected .document-resize-handle')
        expectExcerptNotToContain(block, '&.is-resizing .document-resize-handle')
    })

    it('keeps handles as invisible corner hitboxes that reveal only on direct hover or drag', () => {
        // extractBlock matches the first occurrence; a nested pending-media-hover
        // override of the same selector now precedes the top-level base rule.
        const block = extractBlock(scss, '\n.document-resize-handle')

        expect(block).toMatch(/opacity:\s*0/)
        expect(block).toMatch(/pointer-events:\s*auto/)
        expectExcerptToContain(block, '&:hover,')
        expectExcerptToContain(block, '&.is-dragging')
        expect(block).toMatch(/&:hover,[\s\S]*&\.is-dragging\s*\{[\s\S]*opacity:\s*1/)
    })

    it('does not reveal floating input resize handles from thread selection', () => {
        const block = extractBlock(scss, '.ai-prompt-input-thread-persistent')

        expectExcerptNotToContain(block, '&.is-selected .document-resize-handle')
        expectExcerptNotToContain(block, '&.thread-hovered .document-resize-handle')
    })
})

// =============================================================================
// Right side panel — TypeScript infrastructure
// =============================================================================

describe('Right side panel — TS infrastructure', () => {
    const ts = loadTs()

    it('supplies shared panel settings and persisted state through package ports', () => {
        expectSourceToContain(ts, 'this.rightPanel = new WorkspaceRightPanel({')
        expectSourceToContain(ts, 'settings: this.host.settings.rightSidePanel,')
        expectSourceToContain(ts, 'getState: () => this.aiChatPanelState,')
        expectSourceToContain(ts, 'this.aiChatPanelState = { ...this.aiChatPanelState, width }')
        expectSourceToContain(ts, 'rightPanel.syncState()')
        expectSourceNotToContain(ts, 'settings.aiChatThread.rightSidePanel')
        expectSourceNotToContain(ts, 'createSidePanel({')
    })
    it('updateSelectionDrivenUi never references a detached floating input under any node', () => {
        const fnMatch = ts.match(/private\s+updateSelectionDrivenUi\s*=\s*[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]
        // The deprecated detached prompt-input-below-node was removed entirely in
        // favor of the screen-fixed canvas composer; selection UI must not touch a
        // per-node floating input at all.
        expectExcerptNotToContain(fnBody, 'FloatingInput')
        expectExcerptNotToContain(fnBody, 'promptInputController.setTarget')
    })

    it('removes the extraction-only image bubble menu callback', () => {
        expectSourceNotToContain(ts, `on${'AskAi'}`)
    })

    it('bubble menu callbacks include onTriggerConnection', () => {
        expectSourceToContain(ts, 'onTriggerConnection')
    })

    it('anchors the canvas image bubble menu to the image node box', () => {
        expectSourceToContain(ts, 'canvasBubbleMenu?.showNode(nodeId)')
        expectSourceToContain(ts, 'this.canvasBubbleMenu?.repositionNode(this.getSingleSelectedNodeId())')
        expectSourceToContain(ts, 'viewport: this.viewportEl,')
    })

    it('onTriggerConnection triggers connection via startConnectionFromMenu', () => {
        expect(ts).toMatch(/onTriggerConnection.*startConnectionFromMenu|startConnectionFromMenu.*onTriggerConnection/s)
    })

    it('keeps one panel owner per canvas alongside the global composer', () => {
        expect([...ts.matchAll(/new WorkspaceRightPanel\(/g)]).toHaveLength(1)
        expectSourceToContain(ts, 'private createGlobalCanvasComposer = (): void')
        expectExcerptToContain(extractFunctionBody(ts, 'mountWorkspaceRightPanelContent'), 'lifetime.own(this.destroyActiveAiChatPanelProjection)', 'details cleanup')
    })
    it('keeps AI prompt input style values in the shared composer component', () => {
        const composer = loadAiPromptComposer()
        expectSourceToContain(composer, "this.element.style.setProperty('--dropdown-popover-box-shadow', config.appearance.popoverBoxShadow)")
        expectSourceNotToContain(composer, 'open-prompt-z-index')
    })

    it('raises the global composer above its action panels only while a reference picker is visible', () => {
        const scss = loadScss()
        const actionPanel = extractBlock(scss, '.workspace-canvas-action-panel')
        const composerScss = loadWorkspaceComposerStyles()
        const composerHost = extractBlock(composerScss, '.workspace-canvas-global-composer-host')
        const composerHostWithPicker = extractBlock(
            composerScss,
            '.workspace-canvas-global-composer-host:has(.prompt-reference-picker-visible)',
        )

        expectExcerptToContain(actionPanel, 'z-index: 9991;', '.workspace-canvas-action-panel')
        expectExcerptToContain(composerHost, 'z-index: 9990;', '.workspace-canvas-global-composer-host')
        expectExcerptToContain(composerHostWithPicker, 'z-index: 9992;', 'visible picker composer host')
        expectSourceNotToContain(ts, "zIndex: '9990',")
    })

    it('places the media library on the left and the icon switch plus model control on the composer’s right', () => {
        const ts = loadTs()
        const scss = loadScss()
        const workspaceCanvasViewSource = loadWorkspaceCanvasView()
        const canvasMediaLayer = loadPixiMediaLayer()
        const leftRailItems = extractBlockContainingSelector(
            scss,
            '.workspace-canvas-left-control-rail .workspace-canvas-media-library-panel',
        )
        const rightRail = extractBlock(scss, '.workspace-canvas-right-control-rail')
        const modelMenuHoverBackground = extractBlock(scss, '.workspace-canvas-model-menu-hover-background')
        const modelMenuPanel = extractBlock(scss, '.workspace-canvas-model-menu-panel')
        const modelMenuTrigger = extractBlock(
            scss,
            '.workspace-canvas-model-menu-panel > .ai-prompt-model-menu-trigger',
        )
        const modelMenuHoverBackgroundActive = extractBlockContainingSelector(
            scss,
            '.workspace-canvas-right-control-rail:has(> .workspace-canvas-model-menu-panel > .ai-prompt-model-menu-trigger:hover) > .workspace-canvas-model-menu-hover-background',
        )
        const rightRailStart = workspaceCanvasViewSource.indexOf(
            '<div className="workspace-canvas-action-panel workspace-canvas-right-control-rail">',
        )
        const rightRailEnd = workspaceCanvasViewSource.indexOf('controls.style.setProperty', rightRailStart)
        const rightRailMarkup = workspaceCanvasViewSource.slice(rightRailStart, rightRailEnd)
        const screenGlassTargets = workspaceCanvasViewSource

        expectSourceToContain(
            workspaceCanvasViewSource,
            'workspace-canvas-action-panel workspace-canvas-media-library-panel workspace-canvas-action-panel-single',
        )
        expectSourceToContain(workspaceCanvasViewSource, 'workspace-canvas-right-control-rail')
        expectSourceToContain(workspaceCanvasViewSource, 'className="workspace-canvas-model-menu-hover-background"')
        expectSourceToContain(workspaceCanvasViewSource, 'className="workspace-canvas-media-mode-panel"')
        expectSourceToContain(workspaceCanvasViewSource, 'className="workspace-canvas-model-menu-panel"')
        expectSourceNotToContain(workspaceCanvasViewSource, 'workspace-canvas-action-panel workspace-canvas-model-menu-panel')
        expectSourceNotToContain(workspaceCanvasViewSource, 'workspace-canvas-action-panel-right')
        expectSourceNotToContain(workspaceCanvasViewSource, 'workspace-canvas-media-mode-panel-right')
        expect(rightRailStart).toBeGreaterThan(-1)
        expect(rightRailEnd).toBeGreaterThan(rightRailStart)
        expect(rightRailMarkup.indexOf('${this.mediaModeSwitchMount}')).toBeLessThan(
            rightRailMarkup.indexOf('${this.modelMenuControlMount}'),
        )

        expectSourceToContain(
            scss,
            '.workspace-canvas-left-control-rail .workspace-canvas-media-library-panel',
        )
        expectExcerptToContain(leftRailItems, 'right: auto;', 'left control rail')
        expectExcerptToContain(rightRail, 'left: calc(', 'right control rail')
        expectExcerptToContain(rightRail, 'display: flex;', 'right control rail')
        expectExcerptToContain(rightRail, 'gap: 2px;', 'right control rail')
        expectExcerptToContain(rightRail, 'border-radius: 9999px;', 'right control rail')
        expectExcerptToContain(modelMenuHoverBackground, 'position: absolute;', 'model menu hover background')
        expectExcerptToContain(modelMenuHoverBackground, 'inset: 0;', 'model menu hover background')
        expectExcerptToContain(modelMenuHoverBackground, 'pointer-events: none;', 'model menu hover background')
        expectExcerptToContain(modelMenuHoverBackgroundActive, 'background: var(--ai-prompt-model-menu-trigger-active-background, #eef0f4);', 'model menu hover state')
        expectSourceToContain(scss, '--workspace-canvas-media-mode-panel-width: 76px;')
        expectExcerptToContain(modelMenuPanel, 'padding: 0;', 'model menu panel')
        expectExcerptToContain(modelMenuTrigger, 'width: 100%;', 'model menu trigger')
        expectExcerptToContain(modelMenuTrigger, 'height: 100%;', 'model menu trigger')
        expectExcerptToContain(modelMenuTrigger, 'border-radius: inherit;', 'model menu trigger')
        expectExcerptToContain(modelMenuTrigger, 'background: transparent;', 'model menu trigger')
        expectSourceToContain(
            scss,
            '.workspace-canvas-model-menu-panel > .ai-prompt-model-menu-trigger:hover,\n.workspace-canvas-model-menu-panel > .ai-prompt-model-menu-trigger.is-active {\n    background: transparent;\n}',
        )
        expectSourceNotToContain(scss, '.workspace-floating-toolbar-tooltip')
        expectSourceToContain(screenGlassTargets, "id: 'workspace-right-control-rail'")
        expectSourceNotToContain(screenGlassTargets, "id: 'workspace-media-mode-panel'")
        expectSourceNotToContain(screenGlassTargets, "id: 'workspace-model-menu-panel'")

        expectSourceToContain(ts, 'modelMenuControlMountEl: HTMLDivElement')
        expectSourceToContain(
            ts,
            'mountMediaModeSwitch: switchElement => this.options.mediaModeSwitchMountEl.replaceChildren(switchElement),',
        )
        expectSourceToContain(
            ts,
            'mountModelMenuControl: controlElement => this.options.modelMenuControlMountEl.replaceChildren(controlElement),',
        )
        expectSourceToContain(screenGlassTargets, "id: 'workspace-media-library-panel'")
        expectSourceNotToContain(screenGlassTargets, "id: 'workspace-action-panel-right'")
    })

    it('opens the panel without requiring an existing thread and creates standalone history on submit', () => {
        expectSourceToContain(ts, 'private openAiChatPanel = (): void')
        expectSourceToContain(ts, 'this.aiChatPanelState = { ...this.aiChatPanelState, isOpen: true }')
        expectSourceToContain(ts, 'private submitCanvasGenerationRun = async (\n        data: AiPromptComposerSubmitData,')
        // Standalone thread ownership is now server-determined (Asset model); the
        // client only reads it back, it never constructs a local thread record.
        expectSourceToContain(ts, 'if (thread.workspaceId !== this.workspaceId) continue')
        const openAiChatPanelMatch = ts.match(/private openAiChatPanel = \(\): void => \{[\s\S]*?^    \}/m)
        expect(openAiChatPanelMatch).not.toBeNull()
        expectExcerptNotToContain(openAiChatPanelMatch![0], 'addContextChips')
        expectSourceNotToContain(ts, 'workspace-ai-chat-panel-title')
        expectSourceNotToContain(ts, 'workspace-ai-chat-panel-close')
    })

    it('renders a removable context chip tray and sends chip context for standalone canvas runs', () => {
        const scss = loadScss()
        const detachedEditor = extractFunctionBody(ts, 'createDetachedCanvasThreadEditor')
        expectSourceToContain(ts, 'new WorkspaceContextTrays({')
        expectSourceToContain(ts, 'private refreshContextChipTray = (): void')
        expectSourceToContain(ts, 'private removeContextChip = (nodeId: string): void')
        expectSourceToContain(ts, 'private clearExplicitContextChips = (): void')
        expectSourceToContain(ts, 'contextNodeIds: this.aiChatPanelState.contextChips,')
        expectExcerptToContain(detachedEditor, 'clearContext: this.clearExplicitContextChips,', 'submitted context tray port')
        expectSourceToContain(scss, '--workspace-right-side-panel-content-inset')
        expectSourceNotToContain(ts, 'aiChatPanelToggleHistoryIcon')
        expectSourceNotToContain(ts, 'createSlidingTabsSwitch')
        expectSourceNotToContain(ts, 'isSessionHistoryOpen')
    })

    it('renders removable explicit context chips and patches improved descriptors', () => {
        const scss = loadScss()

        expectSourceToContain(ts, 'private clearExplicitContextChips = (): void')
        expectSourceToContain(ts, 'contextTrays.refresh()')
        expectSourceToContain(ts, 'this.contextTrays?.destroy()')
        expectSourceToContain(ts, 'private patchWorkspaceContextImprovedDescriptors = (improvedDescriptors: Record<string, ContentDescriptor> | undefined): void')
        expectSourceToContain(ts, 'private handleWorkspaceContextResolution = (threadId: string | undefined, resolution: WorkspaceContextResolution, generationRun?: MediaGenerationRunMeta): void')
        expectSourceToContain(ts, 'patchWorkspaceContextImprovedDescriptors(resolution.improvedDescriptors)')
        expectSourceToContain(ts, 'updatePendingGeneratedImageReferencesFromWorkspaceContext(threadId, resolution, generationRun)')
        expectSourceToContain(ts, 'placementAnchorNodeId: placement.placementAnchorNodeId ?? referenceNodeIds[0]')
        expectSourceToContain(ts, 'this.setGeneratingReferenceNodeIds(this.getGeneratedMediaPlacementKey(threadId, generationRun), referenceNodeIds)')
        expectSourceToContain(ts, 'onWorkspaceContextResolvedToCanvas: ({ workspaceId: eventWorkspaceId, threadId, resolution, generationRun }) =>')
        expectSourceToContain(loadWorkspaceComposerStyles(), '.workspace-ai-chat-panel-context-chip-explicit')
        expectSourceNotToContain(loadWorkspaceComposerStyles(), '.workspace-ai-chat-panel-context-chip-auto')
    })

    it('applies context-preview styling helper variables to the panel shell', () => {
        expectSourceToContain(ts, 'cssProperties: this.getWorkspaceRightPanelCssProperties(),')
        expectSourceToContain(ts, 'settings.aiChatThread.contextPreview.styles')
        expectSourceToContain(ts, 'workspace-ai-chat-panel-context-controls')
        expectSourceToContain(ts, 'context-preview-tooltip')
        expectSourceToContain(ts, 'context-preview-trigger')
        expectSourceToContain(ts, '--workspace-ai-chat-panel-context-chip-remove-box-shadow')
    })

    it('passes panel context-preview CSS variables through to detached tooltip content', () => {
        const contextPreview = loadContextPreview()
        expectSourceToContain(contextPreview, 'export const CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES = [')
        expectSourceToContain(contextPreview, 'contentCssVariableNames: CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES,')
        expectSourceToContain(contextPreview, "'--context-preview-popover-text-color'")
        expectSourceToContain(ts, 'getEnvironment: this.getContextPreviewEnvironment,')
    })

    it('prepares detached canvas generations through the conversation run owner', () => {
        const run = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/canvas-conversation-run.ts')
        expectSourceToContain(run, 'this.ports.preflight(')
        expectSourceToContain(run, '...(placementAnchorNodeId ? { placementAnchorNodeId } : {}),')
        expectSourceToContain(run, 'mediaBranchCandidateSnapshot,')
        expectSourceToContain(ts, 'this.pendingGeneratedImagePlacements.set(threadId, placement)')
        expectSourceToContain(ts, 'this.setGeneratingReferenceNodeIds(threadId, placement.referenceNodeIds)')
        expectSourceToContain(loadGenerationHandlers(), 'const placement = this.ports.placements.getPendingGeneratedMediaPlacement(threadId, generationRun)')
        expectSourceToContain(loadGenerationHandlers(), 'this.ports.trackers.images.set(runKey, {')
    })

    it('returns live viewport-aware canvas state from the canvas API', () => {
        expectSourceToContain(ts, 'return this.currentCanvasState')
        expectSourceToContain(ts, 'viewport: this.getLiveViewport()')
        expectSourceToContain(ts, 'return null')
        expectSourceToContain(ts, 'getViewport = () => {')
        expectSourceToContain(ts, 'return this.getLiveViewport()')
    })

    it('maps media generation request completion callbacks back into generation-settling', () => {
        expectSourceToContain(ts, 'onMediaGenerationRequestCompleteToCanvas: ({ workspaceId: eventWorkspaceId, threadId, generationRequestId, generationRun }) => {')
        expectSourceToContain(ts, 'if (!this.shouldAcceptGeneratedMediaEvent(threadId)) return')
        expectSourceToContain(ts, 'settleMediaGenerationRequest(threadId, generationRequestId, generationRun)')
    })

    it('routes workspace context relevance events around markdown parsing', () => {
        const aiInteractionService = loadAiInteractionService()
        const aiChatThreadPlugin = loadAiChatThreadPlugin()
        const aiGeneratedImageNode = loadAiGeneratedImageNode()

        expectSourceToContain(aiInteractionService, 'content.status === STREAM_STATUS.CONTEXT_RELEVANCE_RESOLVED')
        expectSourceToContain(aiInteractionService, "type: 'context_relevance_resolved'")
        expectSourceToContain(aiInteractionService, 'workspaceContextResolution')
        expectSourceToContain(aiInteractionService, 'content.status === STREAM_STATUS.CONTEXT_RELEVANCE_ERROR')
        expectSourceToContain(aiInteractionService, "type: 'context_relevance_error'")
        expectSourceToContain(aiInteractionService, 'content.status === STREAM_STATUS.IMAGE_ERROR')
        expectSourceToContain(aiInteractionService, "type: 'image_error'")
        expectSourceToContain(aiChatThreadPlugin, "type WorkspaceContextSegmentType = 'context_relevance_resolved' | 'context_relevance_error'")
        expectSourceToContain(aiChatThreadPlugin, "if (type === 'image_error')")
        expectSourceToContain(aiChatThreadPlugin, 'this.handleImageError(view, event)')
        expectSourceToContain(aiChatThreadPlugin, "if (type === 'context_relevance_resolved')")
        // Canvas placement dispatch is centralized in the shared router, used by
        // both the chat plugin and the thread-less canvas composer.
        expectSourceToContain(aiChatThreadPlugin, 'this.onStreamEvent?.(event)')
        const canvasRouter = loadAiGeneratedMediaCanvasRouter()
        expectSourceToContain(canvasRouter, 'onWorkspaceContextResolvedToCanvas?.({')
        expectSourceToContain(canvasRouter, 'onWorkspaceContextResolvedToCanvas?: (data: {')
        expectSourceToContain(canvasRouter, 'onImageErrorToCanvas?: (data: {')
        expectSourceToContain(canvasRouter, 'resolution: WorkspaceContextResolution')
    })

    it('uses UI-kit controls for the package panel and injects the canvas pan lock', () => {
        const panel = loadRightPanel()
        expectSourceToContain(panel, "from '@lixpi/ui-kit/components/side-panel'")
        expectSourceToContain(panel, "from '@lixpi/ui-kit/components/sliding-switch'")
        expectSourceToContain(ts, 'acquirePanLock: () => this.panZoom?.lock() ?? (() => {}),')
    })
    it('sets closed state before awaiting the package panel close animation', () => {
        const close = extractFunctionBody(ts, 'closeAiChatPanel')
        expectExcerptToContain(close, 'this.aiChatPanelState = { ...this.aiChatPanelState, isOpen: false }', 'panel close')
        expectExcerptToContain(close, 'const closing = this.rightPanel.close()', 'panel close')
        expect(close.indexOf('rightPanel.close()')).toBeLessThan(close.indexOf('persistAiChatSidebarState()'))
        expectExcerptToContain(close, 'await closing', 'panel close')
    })
    it('uses content-agnostic right side panel sizing for right-edge surfaces', () => {
        const scss = loadScss()
        const workspaceCanvasViewSource = loadWorkspaceCanvasView()
        const layout = loadLayout()
        const navigationSidePanel = loadNavigationSidePanel()
        const navigationSidePanelScss = loadNavigationSidePanelScss()

        const sidePanelScss = loadSidePanelScss()
        expectSourceToContain(workspaceCanvasViewSource, 'panel: settings.rightSidePanel,')
        expectSourceToContain(workspaceCanvasViewSource, '--workspace-right-side-panel-width')
        expectSourceToContain(workspaceCanvasViewSource, "'--side-panel-backdrop-width': 'var(--workspace-right-side-panel-width)'")
        expectSourceToContain(workspaceCanvasViewSource, "'--workspace-right-sidebar-content-font-size': `${panel.typography.contentFontSize}px`")
        expectSourceToContain(workspaceCanvasViewSource, 'workspace-canvas-right-side-panel-open')
        // The glass backdrop is owned by the SidePanel component.
        expectSourceToContain(sidePanelScss, '.side-panel-backdrop')
        expectSourceToContain(sidePanelScss, 'z-index: var(--side-panel-backdrop-z-index, 90)')
        expectSourceToContain(sidePanelScss, '--side-panel-backdrop-width')
        expectSourceToContain(sidePanelScss, 'backdrop-filter: blur(24px) saturate(145%)')
        expectSourceToContain(sidePanelScss, '-webkit-backdrop-filter: blur(24px) saturate(145%)')
        expectSourceToContain(sidePanelScss, '@media (prefers-reduced-transparency: reduce)')
        expectSourceToContain(workspaceCanvasViewSource, 'workspace-canvas-media-library-panel workspace-canvas-action-panel-single')
        expectSourceNotToContain(workspaceCanvasViewSource, 'workspace-canvas-action-panel-right')
        expectSourceToContain(workspaceCanvasViewSource, 'mediaFoloderIcon')
        expectSourceToContain(workspaceCanvasViewSource, 'workspace-zoom-indicator')
        expectSourceNotToContain(workspaceCanvasViewSource, 'workspace-canvas-utility-capsule')
        expectSourceToContain(scss, '.workspace-canvas-right-side-panel-open .workspace-zoom-indicator')
        expectSourceToContain(scss, 'right: calc(var(--workspace-right-side-panel-width) + 5px)')
        expectSourceToContain(scss, 'right: calc(0px - var(--workspace-canvas-padding-inline))')
        expectSourceToContain(scss, 'bottom: calc(0px - var(--workspace-canvas-padding-bottom))')
        expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel'), 'top: 0px', 'outer chat panel')
        expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel'), 'border-radius: 10px', 'outer chat panel')
        expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel'), 'background: transparent', 'outer chat panel')
        expectSourceToContain(loadWorkspaceComposerStyles(), '.ai-prompt-input-floating.workspace-canvas-global-composer')
        expectExcerptToContain(
            extractBlock(loadWorkspaceComposerStyles(), '.ai-prompt-input-floating.workspace-canvas-global-composer'),
            'width: 100%',
            'global composer',
        )
        expectSourceToContain(layout, 'navigation-side-panel-pane')
        expectSourceToContain(layout, 'createNavigationSidePanel')
        expectSourceNotToContain(layout, 'Resizable.PaneGroup')
        expectSourceNotToContain(layout, 'user-menu-workspace-chat-panel')
        expectSourceToContain(navigationSidePanel, "side: 'left'")
        expectSourceToContain(navigationSidePanel, 'createSidePanel')
        expectSourceToContain(navigationSidePanelScss, '.navigation-side-panel {')
        expectSourceToContain(navigationSidePanelScss, 'position: fixed')
    })

    it('lifts the canvas-hosted side-panel overlay/backdrop above canvas content via workspace-canvas-scoped z-index variables', () => {
        const scss = loadScss()
        const sidePanelScss = loadSidePanelScss()

        expectExcerptToContain(
            extractBlock(scss, '.workspace-canvas'),
            '--side-panel-resize-handle-z-index: 9990',
            '.workspace-canvas',
        )
        expectExcerptToContain(
            extractBlock(scss, '.workspace-canvas'),
            '--side-panel-overlay-z-index: 10010',
            '.workspace-canvas',
        )
        expectExcerptToContain(
            extractBlock(scss, '.workspace-canvas'),
            '--side-panel-backdrop-z-index: 10020',
            '.workspace-canvas',
        )
        expectExcerptToContain(
            extractBlock(scss, '.workspace-canvas'),
            '--side-panel-surface-z-index: 10030',
            '.workspace-canvas',
        )
        expectExcerptToContain(
            extractBlock(scss, '.workspace-canvas'),
            '--side-panel-toggle-z-index: 10040',
            '.workspace-canvas',
        )

        // The component now reads its own z-index custom properties (with the
        // component's low-stacking defaults) instead of the host overriding
        // .side-panel-overlay-right/.side-panel-backdrop-right by selector.
        expectSourceNotToContain(scss, '.side-panel-overlay-right')
        expectSourceNotToContain(scss, '.side-panel-backdrop-right')
        expectSourceToContain(sidePanelScss, 'z-index: var(--side-panel-overlay-z-index, 80)')
        expectSourceToContain(sidePanelScss, 'z-index: var(--side-panel-toggle-z-index, 10040)')
        expectSourceToContain(sidePanelScss, 'z-index: var(--side-panel-resize-handle-z-index, 9990)')
    })
})

// =============================================================================
// Multi-selection and group drag
// =============================================================================

describe('Workspace canvas — multi-selection and group drag', () => {
    const ts = loadTs()
    const scss = loadScss()

    // -------------------------------------------------------------------------
    // Selection state model
    // -------------------------------------------------------------------------

    it('stores selected nodes in a Set instead of a single selectedNodeId', () => {
        expectSourceToContain(ts, 'this.selection = this.canvasRuntime.selection')
        expectSourceToContain(ts, 'private setSelectedNodes = (')
        expectSourceToContain(ts, 'private toggleNodeSelection = (')
    })

    it('single-target UI is derived from getSingleSelectedNodeId', () => {
        expectSourceToContain(ts, 'private getSingleSelectedNodeId = (): string | null')
        expectSourceToContain(ts, 'const singleSelectedNodeId = this.getSingleSelectedNodeId()')
        expectSourceToContain(ts, 'hideCanvasBubbleMenu()')
    })

    // -------------------------------------------------------------------------
    // Click interaction rules
    // -------------------------------------------------------------------------

    it('marquee selection stores intersected node ids directly', () => {
        const fnMatch = ts.match(/private\s+getSelectableNodeIdsInRect\s*=\s*[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]

        expectExcerptToContain(fnBody, 'getIntersectingNodeIds(this.currentCanvasState?.nodes ?? [], rect, this.getSelectionBoundsForNode)')
        expectExcerptNotToContain(fnBody, 'getSelectionTargetNodeId')
    })

    it('includes branch lineage markers in marquee selection while preserving their click-to-inspect behavior', () => {
        const intersection = extractFunctionBody(ts, 'getSelectableNodeIdsInRect')
        const filter = extractFunctionBody(ts, 'filterSelectableNodeIds')

        expectExcerptToContain(intersection, 'getIntersectingNodeIds(this.currentCanvasState?.nodes ?? [], rect, this.getSelectionBoundsForNode)', 'getSelectableNodeIdsInRect')
        expectExcerptNotToContain(intersection, "node.type !== 'branchOrigin'", 'getSelectableNodeIdsInRect')
        expectExcerptToContain(filter, 'currentCanvasState.nodes.map((node: CanvasNode) => node.nodeId)', 'filterSelectableNodeIds')
        expectExcerptNotToContain(filter, '.filter(isSelectableCanvasNode)', 'filterSelectableNodeIds')
    })

    it('supports Mod-click selection toggling on both node click and drag overlay mousedown', () => {
        expectSourceToContain(ts, 'private isModSelectionEvent = (event: MouseEvent): boolean')
        expectSourceToContain(ts, 'return event.metaKey || event.ctrlKey')
        expectSourceToContain(ts, 'toggleSelection: this.toggleNodeSelection,')
        expectSourceToContain(ts, 'this.ports.toggleSelection(resolvedNodeId)')
    })

    // -------------------------------------------------------------------------
    // Selection overlay rules
    // -------------------------------------------------------------------------

    it('tracks selection source to control overlay visibility', () => {
        // selection.fromMarquee controls whether a single-node selection shows
        // the overlay. Plain clicks on any node type do
        // not draw a selection rectangle. Marquee selection does.
        expectSourceToContain(ts, 'this.selection = this.canvasRuntime.selection')
        expectSourceToContain(ts, 'return this.selection.fromMarquee')

        // setSelectedNodes accepts a fromMarquee parameter
        expectSourceToContain(ts, 'private setSelectedNodes = (nextSelectedNodeIds: Set<string>, fromMarquee = false): void')
        expectSourceToContain(ts, 'this.selection.replace(this.filterSelectableNodeIds(nextSelectedNodeIds), fromMarquee)')
    })

    it('shouldShowSelectionGroupOverlay returns true for multi-select or marquee, false for plain click', () => {
        const fnMatch = ts.match(/private\s+shouldShowSelectionGroupOverlay\s*=\s*[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]

        // Empty selection = no overlay
        expectExcerptToContain(fnBody, 'selection.nodeIds.size === 0) return false')

        // 2+ nodes = always overlay (regardless of source)
        expectExcerptToContain(fnBody, 'if (this.selection.nodeIds.size > 1) return true')

        // Single node = overlay only if selected via marquee
        expectExcerptToContain(fnBody, 'return this.selection.fromMarquee')
        expectExcerptNotToContain(fnBody, 'const selectedNodeId = getSingleSelectedNodeId()')
        expectExcerptNotToContain(fnBody, 'const selectedNode = currentCanvasState.nodes.find')

        // Must NOT contain any node-type special casing (e.g. aiChatThread)
        expectExcerptNotToContain(fnBody, "'aiChatThread'")
        expectExcerptNotToContain(fnBody, 'node.type')
    })

    it('marquee handler passes fromMarquee=true so even a single marquee node gets the overlay', () => {
        const fnBody = extractMarqueeConfiguration(ts)

        expectExcerptToContain(fnBody, 'setSelectedNodes(new Set(selectedIds), true)')
    })

    it('selectNode (plain click) does NOT pass fromMarquee so single-click never shows overlay', () => {
        const fnMatch = ts.match(/private\s+selectNode\s*=\s*[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]

        // selectNode calls setSelectedNodes with default fromMarquee=false
        expectExcerptToContain(fnBody, 'setSelectedNodes(nodeId ? new Set([nodeId]) : new Set())')
        expectExcerptNotToContain(fnBody, 'true)')
    })

    it('toggleNodeSelection does NOT pass fromMarquee', () => {
        const fnMatch = ts.match(/private\s+toggleNodeSelection\s*=\s*[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]

        expectExcerptToContain(fnBody, 'this.reflectSelectionChange(this.selection.toggle(nodeId))')
        expectExcerptNotToContain(fnBody, ', true)')
    })

    it('clearNodeSelection resets selection and hides overlay', () => {
        const fnMatch = ts.match(/private\s+clearNodeSelection\s*=\s*[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]

        expectExcerptToContain(fnBody, 'setSelectedNodes(new Set())')
        expectExcerptToContain(fnBody, 'updateSelectionGroupOverlayElement()')
    })

    it('defines and styles the persistent selection overlay', () => {
        expectSourceToContain(ts, 'canvasRuntime.installSelectionOverlay({')
        expectSourceToContain(ts, 'private getSelectionOverlayBounds = (): Rect | null')
        expectSourceToContain(ts, 'private getSelectionOverlayBoundsForNode = (')
        expectSourceToContain(ts, 'private updateSelectionGroupOverlayElement = (): void')
        expectSourceToContain(ts, 'if (!this.currentCanvasState || !this.shouldShowSelectionGroupOverlay()) return null')
        expectSourceNotToContain(ts, ['getContext', 'Region', 'Cl', 'oudBounds'].join(''))
        expectSourceToContain(ts, 'updateSelectionGroupOverlayElement()')
        const interactionStyles = readSourceFile('../../packages/lixpi/canvas-engine/src/frontend/runtime/interaction.scss')
        const selectionGroupOverlay = extractBlock(interactionStyles, '.canvas-selection-group')
        expectExcerptToContain(selectionGroupOverlay, 'position: absolute', 'selection group overlay')
        expectExcerptToContain(selectionGroupOverlay, 'z-index: 10000', 'selection group overlay')
        expectExcerptToContain(selectionGroupOverlay, 'box-sizing: border-box', 'selection group overlay')
    })

    it('uses the selection overlay as a drag surface for the whole selected group', () => {
        expectSourceToContain(ts, 'onGroupPointerDown: event => {')
        expectSourceToContain(ts, 'if (!this.shouldShowSelectionGroupOverlay()) return')
        expectSourceToContain(ts, 'const primaryNodeId = Array.from(this.selection.nodeIds)[0]')
        expectSourceToContain(ts, 'handleDragStart(event, primaryNodeId)')
    })

    it('keeps the overlay hit target active for any visible overlay selection', () => {
        const fnMatch = ts.match(/private\s+shouldUseSelectionGroupOverlayHitTarget\s*=\s*[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]

        expectExcerptToContain(fnBody, 'return this.selection.nodeIds.size > 0')
        expectExcerptNotToContain(fnBody, ['isContext', 'RegionCanvasNode'].join(''))
    })

    it('wires selection colors from settings to CSS custom properties', () => {
        expectSourceToContain(ts, "this.paneEl.style.setProperty('--selection-marquee-border-color', this.selectionStyles.marqueeBorderColor)")
        expectSourceToContain(ts, "this.paneEl.style.setProperty('--selection-marquee-background-color', this.selectionStyles.marqueeBackgroundColor)")
        expectSourceToContain(ts, "this.paneEl.style.setProperty('--selection-overlay-border-color', this.selectionStyles.overlayBorderColor)")
        expectSourceToContain(ts, "this.paneEl.style.setProperty('--selection-overlay-background-color', this.selectionStyles.overlayBackgroundColor)")
        expectSourceToContain(ts, "this.paneEl.style.setProperty('--selection-outline-color', this.selectionStyles.outlineColor)")
        expect(scss).toMatch(/var\(--selection-outline-color/)
    })

    it('wires image settings to CSS custom properties', () => {
        expectSourceToContain(ts, "this.paneEl.style.setProperty('--workspace-media-node-default-box-shadow', this.mediaNodeStyles.defaultBoxShadow)")
        expectSourceToContain(ts, "this.paneEl.style.setProperty('--workspace-media-node-selected-box-shadow', this.mediaNodeStyles.selectedBoxShadow)")
        expectSourceToContain(ts, "this.paneEl.style.setProperty('--workspace-media-node-border-radius', `${this.mediaNodeStyles.borderRadius}px`)")
        expectSourceNotToContain(ts, "paneEl.style.setProperty('--workspace-media-model-badge-box-shadow', mediaNodeStyles.modelBadgeBoxShadow)")
        expect(scss).toMatch(/border-radius:\s*var\(--workspace-media-node-border-radius\)/)
    })

    it('wires resize handles through configured bounded zoom scaling', () => {
        expectSourceToContain(ts, '...this.host.settings.mediaNode.resizeHandle,')
        expectSourceToContain(ts, 'useZoomCompensatedScaling: this.host.settings.mediaNode.useZoomCompensatedResizeHandleScaling,')
        expectSourceNotToContain(ts, ': { size: 24, offset: 6 }')
    })

    // -------------------------------------------------------------------------
    // Marquee selection
    // -------------------------------------------------------------------------

    it('defines marquee selection helpers and pane mousedown listener', () => {
        expectSourceToContain(ts, 'canvasRuntime.installMarquee({')
        expectSourceToContain(ts, 'private handlePaneMouseDown = (event: MouseEvent): void')
        expectSourceToContain(ts, "this.paneEl.addEventListener('mousedown', this.handlePaneMouseDown, true)")
        expectSourceToContain(ts, 'selectionOverlay.setMarquee(rect)')
        expectSourceToContain(ts, 'getIntersectingNodeIds(')
        expectSourceToContain(ts, 'private getSelectableNodeIdsInRect = (rect: Rect): string[]')
        expectSourceNotToContain(ts, ['rectIntersectsContext', 'RegionCl', 'oud'].join(''))
    })

    it('renders and styles the marquee selection rectangle', () => {
        const interactionStyles = readSourceFile('../../packages/lixpi/canvas-engine/src/frontend/runtime/interaction.scss')
        expectSourceToContain(ts, 'selectionOverlay.setMarquee(rect)')
        expectSourceToContain(ts, 'borderColor: this.selectionStyles.marqueeBorderColor')
        expectSourceToContain(ts, 'backgroundColor: this.selectionStyles.marqueeBackgroundColor')
        const marqueeStyles = extractBlock(interactionStyles, '.canvas-selection-marquee')
        expectExcerptToContain(marqueeStyles, 'pointer-events: none')
        expectExcerptToContain(marqueeStyles, 'z-index: 10001')
    })

    it('syncs viewport interaction state before first pan so selection works immediately on load', () => {
        expectSourceToContain(ts, 'private syncViewportInteractionState = (viewport: Viewport): void')
        expectSourceToContain(ts, 'lastTransform = [viewport.x, viewport.y, viewport.zoom]')
        expectSourceToContain(ts, 'this.paneRect = this.paneEl.getBoundingClientRect()')
        expectSourceToContain(ts, 'syncViewportInteractionState(initialViewport)')
        expectSourceToContain(ts, 'syncViewportInteractionState(vp)')
    })

    it('treats transparent canvas children as background so marquee and outside-click clear still work', () => {
        expectSourceToContain(ts, 'private isCanvasBackgroundTarget = (target: EventTarget | null): boolean')
        expectSourceToContain(ts, 'if (!this.isCanvasBackgroundTarget(event.target)) return')
        expectSourceToContain(ts, 'if (this.isCanvasBackgroundTarget(event.target)) {')
        expectSourceToContain(ts, 'selectionOverlay.contains(target)')
    })

    it('does not treat the floating AI chat panel as canvas background', () => {
        const fnMatch = ts.match(/private\s+isCanvasBackgroundTarget\s*=\s*[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        expectExcerptToContain(fnMatch![0], "'.workspace-ai-chat-floating-panel'")
    })

    it('creates marquee selection state only after empty-canvas pointer movement', () => {
        const paneMouseDownMatch = ts.match(/private\s+handlePaneMouseDown\s*=\s*[\s\S]*?^    \}/m)
        expect(paneMouseDownMatch).not.toBeNull()
        const fnBody = paneMouseDownMatch![0]

        expectExcerptToContain(fnBody, 'marquee.start(event)')
        expectExcerptNotToContain(fnBody, 'setSelectedNodes(new Set())')
        const configuration = extractMarqueeConfiguration(ts)
        const activation = configuration.match(/onStart: \(\) => \{[\s\S]*?\},/)?.[0]
        expect(activation).toBeDefined()
        expectExcerptToContain(activation!, 'if (this.selection.nodeIds.size > 0) this.setSelectedNodes(new Set())')
    })

    it('does not draw any overlay for a plain single-node click', () => {
        const showMatch = ts.match(/private\s+shouldShowSelectionGroupOverlay\s*=\s*[\s\S]*?^    \}/m)
        expect(showMatch).not.toBeNull()
        const showBody = showMatch![0]

        expectExcerptToContain(showBody, 'return this.selection.fromMarquee')
        expectExcerptNotToContain(showBody, ['isContext', 'RegionCanvasNode(selectedNode)'].join(''))

        const fillMatch = ts.match(/private\s+shouldFillSelectionOverlayBounds\s*=\s*[\s\S]*?^    \}/m)
        expect(fillMatch).not.toBeNull()
        const fillBody = fillMatch![0]

        expectExcerptToContain(fillBody, 'return Boolean(this.currentCanvasState)')
        expectExcerptNotToContain(fillBody, ['isContext', 'RegionCanvasNode'].join(''))
        expectSourceToContain(ts, 'this.canvasMediaLayer?.setSelectionOverlayBounds(bounds, { fill: this.shouldFillSelectionOverlayBounds() })')
        expectSourceToContain(ts, 'this.ports.media()?.setSelectionOverlayBounds(this.ports.getSelectionBounds(), { fill: this.ports.shouldFillSelectionBounds() })')
    })

    it('treats foreground node bounds as hits before pan/zoom can start marquee', () => {
        const panePointerDownMatch = ts.match(/private\s+handlePanePointerDown\s*=\s*[\s\S]*?^    \}/m)
        expect(panePointerDownMatch).not.toBeNull()
        const fnBody = panePointerDownMatch![0]

        expectExcerptToContain(fnBody, 'const hitNodeId = this.getForegroundNodeHit(start)?.nodeId ?? null')
        expectExcerptToContain(fnBody, 'suspendPanZoomForNodePointer(hitNodeId)')
    })

    it('drag overlay passes original node.nodeId (not pre-resolved) to handleDragStart', () => {
        // The drag overlay must pass the original nodeId so handleDragStart can
        // preserve the original for the click path.
        expectSourceToContain(ts, 'startDrag: this.handleDragStart,')
        expectSourceNotToContain(ts, 'onmousedown=${(e: MouseEvent) => handleDragStart(e, getSelectionTargetNodeId(node.nodeId))}')
    })

    it('marquee selection includes hidden empty threads (they are selectable via their floating input)', () => {
        const fnMatch = ts.match(/private\s+getSelectableNodeIdsInRect\s*=\s*[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]

        // Must NOT filter out hidden empty threads — they are still visible
        // via their floating input and must be selectable
        expectExcerptNotToContain(fnBody, 'hiddenEmptyThreadNodeIds')
        expectExcerptToContain(fnBody, 'getIntersectingNodeIds(this.currentCanvasState?.nodes ?? [], rect, this.getSelectionBoundsForNode)')
        expectSourceToContain(ts, 'getIntersectingNodeIds(this.currentCanvasState?.nodes ?? [], rect, this.getSelectionBoundsForNode)')
    })

    // -------------------------------------------------------------------------
    // Deferred selection in handleDragStart (regression: overlay stealing clicks)
    // -------------------------------------------------------------------------

    it('defers selection in handleDragStart so the overlay does not steal mouseup', () => {
        // REGRESSION GUARD: the selection overlay (z-index 10000) must not
        // appear between mousedown and mouseup. If selectNode(resolvedNodeId)
        // ran on mousedown, the overlay could intercept mouseup/click.
        const fnMatch = loadNodeGestures().match(/    startDrag[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]

        // Selection must NOT happen unconditionally on mousedown — it is deferred
        // behind wasAlreadySelected and dragDidMove guards
        expectSourceToContain(fnBody, 'const wasAlreadySelected = this.ports.isSelected(resolvedNodeId)')
        expect(fnBody).not.toMatch(/if \(!isNodeSelected\(resolvedNodeId\)\) \{\s*\n\s*selectNode\(resolvedNodeId\)/)

        // On first meaningful mouse movement → select the resolved (thread) node for drag
        expectSourceToContain(fnBody, 'onStart: () => {')
        expectSourceToContain(fnBody, 'if (allowSelection && !wasAlreadySelected) this.ports.select(resolvedNodeId)')
        expectSourceToContain(fnBody, 'this.ports.select(resolvedNodeId)')

        // On mouseup without movement (click) → select the original nodeId.
        expectSourceToContain(fnBody, 'this.ports.select(nodeId)')
    })

    it('does not move nodes in handleMouseMove until the drag threshold is exceeded', () => {
        const fnMatch = loadNodeGestures().match(/    startDrag[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]

        // The engine owns threshold activation before publishing any geometry.
        expectExcerptToContain(fnBody, 'this.ports.runtime.startNodeDrag({')
        expectExcerptToContain(fnBody, 'threshold: 6')
    })

    // -------------------------------------------------------------------------
    // Group drag
    // -------------------------------------------------------------------------

    it('group drag uses selected nodes as drag participants', () => {
        expectSourceToContain(ts, 'const dragPlan = computeWorkspaceDragPlan({')
        expectSourceToContain(ts, 'selectedNodeIds: this.ports.selectedNodeIds(),')
        expectSourceToContain(ts, 'const draggedNodeIds = dragPlan.draggedNodeIds')
        expectSourceToContain(ts, 'const draggedNodeEntries = new Map<string, {')
        expectSourceToContain(ts, 'for (const [draggedNodeId, entry] of draggedNodeEntries)')
    })

    it('preserves multi-selection after drag by suppressing the follow-up click collapse', () => {
        expectSourceToContain(ts, 'private nextNodeClickSuppressed = false')
        expectSourceToContain(ts, 'consumeSuppressedClick: () => {')
        expectSourceToContain(ts, 'if (!dragDidMove) {')
        expectSourceToContain(ts, 'this.suppressNodeClick()')
    })

    it('group drag skips collision resolution for multi-node moves to preserve rigid spacing', () => {
        expectSourceToContain(ts, 'if (dragPlan.allowCollisionResolution) {')
        expectSourceToContain(ts, 'resolveCollisions(collisionPlan.nodeBoxes')
    })

    it('parent-container drag skips proximity checks during movement', () => {
        const fnMatch = loadNodeGestures().match(/    startDrag[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]

        expectExcerptToContain(fnBody, 'if (dragPlan.allowProximityConnection) {')
        expectExcerptToContain(fnBody, 'this.ports.connections()?.checkProximity(resolvedNodeId, currentPos, currentDims)')
    })
})

// =============================================================================
// Collision resolution ownership
// =============================================================================

describe('Workspace canvas — collision resolution ownership', () => {
    const ts = loadTs()
    const workspaceCanvasViewSource = loadWorkspaceCanvasView()
    const collisionTs = readSourceFile('../../packages/lixpi/canvas-engine/src/shared/collision/resolve-collisions.ts', 'packages/lixpi/canvas-engine/src/shared/collision/resolve-collisions.ts')

    it('keeps toolbar insertion collision logic out of the canvas view', () => {
        // Toolbar/upload/URL-import insertion is now unified through
        // addAssetToCanvas, which routes both replace-placeholder and fresh
        // insertion through the renderer instead of a separate document/image path.
        expectSourceToContain(workspaceCanvasViewSource, 'this.renderer?.replaceUploadPlaceholder(placeholderId, node, false)')
        expectSourceToContain(workspaceCanvasViewSource, 'renderer?.insertNodeAtViewportCenter(node, {}, false)')
        expectSourceNotToContain(workspaceCanvasViewSource, ['context', 'RegionNode'].join(''))
        expectSourceNotToContain(workspaceCanvasViewSource, 'resolveCollisions')
        expectSourceNotToContain(workspaceCanvasViewSource, 'resolveInsertionCollisions')
        expectSourceNotToContain(workspaceCanvasViewSource, 'computeViewportCenterInsertionPosition')
        expectSourceNotToContain(workspaceCanvasViewSource, ['context', 'RegionCl', 'oudsIntersect'].join(''))
        expectSourceNotToContain(workspaceCanvasViewSource, ['rectIntersectsContext', 'RegionCl', 'oud'].join(''))
    })

    it('routes toolbar insertion through the workspace renderer collision path', () => {
        expectSourceToContain(ts, 'insertNodeAtViewportCenter = (node: WorkspaceCanvasNodeInsertion, statePatch: WorkspaceCanvasInsertionStatePatch = {}, commit = true) => {')
        expectSourceToContain(ts, 'position: this.getCenteredInsertionPosition(node.dimensions),')
        expectSourceToContain(ts, 'nodes: this.resolveTopLevelNodeCollisions([...baseCanvasState.nodes, preparedNode]),')
        expectSourceToContain(ts, 'onCanvasStateChange?.(newCanvasState)')
        expectSourceNotToContain(ts, 'screenDimensionsToWorldDimensions(node.dimensions')
    })

    it('uses the image-node theme width for Asset upload insertion sizing', () => {
        expectSourceToContain(workspaceCanvasViewSource, 'insertionWidth: settings.mediaNode.image.defaultInsertionWidth')

        expectSourceNotToContain(workspaceCanvasViewSource, 'const maxWidth = 400')
        expectSourceNotToContain(workspaceCanvasViewSource, 'FALLBACK_IMAGE_DIMENSIONS')
    })

    it('builds rectangular collision boxes from node world bounds', () => {
        const geometry = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/branch-tree-layout/workspace-geometry.ts')
        expectSourceToContain(geometry, 'const worldPosition = this.ports.getWorldPosition(node, nodesById)')
        expectSourceToContain(geometry, 'const collisionRect = this.getCanvasNodeCollisionRect(node, worldPosition)')
        expectSourceToContain(geometry, 'x: collisionRect.x,')
        expectSourceToContain(geometry, 'width: collisionRect.width,')
    })

    it('includes resolved media title and action chrome in collision boxes', () => {
        const geometry = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/branch-tree-layout/workspace-geometry.ts')
        expectSourceToContain(ts, 'return this.workspaceGeometry.getCanvasNodeCollisionRect(node, worldPosition)')
        expectSourceToContain(geometry, 'getNodeConnectorAnchorRect: (node, position) => this.getCanvasNodeConnectorAnchorRect(node, position)')
    })

    it('uses plain rectangle overlap filtering for collision pairs', () => {
        const geometry = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/branch-tree-layout/workspace-geometry.ts')
        expectSourceToContain(geometry, 'const shouldResolvePair = (): boolean => true')
        expectSourceNotToContain(ts, ['context', 'RegionCl', 'oudGeometry'].join(''))
    })

    it('uses the shared generic resolver rather than a workspace-specific duplicate', () => {
        expectSourceToContain(collisionTs, 'export function resolveCollisions(')
        expectSourceToContain(collisionTs, 'shouldResolvePair && !shouldResolvePair(originalA, originalB)')
        expectSourceToContain(ts, "from '@lixpi/canvas-engine/shared'")
        expectSourceToContain(ts, 'resolveCollisions(collisionPlan.nodeBoxes')
    })

    it('keeps parent-child containment out of collision pushes', () => {
        expectSourceToContain(ts, 'collisionExclusions.add(`${child.parentId}-${child.nodeId}`)')
        expectSourceToContain(ts, 'excludePairs: collisionExclusions.size > 0 ? collisionExclusions : undefined')
        expectSourceToContain(ts, 'this.ports.geometry.toParentRelativePosition(resolvedPosition, n.parentId, this.getNodesById(updatedNodes))')
    })
})

// =============================================================================
// Selection interaction regression guards
// =============================================================================

describe('Workspace canvas — selection interaction regression guards', () => {
    const ts = loadTs()

    // These tests guard against specific regressions that were introduced and
    // caught during the multi-selection feature development. Each test
    // documents the root cause and the invariant that must hold.

    it('REGRESSION: clicking AI chat thread must NOT show selection overlay (must allow text editing)', () => {
        // Root cause: shouldShowSelectionGroupOverlay had a special case that
        // returned true for any single aiChatThread selection. This caused the
        // overlay to appear on every click, blocking ProseMirror editor
        // interaction because:
        //   1. Click on thread → selectNode(threadId) → overlay appears at z-index 10000
        //   2. Overlay covers the thread content → resize handles activate
        //   3. User cannot click into ProseMirror to edit text
        //
        // Invariant: shouldShowSelectionGroupOverlay must NOT check raw node.type,
        // the aiChatThread string. Plain single-node
        // clicks never draw the group overlay; marquee/multi-selection does.
        const fnMatch = ts.match(/private\s+shouldShowSelectionGroupOverlay\s*=\s*[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]

        expectExcerptNotToContain(fnBody, "'aiChatThread'")
        expectExcerptNotToContain(fnBody, 'node.type')
        expectExcerptNotToContain(fnBody, ['isContext', 'RegionCanvasNode(selectedNode)'].join(''))
        expectExcerptToContain(fnBody, 'return this.selection.fromMarquee')
    })

    it('REGRESSION: handleDragStart must NOT select on mousedown (deferred selection)', () => {
        // Root cause: handleDragStart immediately called selectNode(resolvedNodeId)
        // on mousedown. That could show the overlay at z-index 10000 and
        // intercept mouseup before the click path ran.
        //
        // Invariant: selection must be deferred:
        //   - On drag movement → selectNode(resolvedNodeId) for group drag
        //   - On click (no movement) → selectNode(nodeId) for original node
        const fnMatch = loadNodeGestures().match(/    startDrag[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]

        // The deferred selection pattern
        expectExcerptToContain(fnBody, 'const wasAlreadySelected = this.ports.isSelected(resolvedNodeId)')

        // Both selection paths must exist
        expectExcerptToContain(fnBody, 'this.ports.select(resolvedNodeId)')
        expectExcerptToContain(fnBody, 'this.ports.select(nodeId)')

        // Selection belongs to the engine's threshold activation callback.
        const dragMoveSection = fnBody.match(/onStart: \(\) => \{[\s\S]*?\}/)?.[0]
        expect(dragMoveSection).toBeDefined()
        expectExcerptToContain(dragMoveSection, 'this.ports.select(resolvedNodeId)')
    })

    it('REGRESSION: marquee selecting a single node must show the overlay', () => {
        // Root cause: shouldShowSelectionGroupOverlay required size > 1 for
        // non-special-cased nodes. Marquee-selecting a single image resulted
        // in no overlay, which was inconsistent — marquee selection should
        // always produce a visible overlay regardless of count.
        //
        // Invariant: selection.fromMarquee must make the overlay visible
        expectSourceToContain(ts, 'return this.selection.fromMarquee')

        // The marquee handler must pass fromMarquee=true
        expectExcerptToContain(extractMarqueeConfiguration(ts), 'setSelectedNodes(new Set(selectedIds), true)')
    })

    it('REGRESSION: generated output images are not adopted into deleted container types on drag release', () => {
        expectSourceNotToContain(ts, ['canAdoptNodeIntoContext', 'Region'].join(''))
        expectSourceNotToContain(ts, ['workspace', 'ImageNodePlan'].join(''))
    })
})

// =============================================================================
// Image loading — PIXI is the only canvas image renderer
// =============================================================================

describe('Image loading — PIXI ownership and URL resolution strategy', () => {
    const ts = loadTs()
    const pixiLayerTs = loadPixiMediaLayer()

    it('delegates media shell creation to the Lixpi package', () => {
        expectSourceToContain(ts, 'new WorkspaceDomNodes({')
        expectSourceToContain(ts, 'mountDom: node => this.domNodes.mount(node)')
        expectSourceNotToContain(ts, 'function createImageNode(')
        expectSourceNotToContain(pixiLayerTs, 'workspace-image-node-pixi-owned')
    })

    it('resolves canonical Asset renditions through the supplied source port', () => {
        const host = readSourceFile('./workspace-media.ts')
        expectSourceToContain(ts, 'sources: this.host.media.sources,')
        expectSourceToContain(host, 'resolveSource(buildAssetRenditionPath(assetId, renditionId), signal)')
        expectSourceToContain(pixiLayerTs, 'new WorkspaceMediaSources(options.sources)')
    })
    it('resolves transient sources through the host without DOM loading', () => {
        const host = readSourceFile('./workspace-media.ts')
        expectSourceToContain(host, 'resolveTransientSource: this.resolveSource,')
        expectSourceToContain(host, 'resolveAuthenticatedMediaUrl(source,')
        expectSourceNotToContain(ts, 'resolveAuthenticatedMediaUrl(')
    })
    it('keeps workspace identity on the renderer instance for route changes', () => {
        expectSourceToContain(ts, 'this.workspaceId = this.options.workspaceId')
    })

    it('render() accepts optional newWorkspaceId parameter and updates workspaceId', () => {
        expect(/render = \(.*newWorkspaceId\?: string/.test(ts)).toBe(true)
        expectSourceToContain(ts, 'const transitionPlan = planWorkspaceRenderTransition({')
        expectSourceToContain(ts, 'workspaceId = transitionPlan.routeWorkspaceId')
        expectSourceToContain(ts, 'renderedWorkspaceId')
    })
})

// =============================================================================
// Image generation error cleanup
// =============================================================================

describe('Image generation error cleanup', () => {
    const ts = loadTs()

    function getImageErrorHandler(): string {
        const start = ts.indexOf('onImageErrorToCanvas: ({ workspaceId: eventWorkspaceId, threadId, error, generationRun }) => {')
        expect(start, 'WorkspaceCanvas.ts should contain onImageErrorToCanvas handler').toBeGreaterThan(-1)
        const end = ts.indexOf('onImagePartialToCanvas:', start)
        expect(end, 'onImageErrorToCanvas handler should end before onImagePartialToCanvas').toBeGreaterThan(start)
        return ts.slice(start, end)
    }

    it('does not keep the old broken-image placeholder path', () => {
        expectSourceNotToContain(ts, 'showImageErrorPlaceholder')
        expectSourceNotToContain(ts, 'brokenImageIcon')
        expectSourceNotToContain(ts, 'image-error-placeholder')
    })

    it('retains the failed planned node for visible terminal status and explicit user action', () => {
        const handler = getImageErrorHandler()

        expectExcerptToContain(handler, 'const runKey = this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun)', 'onImageErrorToCanvas')
        expectExcerptToContain(handler, 'const existing = this.ports.trackers.images.get(runKey)', 'onImageErrorToCanvas')
        expectExcerptToContain(handler, 'applyMediaGenerationStreamFailureToOperationNodes(this.currentCanvasState', 'onImageErrorToCanvas')
        expectExcerptToContain(handler, 'message: error', 'onImageErrorToCanvas')
        expectExcerptToContain(handler, 'this.ports.trackers.images.delete(runKey)', 'onImageErrorToCanvas')
        expectExcerptToContain(handler, 'this.ports.removeSelection(existing.nodeId)', 'onImageErrorToCanvas')
        expectExcerptNotToContain(handler, 'removeFailedGeneratedMediaNodeFromCanvas(existing.nodeId)', 'onImageErrorToCanvas')
        expectExcerptToContain(handler, 'finishFailedGeneratedMediaRun(threadId, generationRun)', 'onImageErrorToCanvas')
        expectExcerptNotToContain(handler, 'setTimeout', 'onImageErrorToCanvas')
    })

    it('keeps cleanup scoped to the matching generation run key', () => {
        const handler = getImageErrorHandler()

        expectExcerptToContain(handler, 'const runKey = this.ports.placements.getGeneratedMediaRunKey(threadId, generationRun)', 'onImageErrorToCanvas')
        expectExcerptToContain(handler, 'const existing = this.ports.trackers.images.get(runKey)', 'onImageErrorToCanvas')
    })
})

// =============================================================================
// buildImageSrc — URL construction logic
// =============================================================================

describe('workspace media download ownership', () => {
    it('delegates authorization and downloads to the host port', () => {
        const source = loadTs()
        expectSourceToContain(source, 'await this.host.media.download({')
        expectSourceToContain(source, 'signal: this.callbacks.signal')
        expectSourceNotToContain(source, 'buildImageSrc')
    })
})

// =============================================================================
// Marquee selection — stale group overlay artifact fix
// =============================================================================

describe('Marquee selection — stale group overlay suppressed during active marquee', () => {
    const ts = loadTs()

    it('getSelectionOverlayBounds returns null while the engine marquee is active', () => {
        const fnMatch = ts.match(/private\s+getSelectionOverlayBounds\s*=\s*[\s\S]*?^    \}/m)
        expect(fnMatch).not.toBeNull()
        const fnBody = fnMatch![0]
        expectSourceToContain(fnBody, 'if (this.marquee.active) return null')
    })

    it('clears the stale group overlay on activation and applies the marquee origin to new selection', () => {
        const configuration = extractMarqueeConfiguration(ts)
        const activation = configuration.match(/onStart: \(\) => \{[\s\S]*?\},/)?.[0]
        const change = configuration.match(/onChange: bounds => \{[\s\S]*?\},/)?.[0]
        expect(activation).toBeDefined()
        expect(change).toBeDefined()
        expectExcerptToContain(activation!, 'selectionOverlay.setGroup(null)')
        expectExcerptToContain(activation!, 'if (this.selection.nodeIds.size > 0) this.setSelectedNodes(new Set())')
        expectExcerptToContain(change!, 'updateSelectionRectElement()')
        expectExcerptToContain(change!, 'setSelectedNodes(new Set(selectedIds), true)')
    })

    it('restores the final group overlay and adds context chips only on completed movement', () => {
        const end = extractMarqueeConfiguration(ts).match(/onEnd: moved => \{[\s\S]*?\},/)?.[0]
        expect(end).toBeDefined()
        expectExcerptToContain(end!, 'hideSelectionRectElement()')
        expectExcerptToContain(end!, 'updateSelectionGroupOverlayElement()')
        expectExcerptToContain(end!, 'if (moved && this.selection.fromMarquee) this.addContextChips(this.selection.nodeIds)')
    })
})

// =============================================================================
// Workspace connector rendering
// =============================================================================

describe('workspace connectors — PIXI owns visible pixels', () => {
    const ts = loadTs()
    const scss = loadScss()

    it('does not use CSS readiness classes to hide SVG connector pixels', () => {
        expectSourceNotToContain(ts, 'workspace-pixi-media-ready')
        expectSourceNotToContain(scss, 'workspace-pixi-media-ready')
    })

    it('does not create a workspace SVG connector layer', () => {
        expectSourceToContain(ts, 'this.connectionManager = this.canvasMediaLayer.connections')
        const managerTs = readSourceFile('../../packages/lixpi/canvas-engine/src/frontend/connectors/connection-manager.ts')
        expectSourceNotToContain(ts, 'workspace-edges-layer')
        expectSourceNotToContain(scss, 'workspace-edges-layer')
        expectSourceNotToContain(managerTs, 'createConnectorRenderer')
        expectSourceNotToContain(managerTs, 'isPointInStroke')
        expectSourceNotToContain(managerTs, 'SVGPathElement')
        expectSourceNotToContain(managerTs, 'svgVisible: false')
        expectSourceToContain(managerTs, 'cachedConnectorData')
        expectSourceToContain(managerTs, 'getEdgeMidpointRect(edgeId: string)')
        expectSourceToContain(managerTs, 'addConnectorDatum(edgeConfig, isSelected)')
        expectSourceToContain(managerTs, 'addConnectorDatum(tempEdge, false)')
        expectSourceToContain(managerTs, 'addConnectorDatum(ghostEdge, false)')
    })

    it('renders PIXI connectors in an unscaled screen-space layer', () => {
        const layer = loadPixiMediaLayer()
        const controller = readSourceFile('../../packages/lixpi/canvas-engine/src/frontend/runtime/canvas-controller.ts')
        expectSourceToContain(layer, 'this.canvas.installConnections({')
        expectSourceToContain(controller, 'new ConnectorRenderer({ ...options.renderer, surface })')
        expectSourceToContain(controller, 'onConnectorGeometry: edges => drawing.render(edges, this.scene.viewport)')
    })
    it('does not provide a DOM image fallback for PIXI initialization failure', () => {
        expectSourceNotToContain(ts, 'backfillDomImageSrcs')
        expectSourceNotToContain(ts, 'imageResolvedSrcByNodeId')
        const layer = loadPixiMediaLayer()
        expectSourceToContain(layer, "this.health = ready ? 'ready' : 'failed'")
    })
})

// =============================================================================
// Video generation pipeline — VideoCanvasNode + VEO
// =============================================================================

describe('video generation — canvas + plugin source shape', () => {
    const ts = loadTs()

    it('registers the VideoCanvasNode lifecycle alongside images', () => {
        // Phase 5: video nodes share the same generation tracker pattern as
        // images, but never live in the PIXI image entries map — they're
        // dispatched through the mediaNodeRegistry (videoNodeHandler).
        expectSourceToContain(ts, 'this.videoGenerationTracker = this.mediaTrackers.videos')
        expectSourceToContain(ts, 'createWorkspaceMediaLayer')
        expectSourceToContain(ts, "videoNode?.type !== 'video'")
        expectSourceToContain(loadGenerationHandlers(), 'events.subscribeVideos({')
        expectSourceToContain(ts, 'onVideoPendingToCanvas:')
        expectSourceToContain(ts, 'onVideoCompleteToCanvas:')
        expectSourceToContain(ts, 'onVideoErrorToCanvas:')
    })

    it('connects the package-owned generation visuals to the canvas renderer', () => {
        const pixiLayerTs = loadPixiMediaLayer()
        expectSourceToContain(ts, 'private syncGeneratingMediaNodes = (canvasState: CanvasState | null = this.currentCanvasState): void')
        expectSourceToContain(ts, 'generationVisuals.sync(canvasState)')
        expectSourceToContain(ts, 'images: this.partialImageTracker,')
        expectSourceToContain(ts, 'videos: this.videoGenerationTracker,')
        expectSourceToContain(ts, 'generationVisuals.setReferences(threadId, referenceNodeIds)')
        expectSourceToContain(ts, 'setTargets: targets => this.canvasMediaLayer?.setGeneratingImageNodes(targets)')
        expectSourceToContain(pixiLayerTs, 'const byId = buildNodesById(this.state?.nodes ?? [])')
        expectSourceToContain(pixiLayerTs, 'const node = byId.get(id)')
        expectSourceToContain(pixiLayerTs, '...computeWorldPosition(node, byId), ...node.dimensions')
    })

    it('keeps no DOM bounce-dot spinner for generating videos either', () => {
        // PR #202 regression: PIXI outline is the sole canvas indicator for
        // both kinds. The video placeholder must not reintroduce any of the
        // removed DOM-spinner CSS classes.
        expectSourceNotToContain(ts, 'video-generating-spinner')
        expectSourceNotToContain(ts, 'video-dot-bounce')
    })

    it('wires the bubble menu for video nodes (Replace + Download + Connect + Add to Media Library + Delete)', () => {
        // Video nodes share Replace, Download, Add to Media Library, and Connect
        // with images, while keeping dedicated Delete behavior.
        const bubbleMenuTs = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/menus/canvas-bubble-menu-items.ts')
        const menu = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/menus/workspace-canvas-menu.ts')
        expectSourceToContain(ts, 'new WorkspaceCanvasMenu({')
        // Every uploaded media kind maps to a bubble-menu context (image, video,
        // mediaDocument, audio) — so documents/audio also get a menu (Delete).
        expectSourceToContain(menu, 'video: CANVAS_VIDEO_CONTEXT,')
        expectSourceToContain(menu, 'mediaDocument: CANVAS_DOCUMENT_CONTEXT,')
        expectSourceToContain(menu, 'const context = node ? contexts[node.type] : undefined')
        expectSourceToContain(ts, 'onDownloadMedia: nodeId => {')
        expectSourceToContain(ts, 'onReplaceMedia: nodeId => this.chooseMediaReplacement(nodeId)')
        expectSourceToContain(bubbleMenuTs, "export const CANVAS_VIDEO_CONTEXT = 'canvasVideo'")
        expectSourceToContain(bubbleMenuTs, "title: 'Replace media'")
        expectSourceToContain(bubbleMenuTs, "title: 'Download media'")
        expectSourceToContain(bubbleMenuTs, "title: 'Delete video'")
        expectSourceToContain(bubbleMenuTs, 'context: [CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT]')
    })

    it('resolves sourceVideoNodeId to an Asset id at submit time', () => {
        // Phase 6: the chat plugin forwards `sourceVideoNodeId` only via thread
        // attrs; WorkspaceCanvas resolves it to the source video's Asset id just
        // before publishing to NATS — the API resolves the authorized
        // organization Blob coordinate from that Asset id. VEO's precedence is
        // extension > first-frame > references > text-only.
        expectSourceToContain(ts, 'new CanvasConversationRun(scope, {')
        expectSourceToContain(ts, 'connect: this.host.generation.connect,')
    })

    it('feeds videos into downstream context as their representative frame, never the MP4', () => {
        // The old ai-chat-thread-service.ts poster+metadata context-item path is
        // gone. Video context now flows through ai-image-branching.ts's Asset
        // rendition resolver: videos resolve to the representativeFrame rendition
        // (falling back to the frame-0 poster), the MP4 itself is never sent.
        const branchingTs = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/shared/generation/workspace-generation-context.ts')
        expectSourceToContain(branchingTs, "return ports.renditionPath(node.assetId, node.type === 'video' ? 'representativeFrame' : 'preview')")
        expectSourceNotToContain(branchingTs, "'.mp4'")
    })
})

// =============================================================================
// Asset membership persistence
// =============================================================================

describe('asset membership persistence', () => {
    const ts = loadTs()
    const workspaceCanvasViewSource = loadWorkspaceCanvasView()

    it('supplies membership and insertion ports to the package upload workflow', () => {
        expectSourceToContain(workspaceCanvasViewSource, 'attach: (workspaceId, request) => this.membership(workspaceId).attach(request)')
        expectSourceToContain(workspaceCanvasViewSource, 'prepareInsertion: (node, placeholderId) => {')
        expectSourceToContain(workspaceCanvasViewSource, 'commitMedia: (state, nodeId, placeholderId) => this.renderer?.commitTransientCanvasNodeInsertion(state, nodeId, placeholderId)')
        expectSourceToContain(workspaceCanvasViewSource, 'return await this.membership(workspaceId)[operation]({')
    })
    it('uses the per-workspace mutation lane and commits the rebased accepted state', () => {
        const membershipRebase = loadCanvasMembershipStateRebase()

        expectSourceToContain(workspaceCanvasViewSource, 'new WorkspaceCanvasMembership(this.ports.session(workspaceId).persistence, this.ports.membership)')
        expectSourceToContain(workspaceCanvasViewSource, "this.mutateMembership('attach', request)")
        expectSourceToContain(workspaceCanvasViewSource, "this.mutateMembership('detach', request)")
        expectSourceToContain(membershipRebase, 'const removedNodeIdSet = new Set(removedNodeIds)')
        expectSourceToContain(membershipRebase, 'removedNodeIdSet.has(node.nodeId)')
        expectSourceToContain(membershipRebase, 'removedNodeIdSet.has(edge.sourceNodeId)')
        expectSourceToContain(workspaceCanvasViewSource, 'revision: this.viewRevision }')
        expectSourceToContain(ts, 'removedNodeIds: string[]')
        expectSourceToContain(ts, 'onAssetAttach?: (params: { assetId: string; nodeId: string; canvasState: CanvasState }) => Promise<CanvasState>')
        expectSourceToContain(ts, 'const committedState = await this.onAssetAttach({ assetId: item.assetId, nodeId, canvasState: nextState })')
        expectSourceToContain(ts, 'this.ports.commitTransient(committedState)')
    })
})

describe('canvas node deletion', () => {
    const ts = loadTs()

    it('delegates canvas keyboard ownership and supplies the selection deletion action', () => {
        const start = ts.indexOf('canvasRuntime.installKeyboard({')
        const end = ts.indexOf('\n    private ensureMediaLibraryPanel = ()', start)
        const handler = ts.slice(start, end)

        expect(start).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(start)
        expectSourceToContain(ts, 'this.canvasRuntime = this.canvasMediaLayer.canvas')
        expectExcerptToContain(handler, 'if (this.selection.nodeIds.size > 0)', 'canvas keyboard adapter')
        expectExcerptToContain(handler, 'void this.deleteCanvasNodes(new Set(this.selection.nodeIds))', 'canvas keydown handler')
    })

    it('uses one deletion path for node menus and generated-output rejection', () => {
        expectSourceToContain(ts, 'void this.deleteCanvasNodes(new Set([nodeId]))')
        expectSourceToContain(ts, 'private deleteCanvasNodes = async (nodeIds: ReadonlySet<string>): Promise<void>')
        expectSourceToContain(ts, 'return isGeneratedOutputRejectableForCanvas({')
        expectSourceToContain(ts, 'return await this.outputReview.rejectGeneratedOutput(scope, nodeId)')
        expectSourceToContain(ts, 'onReject: nodeId => {')
    })

    it('rejects a selected lineage marker authoritatively and locally removes an unpersisted orphan', () => {
        const deletion = loadNodeDeletion()

        // Review stays the authoritative removal for a lineage marker; a detach is
        // the fallback for anything review cannot own, orphans included.
        expectExcerptToContain(deletion, 'isBranchMarkerNode(node)', 'deleteCanvasNodes')
        expectExcerptToContain(deletion, "? 'branch-lineage' as const", 'deleteCanvasNodes')
        expectExcerptToContain(
            deletion,
            "if (result === 'applied') continue",
            'deleteCanvasNodes',
        )
        expectExcerptToContain(deletion, 'await this.detachCanvasNode(node.nodeId, scope)', 'deleteCanvasNodes branch marker handling')
        expectSourceToContain(ts, 'return await this.outputReview.rejectGeneratedOutput(scope, nodeId)')
    })

    it('passes every pruned marker id through the authoritative Asset detach rebase', () => {
        expectSourceToContain(ts, 'const removedNodeIds = getRemovedCanvasNodeIds(previousState, unprunedNextState)')
        expectSourceToContain(ts, 'const nextState = pruneCanvasContextChips(unprunedNextState, removedNodeIds)')
        expectSourceToContain(ts, 'this.ports.resolveTree(remainingNodes, updatedEdges)')
        expectSourceToContain(ts, 'commitTransientCanvasStatePreservingEditors(committedState)')
    })
})

// =============================================================================
// CANVAS SELECTION DELETION RESILIENCE
// =============================================================================

describe('Workspace canvas — selection deletion', () => {
    function extractDeleteCanvasNodes(source: string): string {
        const start = source.indexOf('async deleteCanvasNodes(')
        expect(start >= 0, 'deleteCanvasNodes should exist').toBe(true)
        const end = source.indexOf('\n    }', start)
        return source.slice(start, end)
    }

    // A marquee selection routinely mixes healthy nodes with wreckage from an
    // interrupted run. Deleting it must remove everything it can; one node that
    // cannot be reviewed or detached may never abort the rest.
    it('attempts every selected node independently instead of aborting the selection', () => {
        const body = extractDeleteCanvasNodes(loadTs())

        expectExcerptNotToContain(body, 'break', 'deleteCanvasNodes')
        expectExcerptToContain(body, 'undeletedNodeIds.push(node.nodeId)', 'deleteCanvasNodes')
        expectExcerptToContain(
            body,
            '[CANVAS][node-deletion] Skipping a node that could not be deleted:',
            'deleteCanvasNodes',
        )
    })

    it('falls back to a plain detach whenever generated-output review does not apply', () => {
        const body = extractDeleteCanvasNodes(loadTs())

        expectExcerptToContain(
            body,
            "if (result === 'applied') continue",
            'deleteCanvasNodes',
        )
        expectExcerptToContain(body, 'await this.detachCanvasNode(node.nodeId, scope)', 'deleteCanvasNodes')
    })

    // Generated-media membership is API-owned, so a local canvas commit is a
    // no-op for these nodes. Removing one has to go through the API, exactly as
    // the stop control does, or the next projection puts it straight back.
    it('cancels the owning run for a generated-media node review cannot remove', () => {
        const body = extractDeleteCanvasNodes(loadTs())
        const source = loadTs()

        expectExcerptToContain(body, 'if (await this.cancelOwningMediaGenerationRun(node, scope)) continue', 'deleteCanvasNodes')
        expectExcerptToContain(source, 'private async cancelOwningMediaGenerationRun(', 'WorkspaceCanvas.ts')
        expectExcerptToContain(source, 'await this.ports.cancelRequest({', 'cancelOwningMediaGenerationRun')
    })

    it('resolves the cancel revision from the request when no operation node survived', () => {
        const source = loadTs()
        const start = source.indexOf('private async cancelOwningMediaGenerationRun(')
        const body = source.slice(start, source.indexOf('\n    }', start))

        expectExcerptToContain(body, 'operation?.requestRevision', 'cancelOwningMediaGenerationRun')
        expectExcerptToContain(
            body,
            'await this.ports.getRequest({ generationRequestId: cancelRequestId, workspaceId: scope.workspaceId })',
            'cancelOwningMediaGenerationRun',
        )
        expectExcerptToContain(body, "cancelRequestId.startsWith('canvas-')", 'cancelOwningMediaGenerationRun')
    })

    // A node can outlive its Asset when a run dies before the Asset record is
    // written. The missing reference is the reason to finish the removal.
    it('completes the canvas removal when the Asset behind a node is already gone', () => {
        const source = loadTs()
        const start = source.indexOf('private async detachCanvasNode(')
        const body = source.slice(start, source.indexOf('\n    }', start))

        expectExcerptToContain(body, 'if (!isMissingAssetDetachError(error)) throw error', 'detachCanvasNode')
        expectExcerptToContain(body, 'this.ports.commit(nextState)', 'detachCanvasNode')
        expectExcerptToContain(
            source,
            "return error instanceof Error && error.message === 'NOT_FOUND'",
            'isMissingAssetDetachError',
        )
    })
})

// =============================================================================
// BRANCH MARKER TRACE REFERENCES
// =============================================================================

describe('Workspace canvas — branch marker trace references', () => {
    it('consumes the API-canonical Asset set instead of prompt mention occurrences', () => {
        const source = loadTs()
        const handles = extractFunctionBody(source, 'getBranchMarkerPromptTraceHandles')
        const progress = extractFunctionBody(source, 'createBranchMarkerGlobalProgress')

        expectExcerptToContain(
            handles,
            'return this.referenceProjection.getBranchMarkerPromptTraceHandles(node, preview)',
            'getBranchMarkerPromptTraceHandles',
        )
        expectExcerptToContain(
            progress,
            'promptHandles: this.getBranchMarkerPromptTraceHandles(node, threadPreview)',
            'createBranchMarkerGlobalProgress',
        )
    })
})
