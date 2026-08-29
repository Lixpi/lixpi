import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function readSourceFile(relativePath: string): string {
    return readFileSync(resolve(__dirname, relativePath), 'utf-8')
}

function expectSourceToContain(source: string, snippet: string, label: string): void {
    expect(
        source.includes(snippet),
        `${label} should contain:\n${snippet}`
    ).toBe(true)
}

function extractBlock(source: string, selector: string): string {
    const selectorIndex = source.indexOf(selector)
    if (selectorIndex === -1) return ''

    const openIndex = source.indexOf('{', selectorIndex)
    if (openIndex === -1) return ''

    let depth = 0
    for (let index = openIndex + 1; index < source.length; index++) {
        if (source[index] === '{') depth++
        if (source[index] !== '}') continue
        if (depth === 0) return source.slice(selectorIndex, index + 1)
        depth--
    }

    return ''
}

describe('generated media review controls', () => {
    const canvasSource = readSourceFile('WorkspaceCanvas.ts')
    const scssSource = readSourceFile('workspace-canvas.scss')
    const layoutSource = readSourceFile('../../views/layouts/layout.ts')
    const settingsSource = readSourceFile('../../settings.ts')
    const iconSource = readSourceFile('../../../packages/lixpi/ui-kit/src/svg/svgIcons.ts')
    const footerSource = readSourceFile('../../../packages/lixpi/ui-kit/src/components/canvasNodeFooter/canvasNodeFooter.ts')
    const footerScssSource = readSourceFile('../../../packages/lixpi/ui-kit/src/components/canvasNodeFooter/canvas-node-footer.scss')

    it('uses the shared icon set and pure dropdown for review actions', () => {
        expectSourceToContain(canvasSource, 'checkMarkIcon,', 'WorkspaceCanvas.ts')
        expectSourceToContain(canvasSource, 'refreshIcon,', 'WorkspaceCanvas.ts')
        expectSourceToContain(footerSource, 'innerHTML=${infoLetterIcon}', 'canvasNodeFooter.ts')
        expectSourceToContain(canvasSource, 'innerHTML=${checkMarkIcon}', 'WorkspaceCanvas.ts')
        expectSourceToContain(canvasSource, 'innerHTML=${refreshIcon}', 'WorkspaceCanvas.ts')
        expectSourceToContain(canvasSource, 'branchMarkerReviewDropdowns: Map<string, ReturnType<typeof createPureDropdown>>', 'WorkspaceCanvas.ts')
        expectSourceToContain(canvasSource, 'buttonIcon: refreshIcon', 'WorkspaceCanvas.ts')
        expectSourceToContain(canvasSource, "title: 'Regenerate variants'", 'WorkspaceCanvas.ts')
        expectSourceToContain(canvasSource, "title: 'Regenerate prompt'", 'WorkspaceCanvas.ts')
        expectSourceToContain(iconSource, 'export const checkMarkIcon', 'ui-kit/svg/svgIcons.ts')
        expectSourceToContain(iconSource, 'export const refreshIcon', 'ui-kit/svg/svgIcons.ts')
        expectSourceToContain(iconSource, 'export const infoLetterIcon', 'ui-kit/svg/svgIcons.ts')
    })

    it('keeps branch and media review controls zoom-scaled and visually unified', () => {
        const actionBlock = extractBlock(scssSource, '.media-review-action,\n.workspace-branch-marker-review-action')
        const iconBlock = extractBlock(scssSource, '.media-review-action-icon,\n.workspace-branch-marker-review-action-icon')
        const branchControlsBlock = extractBlock(scssSource, '.workspace-branch-marker-review-controls')
        const separatorBlock = extractBlock(footerScssSource, '.canvas-node-footer-separator')

        expectSourceToContain(canvasSource, 'applyBranchMarkerReviewControlsZoom(controls, getCurrentViewportZoom())', 'WorkspaceCanvas.ts')
        expectSourceToContain(canvasSource, 'updateBranchMarkerReviewControlsZoom(vp.zoom)', 'WorkspaceCanvas.ts')
        expectSourceToContain(canvasSource, 'className="canvas-node-footer-separator"', 'WorkspaceCanvas.ts')
        expectSourceToContain(actionBlock, 'width: var(--workspace-generated-media-chrome-icon-size, 34px)', 'review action CSS')
        expectSourceToContain(actionBlock, 'height: var(--workspace-generated-media-chrome-icon-size, 34px)', 'review action CSS')
        expectSourceToContain(actionBlock, 'transition: hoverTransition(color, $defaultHoverTransitionDuration)', 'review action CSS')
        expectSourceToContain(iconBlock, 'width: 85.7143%', 'review action icon CSS')
        expectSourceToContain(iconBlock, 'height: 85.7143%', 'review action icon CSS')
        expectSourceToContain(branchControlsBlock, 'right: 0', 'branch review controls CSS')
        expectSourceToContain(branchControlsBlock, 'transform-origin: top right', 'branch review controls CSS')
        expectSourceToContain(separatorBlock, 'height: 70%', 'review separator CSS')
    })

    it('binds the shared hover duration from settings into the application root', () => {
        expectSourceToContain(settingsSource, 'hover: {\n        transitionDurationMs: 150,', 'settings.ts')
        expectSourceToContain(layoutSource, "document.documentElement.style.setProperty('--default-hover-transition-duration', `${settings.hover.transitionDurationMs}ms`)", 'layout.ts')
    })
})
