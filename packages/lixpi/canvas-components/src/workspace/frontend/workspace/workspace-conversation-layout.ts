import {
    applyStyle,
    createDocumentHtml,
    ElementStyleLease,
} from '@lixpi/ui-primitives/dom'
import {
    BubbleMenu,
    BubbleMenuDropdown,
} from '@lixpi/ui-kit/components/bubble-menu'
import {
    createSidePanel,
    type SidePanelInstance,
} from '@lixpi/ui-kit/components/side-panel'
import { uiKitSettings } from '@lixpi/ui-kit'
import {
    alignCenterIcon,
    alignLeftIcon,
    alignRightIcon,
    videoFullscreenExitGlyphIcon,
    dragIcon,
} from '@lixpi/ui-kit/svg'
import {
    type ViewportSnapshot,
} from '@lixpi/canvas-engine/shared'
import {
    type WorkspaceRightPanelSettings,
} from './workspace-right-panel.ts'

export type WorkspaceConversationLayoutMode = 'center' | 'left' | 'right' | 'detached'

export type WorkspaceConversationControls = {
    left: HTMLElement
    right: HTMLElement
}

type LayoutState = {
    mode: WorkspaceConversationLayoutMode
    width: number
    position: {
        x: number
        y: number
    } | null
}

type LayoutOptions = {
    pane: HTMLElement
    element: HTMLElement
    controls?: WorkspaceConversationControls
    storage: Pick<Storage, 'getItem' | 'setItem'>
    settings: Pick<WorkspaceRightPanelSettings, 'dimensions'>
    getViewport: () => ViewportSnapshot
}

const storageKey = 'lixpi:conversation-layout'
const changeEvent = 'lixpi:conversation-layout-change'
const defaultWidth = 760
const paneInset = 24
const modes: {
    mode: WorkspaceConversationLayoutMode
    label: string
    icon: string
}[] = [
    {
        mode: 'center',
        label: 'Center',
        icon: alignCenterIcon,
    },
    {
        mode: 'left',
        label: 'Left',
        icon: alignLeftIcon,
    },
    {
        mode: 'right',
        label: 'Right',
        icon: alignRightIcon,
    },
    {
        mode: 'detached',
        label: 'Detached',
        icon: videoFullscreenExitGlyphIcon,
    },
]

const defaultState = (): LayoutState => ({
    mode: 'center',
    width: defaultWidth,
    position: null,
})

export class WorkspaceConversationLayout {
    private readonly document: Document
    private readonly window: Window
    private readonly header: HTMLElement
    private readonly moveHandle: HTMLButtonElement
    private readonly selector: BubbleMenuDropdown<WorkspaceConversationLayoutMode>
    private readonly toolbar: BubbleMenu
    private readonly controls: HTMLElement
    private readonly resizeHandles = new Map<'left' | 'right', SidePanelInstance>()
    private readonly borrowedControls: {
        element: HTMLElement
        parent: ParentNode
        next: ChildNode | null
    }[] = []
    private readonly observer: ResizeObserver
    private readonly styles: ElementStyleLease
    private readonly releaseResizeKeys: (() => void)[] = []
    private state: LayoutState
    private renderedWidth = defaultWidth
    private resizing: {
        width: number
        x: number
    } | null = null
    private releaseDrag: (() => void) | null = null
    private destroyed = false

    constructor(private readonly options: LayoutOptions) {
        this.document = options.element.ownerDocument
        this.window = this.document.defaultView!
        this.state = this.readState()
        this.styles = new ElementStyleLease(
            options.element,
            Object.fromEntries(
                ['width', 'max-width', 'max-height', 'left', 'right', 'top', 'bottom', 'transform', 'transform-origin'].map(
                    property => [
                        property,
                        options.element.style.getPropertyValue(property),
                    ],
                ),
            ),
        )
        const html = createDocumentHtml(this.document)
        this.moveHandle = html`
            <button
                type="button"
                className="bubble-menu-button workspace-conversation-layout-move"
                aria-label="Move chat"
                aria-description="Drag to move the chat on the canvas, or use the arrow keys."
                data-help-tooltip="aria-description"
                onpointerdown=${this.startDrag}
                onkeydown=${this.moveWithKeyboard}
                innerHTML=${dragIcon}
            ></button>
        ` as HTMLButtonElement
        this.selector = new BubbleMenuDropdown({
            document: this.document,
            label: 'Chat layout',
            value: this.state.mode,
            options: modes.map(
                ({
                    mode,
                    label,
                    icon,
                }) => ({
                    value: mode,
                    label,
                    icon,
                }),
            ),
            onChange: mode => this.setMode(mode),
            getBounds: () => this.options.pane.getBoundingClientRect(),
            getScale: this.getScale,
        })
        this.header = html`<div className="workspace-conversation-layout-header"></div>` as HTMLElement
        this.toolbar = new BubbleMenu({
            parentEl: this.header,
            inline: true,
            label: 'Chat layout controls',
            items: [
                {
                    element: this.moveHandle,
                    context: ['layout'],
                },
                {
                    element: this.selector.element,
                    context: ['layout'],
                },
            ],
        })
        this.controls = html`<div className="workspace-conversation-layout-controls"></div>` as HTMLElement

        for (const element of Object.values(options.controls ?? {})) {
            if (element.parentNode)
                this.borrowedControls.push({
                    element,
                    parent: element.parentNode,
                    next: element.nextSibling,
                })

            this.controls.append(element)
        }

        options.element.classList.add('workspace-conversation-layout')
        options.element.prepend(this.header)
        options.element.append(this.controls)
        options.element.addEventListener('pointerdown', this.stopPropagation)
        options.element.addEventListener('wheel', this.handleWheel)
        this.window.addEventListener('storage', this.onStorage)
        this.window.addEventListener(changeEvent, this.readGlobalChange)

        for (const edge of ['left', 'right'] as const) {
            const handle = createSidePanel({
                root: options.element,
                side: edge === 'left' ? 'right' : 'left',
                ...uiKitSettings.applicationPanel.resizeHandle,
                className: 'workspace-conversation-layout-resize',
                minWidth: options.settings.dimensions.minWidth,
                defaultWidth,
                getMaxWidth: this.getMaxWidth,
                mapResizeDelta: delta => delta * (this.state.mode === 'center' ? 2 : 1) / this.getScale(),
                onResizeStart: () => {
                    this.selector.hide()
                    this.resizing = {
                        width: this.renderedWidth,
                        x: this.state.position?.x ?? 0,
                    }
                },
                onResize: width => this.resize(edge, width),
                onResizeEnd: () => {
                    this.resizing = null
                    this.persist()
                },
            })
            handle.element.role = 'separator'
            handle.element.ariaOrientation = 'vertical'
            handle.element.ariaLabel = `Resize chat from ${edge}`
            handle.element.tabIndex = 0
            const resizeKey = (event: KeyboardEvent): void => void this.resizeWithKeyboard(edge, event)
            handle.element.addEventListener('keydown', resizeKey)
            this.releaseResizeKeys.push(() => handle.element.removeEventListener('keydown', resizeKey))
            this.resizeHandles.set(edge, handle)
            options.element.append(handle.element)
        }

        this.observer = new ResizeObserver(() => this.refresh())
        this.observer.observe(options.pane)

        this.refresh()
    }

    setMode(mode: WorkspaceConversationLayoutMode): void {
        if (
            this.destroyed
            || !modes.some(option => option.mode === mode)
        )
            return

        this.releaseDrag?.()
        this.selector.hide()

        if (
            mode === 'detached'
            && !this.state.position
        ) {
            const rect = this.options.element.getBoundingClientRect()
            const pane = this.options.pane.getBoundingClientRect()
            const viewport = this.options.getViewport()
            this.state.position = {
                x: (rect.left - pane.left - viewport.x) / viewport.zoom,
                y: (rect.top - pane.top - viewport.y) / viewport.zoom,
            }
        }

        this.state.mode = mode
        this.refresh()
        this.persist()
    }

    refresh(): void {
        if (this.destroyed)
            return

        const {
            element,
            pane,
        } = this.options
        element.dataset.conversationLayout = this.state.mode
        this.renderedWidth = Math.min(
            Math.max(this.options.settings.dimensions.minWidth, this.state.width),
            this.getMaxWidth(),
        )
        this.moveHandle.hidden = this.state.mode !== 'detached'
        applyStyle(
            element,
            {
                width: `${this.renderedWidth}px`,
                maxWidth: 'none',
                maxHeight: `${Math.max(0, pane.clientHeight - paneInset)}px`,
            },
        )

        for (const [edge, handle] of this.resizeHandles) {
            handle.setWidth(this.renderedWidth, { silent: true })
            handle.element.hidden = this.state.mode === edge
            handle.element.ariaValueMin = String(
                Math.min(
                    this.options.settings.dimensions.minWidth,
                    this.getMaxWidth(),
                ),
            )
            handle.element.ariaValueMax = String(
                this.getMaxWidth(),
            )
            handle.element.ariaValueNow = String(
                Math.round(this.renderedWidth),
            )
        }

        this.selector.setValue(this.state.mode)

        this.updateViewport(true)
    }

    updateViewport(refreshDocked = false): void {
        if (
            this.destroyed
            || (!refreshDocked && this.state.mode !== 'detached')
        )
            return

        const { element } = this.options
        const { mode } = this.state

        if (mode === 'detached') {
            const viewport = this.options.getViewport()

            if (!this.state.position)
                this.state.position = {
                    x: ((this.options.pane.clientWidth - this.renderedWidth * viewport.zoom) / 2 - viewport.x) / viewport.zoom,
                    y: (paneInset - viewport.y) / viewport.zoom,
                }

            applyStyle(
                element,
                {
                    left: '0px',
                    right: 'auto',
                    top: '0px',
                    bottom: 'auto',
                    transform: `translate(${viewport.x + this.state.position.x * viewport.zoom}px, ${viewport.y + this.state.position.y * viewport.zoom}px) scale(${viewport.zoom})`,
                    transformOrigin: 'top left',
                },
            )
        } else {
            applyStyle(
                element,
                {
                    left: mode === 'right'
                        ? 'auto'
                        : mode === 'left'
                            ? '0px'
                            : '50%',
                    right: mode === 'right' ? '0px' : 'auto',
                    top: '0px',
                    bottom: `${paneInset}px`,
                    transform: mode === 'center' ? 'translateX(-50%)' : 'none',
                    transformOrigin: 'top left',
                },
            )
        }

        if (this.selector.isOpen)
            this.selector.reposition()
    }

    private getScale = (): number => (this.state.mode === 'detached' ? this.options.getViewport().zoom : 1)

    private getMaxWidth = (): number => Math.max(0, this.options.pane.clientWidth - paneInset * 2)

    private resize(
        edge: 'left' | 'right',
        width: number,
    ): void {
        if (
            this.state.mode === 'detached'
            && edge === 'left'
            && this.state.position
        )
            this.state.position.x = (this.resizing?.x ?? this.state.position.x) + (this.resizing?.width ?? this.renderedWidth) - width

        this.state.width = width
        this.refresh()
    }

    private resizeWithKeyboard(
        edge: 'left' | 'right',
        event: KeyboardEvent,
    ): void {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key))
            return

        event.preventDefault()
        event.stopPropagation()
        const direction = (event.key === 'ArrowRight' ? 1 : -1) * (edge === 'right' ? 1 : -1)
        const width = Math.min(
            this.getMaxWidth(),
            Math.max(this.options.settings.dimensions.minWidth, this.renderedWidth + direction * 10),
        )
        this.resize(edge, width)
        this.persist()
    }

    private startDrag = (event: PointerEvent): void => {
        if (
            event.button !== 0
            || this.state.mode !== 'detached'
            || !this.state.position
        )
            return

        event.preventDefault()
        event.stopPropagation()
        this.releaseDrag?.()
        this.selector.hide()
        const start = { ...this.state.position }
        const viewport = this.options.getViewport()
        const lease = new ElementStyleLease(
            this.document.body,
            {
                cursor: 'grabbing',
                'user-select': 'none',
            },
        )
        const move = (next: PointerEvent): void => {
            if (next.pointerId !== event.pointerId)
                return

            this.state.position = {
                x: start.x + (next.clientX - event.clientX) / viewport.zoom,
                y: start.y + (next.clientY - event.clientY) / viewport.zoom,
            }
            this.updateViewport()
        }
        const finish = (): void => {
            this.releaseDrag?.()
            this.persist()
        }
        const end = (next: PointerEvent): void => {
            if (next.pointerId === event.pointerId)
                finish()
        }
        this.releaseDrag = () => {
            this.releaseDrag = null
            this.document.removeEventListener('pointermove', move)
            this.document.removeEventListener('pointerup', end)
            this.document.removeEventListener('pointercancel', end)
            this.moveHandle.removeEventListener('lostpointercapture', finish)
            this.window.removeEventListener('blur', finish)

            if (this.moveHandle.hasPointerCapture?.(event.pointerId))
                this.moveHandle.releasePointerCapture(event.pointerId)

            lease.destroy()
        }
        this.document.addEventListener('pointermove', move)
        this.document.addEventListener('pointerup', end)
        this.document.addEventListener('pointercancel', end)
        this.moveHandle.addEventListener('lostpointercapture', finish)
        this.window.addEventListener('blur', finish)
        this.moveHandle.setPointerCapture?.(event.pointerId)
    }

    private moveWithKeyboard = (event: KeyboardEvent): void => {
        if (
            this.state.mode !== 'detached'
            || !this.state.position
        )
            return

        const delta = {
            ArrowLeft: [-10, 0],
            ArrowRight: [10, 0],
            ArrowUp: [0, -10],
            ArrowDown: [0, 10],
        }[event.key]

        if (!delta)
            return

        event.preventDefault()
        event.stopPropagation()
        this.state.position.x += delta[0]
        this.state.position.y += delta[1]
        this.updateViewport()
        this.persist()
    }

    private handleWheel = (event: WheelEvent): void => {
        // Trackpad pinch uses Ctrl+wheel; ordinary wheel input belongs to the chat.
        if (!event.ctrlKey)
            event.stopPropagation()
    }

    private stopPropagation = (event: Event): void => void event.stopPropagation()

    private readState(): LayoutState {
        try {
            const value = JSON.parse(this.options.storage.getItem(storageKey) ?? 'null')

            if (
                !value
                || !modes.some(option => option.mode === value.mode)
            )
                return defaultState()

            return {
                mode: value.mode,
                width: Number.isFinite(value.width)
                    && value.width > 0
                    ? value.width
                    : defaultWidth,
                position: Number.isFinite(value.position?.x)
                    && Number.isFinite(value.position?.y)
                    ? {
                        x: value.position.x,
                        y: value.position.y,
                    }
                    : null,
            }
        } catch {
            return defaultState()
        }
    }

    private persist(): void {
        try {
            this.options.storage.setItem(
                storageKey,
                JSON.stringify(this.state),
            )
            this.window.dispatchEvent(
                new Event(changeEvent),
            )
        } catch {}
    }

    private onStorage = (event: StorageEvent): void => {
        if (
            event.key === storageKey
            || event.key === null
        )
            this.readGlobalChange()
    }

    private readGlobalChange = (): void => {
        const next = this.readState()

        if (JSON.stringify(next) === JSON.stringify(this.state))
            return

        this.state = next
        this.refresh()
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.releaseDrag?.()
        this.observer.disconnect()
        this.window.removeEventListener('storage', this.onStorage)
        this.window.removeEventListener(changeEvent, this.readGlobalChange)
        this.options.element.removeEventListener('pointerdown', this.stopPropagation)
        this.options.element.removeEventListener('wheel', this.handleWheel)
        this.selector.destroy()
        this.toolbar.destroy()

        for (const release of this.releaseResizeKeys)
            release()

        for (const handle of this.resizeHandles.values()) {
            handle.destroy()
            handle.element.remove()
        }

        for (const {
            element,
            parent,
            next,
        } of this.borrowedControls.reverse()) {
            if (next?.parentNode === parent)
                next.before(element)
            else
                parent.append(element)
        }

        this.controls.remove()
        this.header.remove()
        this.options.element.classList.remove('workspace-conversation-layout')
        delete this.options.element.dataset.conversationLayout
        this.styles.destroy()
    }
}
