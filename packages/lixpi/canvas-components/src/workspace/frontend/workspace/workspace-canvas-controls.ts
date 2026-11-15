import { WorkspacePromptControlRail } from '../composer/workspace-prompt-control-rail.ts'
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
} from '@lixpi/ui-kit/svg'
import {
    createActionPanel,
    type ActionPanelInstance,
} from '@lixpi/ui-kit/components/action-panel'
import {
    type LixpiCanvasPalette,
} from '../settings/index.ts'

export type WorkspaceCanvasControlsSettings = {
    panel: {
        defaultDimensions: { width: number }
        dimensions: { maxPaneMargin: number }
        layout: { contentInset: number }
        typography: {
            contentFontSize: number
            tagPillFontSize: number
            tagPillFontWeight: number
        }
        styles: {
            backdropFill: string
            backdropFillOpaque: string
        }
    }
    modelMenuHoverBackground: string
    palette: LixpiCanvasPalette
}

export type WorkspaceCanvasControlsOptions = {
    controls?: boolean
}

export type WorkspaceCanvasControlsPorts = {
    document: Document
    createDocument: () => Promise<void>
    uploadFile: (file: File) => Promise<void>
    importUrl: (url: string) => Promise<void>
    reportError: (error: unknown) => void
}

export class WorkspaceCanvasControls {
    readonly element: HTMLElement
    readonly pane: HTMLDivElement
    readonly viewportMount: HTMLDivElement
    readonly mediaModeSwitchMount: HTMLDivElement
    readonly modelMenuControlMount: HTMLDivElement
    readonly conversationControls?: {
        left: HTMLElement
        right: HTMLElement
    }
    private readonly html: ReturnType<typeof createDocumentHtml>
    private readonly promptControls: WorkspacePromptControlRail
    private readonly actions: ActionPanelInstance | null
    private readonly imageWrapper: HTMLDivElement | null
    private readonly imageButton: HTMLButtonElement | null
    private readonly fileInput: HTMLInputElement | null
    private readonly zoomIndicator: HTMLSpanElement | null
    private menuOpen = false
    private menuMode: 'menu' | 'url' = 'menu'
    private imageUrl = ''
    private releaseOutsideClick: (() => void) | null = null
    private disposed = false

    constructor(
        settings: WorkspaceCanvasControlsSettings,
        private readonly ports: WorkspaceCanvasControlsPorts,
        options: WorkspaceCanvasControlsOptions = {},
    ) {
        const html = (this.html = createDocumentHtml(ports.document))
        this.viewportMount = html`<div className="workspace-viewport-mount"></div>` as HTMLDivElement
        this.pane = html`<div className="workspace-pane">${this.viewportMount}</div>` as HTMLDivElement
        this.promptControls = new WorkspacePromptControlRail({
            document: ports.document,
            modelMenuHoverBackground: settings.modelMenuHoverBackground,
        })
        this.mediaModeSwitchMount = this.promptControls.mediaModeSwitchMount
        this.modelMenuControlMount = this.promptControls.modelMenuControlMount

        if (options.controls === false) {
            this.zoomIndicator = null
            this.fileInput = null
            this.imageButton = null
            this.imageWrapper = null
            this.actions = null
            this.element = html`<div className="workspace-canvas">${this.pane}</div>` as HTMLElement
            this.applySettings(settings)

            return
        }

        this.zoomIndicator = html`<span className="workspace-zoom-indicator"></span>` as HTMLSpanElement
        this.fileInput = html`
            <input
                type="file"
                accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.ppt,.pptx,.odt,.rtf,.txt,.md"
                style="display: none"
                onchange=${this.onFileChange}
            />
        ` as HTMLInputElement
        const actions = createActionPanel({
            document: ports.document,
            className: 'workspace-canvas-action-panel-left',
        })
        this.actions = actions
        this.imageButton = actions.createButton({
            iconSvg: imageIcon,
            ariaLabel: 'Add Image',
            onClick: this.toggleUploadMenu,
        })
        this.imageWrapper = html`<div className="workspace-floating-toolbar-image-wrapper">${this.imageButton}</div>` as HTMLDivElement
        actions.element.append(
            actions.createButton({
                iconSvg: createNewFileIcon,
                ariaLabel: 'New Document',
                onClick: () => void this.invoke(ports.createDocument),
            }),
            this.imageWrapper,
        )
        const controls = this.promptControls.element
        const leftControls = html`<div className="workspace-canvas-left-control-rail">${actions.element}</div>` as HTMLDivElement
        this.conversationControls = {
            left: leftControls,
            right: controls,
        }
        this.element = html`
            <div className="workspace-canvas">
                ${leftControls}
                ${controls}${this.fileInput}${this.zoomIndicator}${this.pane}
            </div>
        ` as HTMLElement
        this.applySettings(settings)
        this.setZoom(1)
    }

    setZoom(zoom: number): void {
        if (
            !this.disposed
            && Number.isFinite(zoom)
            && this.zoomIndicator
        )
            this.zoomIndicator.textContent = `${Math.round(zoom * 100)}%`
    }

    setRightPanelOpen(open: boolean): void {
        if (!this.disposed)
            this.element.classList.toggle('workspace-canvas-right-side-panel-open', open)
    }

    closeUploadMenu(): void {
        if (this.disposed)
            return

        this.menuOpen = false
        this.menuMode = 'menu'
        this.imageUrl = ''
        this.renderUploadMenu()
    }

    destroy(): void {
        if (this.disposed)
            return

        this.disposed = true
        this.promptControls.destroy()
        this.actions?.destroy()
        this.releaseOutsideClick?.()
        this.releaseOutsideClick = null
        this.element.remove()
    }

    private applySettings({
        panel,
        palette,
    }: WorkspaceCanvasControlsSettings): void {
        const hsl = rgbToHsl(
            parseHexColor(palette.nightBlue),
        )
        const properties = {
            '--workspace-right-side-panel-width': `min(${panel.defaultDimensions.width}px, calc(100vw - ${panel.dimensions.maxPaneMargin}px))`,
            '--side-panel-backdrop-width': 'var(--workspace-right-side-panel-width)',
            '--workspace-right-side-panel-content-inset': `${panel.layout.contentInset}px`,
            '--workspace-right-sidebar-content-font-size': `${panel.typography.contentFontSize}px`,
            '--workspace-right-sidebar-tag-pill-font-size': `${panel.typography.tagPillFontSize}px`,
            '--workspace-right-sidebar-tag-pill-font-weight': String(panel.typography.tagPillFontWeight),
            '--side-panel-backdrop-fill': panel.styles.backdropFill,
            '--side-panel-backdrop-fill-opaque': panel.styles.backdropFillOpaque,
            '--workspace-controls-steel-blue': palette.steelBlue,
            '--workspace-controls-night-blue': palette.nightBlue,
            '--workspace-controls-off-white': palette.offWhite,
            '--workspace-controls-insert-hover': rgbToHex(
                hslToRgb({
                    ...hsl,
                    l: Math.max(0, hsl.l - 0.05),
                }),
            ),
        }

        for (const [name, value] of Object.entries(properties))
            this.element.style.setProperty(name, value)
    }

    private async invoke(action: () => Promise<void>): Promise<void> {
        if (this.disposed)
            return

        try {
            await action()
        } catch (error) {
            if (!this.disposed)
                this.ports.reportError(error)
        }
    }

    private readonly onFileChange = (): void => {
        if (!this.fileInput)
            return

        if (this.disposed)
            return

        const file = this.fileInput.files?.[0]

        if (!file)
            return

        this.closeUploadMenu()
        this.fileInput.value = ''
        void this.invoke(() => this.ports.uploadFile(file))
    }

    private readonly toggleUploadMenu = (): void => {
        if (this.disposed)
            return

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
        const {
            imageButton,
            imageWrapper,
            fileInput,
        } = this

        if (
            !imageButton
            || !imageWrapper
            || !fileInput
        )
            return

        const html = this.html
        imageButton.classList.toggle('active', this.menuOpen)
        imageWrapper.querySelector('.workspace-image-submenu')?.remove()
        this.releaseOutsideClick?.()
        this.releaseOutsideClick = null

        if (!this.menuOpen)
            return

        let menu: HTMLElement

        if (this.menuMode === 'menu') {
            menu = html`
                <div className="workspace-image-submenu">
                    <button
                        className="workspace-image-submenu-option"
                        onclick=${() => {
                            if (!this.disposed)
                                fileInput.click()
                        }}
                    >Upload from Device</button>
                    <button
                        className="workspace-image-submenu-option"
                        onclick=${() => {
                            if (this.disposed)
                                return

                            this.menuMode = 'url'
                            this.renderUploadMenu()
                        }}
                    >Paste Image URL</button>
                </div>
            ` as HTMLElement
        } else {
            const input = html`
                <input
                    type="url"
                    className="workspace-image-submenu-url-input"
                    placeholder="https://example.com/image.jpg"
                    onkeydown=${(event: KeyboardEvent) => {
                        if (event.key === 'Enter')
                            this.submitUrl()
                    }}
                    oninput=${(event: Event) => void (this.imageUrl = (event.target as HTMLInputElement).value)}
                />
            ` as HTMLInputElement
            input.value = this.imageUrl
            menu = html`
                <div className="workspace-image-submenu">
                    <div className="workspace-image-submenu-url-form">
                        ${input}
                        <div className="workspace-image-submenu-url-actions">
                            <button
                                className="workspace-image-submenu-url-back"
                                onclick=${() => {
                                    if (this.disposed)
                                        return

                                    this.menuMode = 'menu'
                                    this.renderUploadMenu()
                                }}
                            >Back</button>
                            <button
                                className="workspace-image-submenu-url-insert"
                                onclick=${this.submitUrl}
                            >Add</button>
                        </div>
                    </div>
                </div>
            ` as HTMLElement
        }

        imageWrapper.append(menu)
        const outsideClick = (event: MouseEvent) => {
            const target = event.target
            const NodeType = this.ports.document.defaultView?.Node

            if (
                NodeType
                && target instanceof NodeType
                && this.ports.document.contains(target)
                && !imageWrapper.contains(target)
            )
                this.closeUploadMenu()
        }
        const timer = setTimeout(() => this.ports.document.addEventListener('click', outsideClick), 0)
        this.releaseOutsideClick = () => {
            clearTimeout(timer)
            this.ports.document.removeEventListener('click', outsideClick)
        }
    }
}
