import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    hslToRgb,
    parseHexColor,
    rgbToHex,
    rgbToHsl,
} from '@lixpi/ui-primitives/gradients'
import {
    createNewFileIcon,
    imageIcon,
    mediaFoloderIcon,
} from '@lixpi/ui-kit/svg'
import type { LixpiCanvasPalette } from '../settings/index.ts'

export type WorkspaceCanvasChromeSettings = {
    panel: {
        defaultDimensions: { width: number }
        dimensions: { maxPaneMargin: number }
        layout: { contentInset: number }
        typography: { contentFontSize: number; tagPillFontSize: number; tagPillFontWeight: number }
        styles: { backdropFill: string; backdropFillOpaque: string; toggleColor: string; toggleHoverColor: string }
    }
    modelMenuHoverBackground: string
    palette: LixpiCanvasPalette
}

export type WorkspaceCanvasChromePorts = {
    document: Document
    createDocument: () => Promise<void>
    uploadFile: (file: File) => Promise<void>
    importUrl: (url: string) => Promise<void>
    toggleMediaLibrary: () => void
    reportError: (error: unknown) => void
}

export class WorkspaceCanvasChrome {
    readonly element: HTMLElement
    readonly pane: HTMLDivElement
    readonly viewportMount: HTMLDivElement
    readonly mediaModeSwitchMount: HTMLDivElement
    readonly modelMenuControlMount: HTMLDivElement
    readonly glassTargets: readonly { id: string; element: HTMLElement }[]
    private readonly html: ReturnType<typeof createDocumentHtml>
    private readonly imageWrapper: HTMLDivElement
    private readonly imageButton: HTMLButtonElement
    private readonly fileInput: HTMLInputElement
    private readonly zoomIndicator: HTMLSpanElement
    private menuOpen = false
    private menuMode: 'menu' | 'url' = 'menu'
    private imageUrl = ''
    private releaseOutsideClick: (() => void) | null = null
    private disposed = false

    constructor(settings: WorkspaceCanvasChromeSettings, private readonly ports: WorkspaceCanvasChromePorts) {
        const html = this.html = createDocumentHtml(ports.document)
        this.viewportMount = html`<div className="workspace-viewport-mount"></div>` as HTMLDivElement
        this.pane = html`<div className="workspace-pane">${this.viewportMount}</div>` as HTMLDivElement
        this.mediaModeSwitchMount = html`<div className="workspace-canvas-media-mode-panel"></div>` as HTMLDivElement
        this.modelMenuControlMount = html`<div className="workspace-canvas-model-menu-panel"></div>` as HTMLDivElement
        this.zoomIndicator = html`<span className="workspace-zoom-indicator"></span>` as HTMLSpanElement
        this.fileInput = html`<input type="file" accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.ppt,.pptx,.odt,.rtf,.txt,.md" style="display: none" onchange=${this.onFileChange} />` as HTMLInputElement
        this.imageButton = html`<button className="workspace-floating-toolbar-button" aria-label="Add Image" data-help-tooltip="aria-label" onclick=${this.toggleUploadMenu} innerHTML=${imageIcon}></button>` as HTMLButtonElement
        this.imageWrapper = html`<div className="workspace-floating-toolbar-image-wrapper">${this.imageButton}</div>` as HTMLDivElement
        const actions = html`
            <div className="workspace-canvas-action-panel workspace-canvas-action-panel-left">
                <button className="workspace-floating-toolbar-button" aria-label="New Document" data-help-tooltip="aria-label" onclick=${() => {
            void this.invoke(ports.createDocument)
        }} innerHTML=${createNewFileIcon}></button>
                ${this.imageWrapper}
            </div>
        ` as HTMLDivElement
        const library = html`
            <div className="workspace-canvas-action-panel workspace-canvas-media-library-panel workspace-canvas-action-panel-single">
                <button className="workspace-floating-toolbar-button" aria-label="Media Library" data-help-tooltip="aria-label" onclick=${() => {
            if (!this.disposed) ports.toggleMediaLibrary()
        }} innerHTML=${mediaFoloderIcon}></button>
            </div>
        ` as HTMLDivElement
        const controls = html`
            <div className="workspace-canvas-action-panel workspace-canvas-right-control-rail">
                <div className="workspace-canvas-model-menu-hover-background" aria-hidden="true"></div>
                ${this.mediaModeSwitchMount}
                ${this.modelMenuControlMount}
            </div>
        ` as HTMLDivElement
        controls.style.setProperty('--ai-prompt-model-menu-trigger-active-background', settings.modelMenuHoverBackground)
        this.element = html`
            <div className="workspace-canvas">
                <div className="workspace-canvas-left-control-rail">${actions}${library}</div>
                ${controls}${this.fileInput}${this.zoomIndicator}${this.pane}
            </div>
        ` as HTMLElement
        this.glassTargets = [
            { id: 'workspace-action-panel-left', element: actions },
            { id: 'workspace-media-library-panel', element: library },
            { id: 'workspace-right-control-rail', element: controls },
        ]
        this.applySettings(settings)
        this.setZoom(1)
    }

    setZoom(zoom: number): void {
        if (!this.disposed && Number.isFinite(zoom)) this.zoomIndicator.textContent = `${Math.round(zoom * 100)}%`
    }

    setRightPanelOpen(open: boolean): void {
        if (!this.disposed) this.element.classList.toggle('workspace-canvas-right-side-panel-open', open)
    }

    closeUploadMenu(): void {
        if (this.disposed) return
        this.menuOpen = false
        this.menuMode = 'menu'
        this.imageUrl = ''
        this.renderUploadMenu()
    }

    destroy(): void {
        if (this.disposed) return
        this.disposed = true
        this.releaseOutsideClick?.()
        this.releaseOutsideClick = null
        this.element.remove()
    }

    private applySettings({ panel, palette }: WorkspaceCanvasChromeSettings): void {
        const hsl = rgbToHsl(parseHexColor(palette.nightBlue))
        const properties = {
            '--workspace-right-side-panel-width': `min(${panel.defaultDimensions.width}px, calc(100vw - ${panel.dimensions.maxPaneMargin}px))`,
            '--side-panel-backdrop-width': 'var(--workspace-right-side-panel-width)',
            '--workspace-right-side-panel-content-inset': `${panel.layout.contentInset}px`,
            '--workspace-right-sidebar-content-font-size': `${panel.typography.contentFontSize}px`,
            '--workspace-right-sidebar-tag-pill-font-size': `${panel.typography.tagPillFontSize}px`,
            '--workspace-right-sidebar-tag-pill-font-weight': String(panel.typography.tagPillFontWeight),
            '--side-panel-backdrop-fill': panel.styles.backdropFill,
            '--side-panel-backdrop-fill-opaque': panel.styles.backdropFillOpaque,
            '--side-panel-toggle-color': panel.styles.toggleColor,
            '--side-panel-toggle-hover-color': panel.styles.toggleHoverColor,
            '--workspace-chrome-steel-blue': palette.steelBlue,
            '--workspace-chrome-night-blue': palette.nightBlue,
            '--workspace-chrome-off-white': palette.offWhite,
            '--workspace-chrome-insert-hover': rgbToHex(hslToRgb({ ...hsl, l: Math.max(0, hsl.l - 0.05) })),
        }
        for (const [name, value] of Object.entries(properties)) this.element.style.setProperty(name, value)
    }

    private async invoke(action: () => Promise<void>): Promise<void> {
        if (this.disposed) return
        try {
            await action()
        } catch (error) {
            if (!this.disposed) this.ports.reportError(error)
        }
    }

    private readonly onFileChange = (): void => {
        if (this.disposed) return
        const file = this.fileInput.files?.[0]
        if (!file) return
        this.closeUploadMenu()
        this.fileInput.value = ''
        void this.invoke(() => this.ports.uploadFile(file))
    }

    private readonly toggleUploadMenu = (): void => {
        if (this.disposed) return
        this.menuOpen = !this.menuOpen
        this.menuMode = 'menu'
        this.imageUrl = ''
        this.renderUploadMenu()
    }

    private readonly submitUrl = (): void => {
        const url = this.imageUrl
        void this.invoke(() => this.ports.importUrl(url))
    }

    private renderUploadMenu(): void {
        const html = this.html
        this.imageButton.classList.toggle('active', this.menuOpen)
        this.imageWrapper.querySelector('.workspace-image-submenu')?.remove()
        this.releaseOutsideClick?.()
        this.releaseOutsideClick = null
        if (!this.menuOpen) return
        let menu: HTMLElement
        if (this.menuMode === 'menu') {
            menu = html`
                <div className="workspace-image-submenu">
                    <button className="workspace-image-submenu-option" onclick=${() => {
                if (!this.disposed) this.fileInput.click()
            }}>Upload from Device</button>
                    <button className="workspace-image-submenu-option" onclick=${() => {
                if (this.disposed) return
                this.menuMode = 'url'
                this.renderUploadMenu()
            }}>Paste Image URL</button>
                </div>
            ` as HTMLElement
        } else {
            const input = html`<input type="url" className="workspace-image-submenu-url-input" placeholder="https://example.com/image.jpg" onkeydown=${(event: KeyboardEvent) => {
                if (event.key === 'Enter') this.submitUrl()
            }} oninput=${(event: Event) => {
                this.imageUrl = (event.target as HTMLInputElement).value
            }} />` as HTMLInputElement
            input.value = this.imageUrl
            menu = html`
                <div className="workspace-image-submenu">
                    <div className="workspace-image-submenu-url-form">
                        ${input}
                        <div className="workspace-image-submenu-url-actions">
                            <button className="workspace-image-submenu-url-back" onclick=${() => {
                if (this.disposed) return
                this.menuMode = 'menu'
                this.renderUploadMenu()
            }}>Back</button>
                            <button className="workspace-image-submenu-url-insert" onclick=${this.submitUrl}>Add</button>
                        </div>
                    </div>
                </div>
            ` as HTMLElement
        }
        this.imageWrapper.append(menu)
        const outsideClick = (event: MouseEvent) => {
            const target = event.target
            const NodeType = this.ports.document.defaultView?.Node
            if (NodeType && target instanceof NodeType && this.ports.document.contains(target) && !this.imageWrapper.contains(target)) this.closeUploadMenu()
        }
        const timer = setTimeout(() => this.ports.document.addEventListener('click', outsideClick), 0)
        this.releaseOutsideClick = () => {
            clearTimeout(timer)
            this.ports.document.removeEventListener('click', outsideClick)
        }
    }
}
