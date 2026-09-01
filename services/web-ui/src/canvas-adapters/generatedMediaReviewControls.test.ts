import {
    describe,
    expect,
    it,
} from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function readSourceFile(relativePath: string): string {
    return readFileSync(resolve(__dirname, relativePath), 'utf-8')
}

function expectSourceToContain(source: string, snippet: string, label: string): void {
    expect(
        source.includes(snippet),
        `${label} should contain:\n${snippet}`,
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
    const canvasSource = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-canvas.ts')
    const scssSource = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/media/generated-output-node-chrome.scss')
    const chromeSource = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/media/generated-output-node-chrome.ts')
    const branchActionsSource = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/nodes/branch-marker-actions.ts')
    const branchScssSource = readSourceFile('../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/nodes/branch-marker-content.scss')
    const layoutSource = readSourceFile('../views/layouts/layout.ts')
    const settingsSource = readSourceFile('../settings.ts')
    const iconSource = readSourceFile('../../packages/lixpi/ui-kit/src/svg/svgIcons.ts')
    const footerSource = readSourceFile('../../packages/lixpi/ui-kit/src/components/canvasNodeFooter/canvasNodeFooter.ts')
    const footerScssSource = readSourceFile('../../packages/lixpi/ui-kit/src/components/canvasNodeFooter/canvas-node-footer.scss')

    it('uses the shared icon set and pure dropdown for review actions', () => {
        expectSourceToContain(chromeSource, 'checkMarkIcon,', 'generated-output-node-chrome.ts')
        expectSourceToContain(chromeSource, 'refreshIcon,', 'generated-output-node-chrome.ts')
        expectSourceToContain(footerSource, 'innerHTML=${config.icons.info}', 'canvasNodeFooter.ts')
        expectSourceToContain(chromeSource, 'icons: { info: infoLetterIcon, progress: progressRippleArtwork }', 'generated-output-node-chrome.ts')
        expectSourceToContain(canvasSource, 'new BranchMarkerActions({', 'WorkspaceCanvas.ts')
        expectSourceToContain(branchActionsSource, 'buttonIcon: refreshIcon', 'branch-marker-actions.ts')
        expectSourceToContain(branchActionsSource, "title: 'Regenerate variants'", 'branch-marker-actions.ts')
        expectSourceToContain(branchActionsSource, "title: 'Regenerate prompt'", 'branch-marker-actions.ts')
        expectSourceToContain(iconSource, 'export const checkMarkIcon', 'ui-kit/svg/svgIcons.ts')
        expectSourceToContain(iconSource, 'export const refreshIcon', 'ui-kit/svg/svgIcons.ts')
        expectSourceToContain(iconSource, 'export const infoLetterIcon', 'ui-kit/svg/svgIcons.ts')
    })

    it('keeps branch and media review controls zoom-scaled and visually unified', () => {
        const actionBlock = extractBlock(scssSource, '.media-review-action {')
        const iconBlock = extractBlock(scssSource, '.media-review-action-icon {')
        const branchControlsBlock = extractBlock(branchScssSource, '.workspace-branch-marker-review-controls')
        const separatorBlock = extractBlock(footerScssSource, '.canvas-node-footer-separator')

        expectSourceToContain(canvasSource, 'controls.setZoomScale(this.getBranchMarkerReviewZoomScale(this.getCurrentViewportZoom()))', 'WorkspaceCanvas.ts')
        expectSourceToContain(canvasSource, 'updateBranchMarkerReviewControlsZoom(vp.zoom)', 'WorkspaceCanvas.ts')
        expectSourceToContain(branchActionsSource, 'className="canvas-node-footer-separator"', 'branch-marker-actions.ts')
        expectSourceToContain(actionBlock, 'width: var(--canvas-node-footer-icon-size, 34px)', 'review action CSS')
        expectSourceToContain(actionBlock, 'height: var(--canvas-node-footer-icon-size, 34px)', 'review action CSS')
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
