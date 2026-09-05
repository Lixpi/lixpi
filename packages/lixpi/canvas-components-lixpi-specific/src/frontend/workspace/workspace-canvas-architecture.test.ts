import {
    existsSync,
    readFileSync,
} from 'node:fs'
import {
    describe,
    expect,
    it,
} from 'vitest'

const readWorkspaceSource = (filename: string): string => readFileSync(new URL(filename, import.meta.url), 'utf8')

describe('workspace canvas composition', () => {
    it('delegates isolated responsibilities to focused workspace owners', () => {
        const source = readWorkspaceSource('./workspace-canvas.ts')
        const owners = [
            'WorkspaceCanvasLibraries',
            'WorkspaceCanvasSelection',
            'WorkspaceMediaGeometry',
            'WorkspaceMediaReplacement',
            'WorkspaceBranchMarkerModels',
            'WorkspaceBranchMarkerProjection',
            'WorkspaceBranchMarkerPresentation',
            'WorkspaceCanvasContext',
            'WorkspaceCanvasAssets',
            'WorkspaceGeneratedOutputDetails',
            'WorkspaceCanvasInteractions',
            'WorkspaceBranchMarkerGeneration',
            'WorkspaceOperationStatusNodes',
            'WorkspaceCanvasVisibility',
            'WorkspaceCanvasThreadState',
            'WorkspaceCanvasRendering',
        ]

        for (const owner of owners) expect(source).toContain(`new ${owner}(`)
        expect(source).toContain('applyWorkspaceCanvasTheme(')
        expect(source).toContain('getWorkspaceRightPanelCssProperties(')
        expect(source).toContain('destroyWorkspaceCanvasResources([')
        expect(source).not.toContain('private ensureMediaLibraryPanel')
        expect(source).not.toContain('private handleImageIntrinsicSize')
        expect(source).not.toContain('private createBranchMarkerContent')
        expect(source).not.toContain('private removeOperationStatusNode')
        expect(source).not.toContain('private setCanvasSelectedNodeIds')
        expect(source).not.toContain('private createWorkspaceLibraryPorts')
        expect(source).not.toContain('private createAssetViewPorts')
        expect(source).not.toContain('private renderActiveAiChatPanel')
        expect(source).not.toContain('private getVisibleCanvasNodes')
        expect(source).not.toContain('private getAiChatThreadsKey')
        expect(source).not.toContain('private handlePaneMouseDown')
    })

    it('keeps a direct test and public export for every extracted workspace owner', () => {
        const indexSource = readWorkspaceSource('./index.ts')
        const modules = [
            'workspace-canvas-assets',
            'workspace-canvas-cleanup',
            'workspace-canvas-context',
            'workspace-canvas-contracts',
            'workspace-canvas-interactions',
            'workspace-canvas-libraries',
            'workspace-canvas-rendering',
            'workspace-canvas-selection',
            'workspace-canvas-theme',
            'workspace-canvas-thread-state',
            'workspace-canvas-visibility',
            'workspace-generated-output-details',
            'workspace-media-geometry',
            'workspace-media-replacement',
            'workspace-branch-marker-generation',
            'workspace-branch-marker-models',
            'workspace-branch-marker-presentation',
            'workspace-branch-marker-projection',
            'workspace-operation-status-nodes',
        ]

        for (const module of modules) {
            expect(existsSync(new URL(`./${module}.test.ts`, import.meta.url))).toBe(true)
            expect(indexSource).toContain(`export * from './${module}.ts'`)
        }
    })
})
