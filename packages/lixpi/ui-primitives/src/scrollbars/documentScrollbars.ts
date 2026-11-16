import overlayScrollbarsCss from 'overlayscrollbars/overlayscrollbars.css?raw'
import {
    ClickScrollPlugin,
    OverlayScrollbars,
    type PartialOptions,
} from 'overlayscrollbars'
import { createDocumentHtml } from '../dom/document-template.ts'
import { applyCssCustomProperties } from '../dom/elementPresentation.ts'

// The library stylesheet sits in a cascade layer, so any application rule wins
// over its generic defaults whatever order the bundles load in. A scroll
// container that is absolutely positioned keeps that position instead of
// taking the library's `position: relative` host rule.
const LAYERED_LIBRARY_CSS = `@layer overlayscrollbars {\n${overlayScrollbarsCss}\n}`

// Theme class OverlayScrollbars adds to every scrollbar it renders. The shared
// stylesheet at `@lixpi/ui-primitives/styles/scrollbars` styles it.
export const SCROLLBAR_THEME_CLASS = 'lixpi-scrollbar'

// Subtree policy for custom scrollbars. `off` leaves an element and its
// descendants without a custom scrollbar. `auto` marks a subtree whose owner
// accepts the DOM changes a scrollbar makes, which is required inside editable
// content (see `isPolicyAllowed`).
export const SCROLLBAR_POLICY_ATTRIBUTE = 'data-scrollbars'

export type ScrollbarPolicy = 'auto' | 'off'

export type DocumentScrollbarsLease = {
    release: () => void
}

type AxisOverflow = 'hidden' | 'scroll' | 'visible'

type ScrollOverflow = {
    x: AxisOverflow
    y: AxisOverflow
}

type SelectionSnapshot = {
    anchorNode: Node
    anchorOffset: number
    focusNode: Node
    focusOffset: number
}

type ScrollOffset = {
    left: number
    top: number
}

const SCROLLABLE_OVERFLOW_VALUES = new Set([
    'auto',
    'scroll',
    'overlay',
])
const HIDDEN_OVERFLOW_VALUES = new Set([
    'hidden',
    'clip',
])
// OverlayScrollbars cannot host its scrollbars in these elements. The document
// root is handled separately through `body`.
const UNSUPPORTED_TAG_NAMES = new Set([
    'HTML',
    'BODY',
    'TEXTAREA',
    'INPUT',
    'SELECT',
    'IFRAME',
])
const DISCOVERY_EVENTS = [
    'pointerover',
    'wheel',
    'focusin',
    'scroll',
] as const
const AUTO_HIDE_DELAY_MS = 800

const toAxisOverflow = (value: string): AxisOverflow | null => {
    if (SCROLLABLE_OVERFLOW_VALUES.has(value))
        return 'scroll'

    if (HIDDEN_OVERFLOW_VALUES.has(value))
        return 'hidden'

    return value === 'visible' ? 'visible' : null
}

const readScrollOverflow = (element: Element): ScrollOverflow | null => {
    const view = element.ownerDocument.defaultView

    if (!view)
        return null

    const style = view.getComputedStyle(element)

    // A container that hides its own scrollbar while keeping scrolling stays
    // that way; the overlay never replaces a deliberately hidden bar.
    if (style.getPropertyValue('scrollbar-width') === 'none')
        return null

    const x = toAxisOverflow(style.overflowX)
    const y = toAxisOverflow(style.overflowY)

    if (
        x === null
        || y === null
        || (x !== 'scroll' && y !== 'scroll')
    )
        return null

    return {
        x,
        y,
    }
}

// The viewport scrolls when neither the root element nor body clips it. Body
// overflow only reaches the viewport when the root element leaves it visible.
const readDocumentOverflow = (document: Document): ScrollOverflow | null => {
    const view = document.defaultView

    if (!view)
        return null

    const root = view.getComputedStyle(document.documentElement)
    const body = view.getComputedStyle(document.body)
    const axis = (rootValue: string, bodyValue: string): AxisOverflow =>
        HIDDEN_OVERFLOW_VALUES.has(rootValue) || HIDDEN_OVERFLOW_VALUES.has(bodyValue) ? 'hidden' : 'scroll'
    const x = axis(root.overflowX, body.overflowX)
    const y = axis(root.overflowY, body.overflowY)

    if (x === 'hidden' && y === 'hidden')
        return null

    return {
        x,
        y,
    }
}

// Inside editable content the editor owns every node, and a scrollbar would
// insert elements and attributes the editor treats as document edits. The
// nearest `data-scrollbars` marker or `contenteditable` boundary decides: an
// editor marks the regions it ignores mutations in with `auto`.
const isPolicyAllowed = (element: Element): boolean => {
    const marker = element.closest(`[${SCROLLBAR_POLICY_ATTRIBUTE}]`)
    const editable = element.closest('[contenteditable]')

    if (marker?.getAttribute(SCROLLBAR_POLICY_ATTRIBUTE) === 'off')
        return false

    if (!editable)
        return true

    return marker !== null && (marker === editable || editable.contains(marker))
}

const captureSelection = (document: Document, element: Element): SelectionSnapshot | null => {
    const selection = document.getSelection()

    if (
        !selection?.anchorNode
        || !selection.focusNode
        || !element.contains(selection.anchorNode)
    )
        return null

    return {
        anchorNode: selection.anchorNode,
        anchorOffset: selection.anchorOffset,
        focusNode: selection.focusNode,
        focusOffset: selection.focusOffset,
    }
}

const restoreSelection = (document: Document, snapshot: SelectionSnapshot | null): void => {
    const selection = document.getSelection()

    if (
        !snapshot
        || !selection
        || !snapshot.anchorNode.isConnected
        || !snapshot.focusNode.isConnected
    )
        return

    if (
        selection.anchorNode === snapshot.anchorNode
        && selection.anchorOffset === snapshot.anchorOffset
        && selection.focusNode === snapshot.focusNode
        && selection.focusOffset === snapshot.focusOffset
    )
        return

    selection.setBaseAndExtent(
        snapshot.anchorNode,
        snapshot.anchorOffset,
        snapshot.focusNode,
        snapshot.focusOffset,
    )
}

const createScrollbarOptions = (overflow: ScrollOverflow): PartialOptions => ({
    overflow,
    scrollbars: {
        theme: SCROLLBAR_THEME_CLASS,
        // Visible only while the container scrolls or its thumb is dragged.
        autoHide: 'scroll',
        autoHideDelay: AUTO_HIDE_DELAY_MS,
        clickScroll: true,
    },
})

// OverlayScrollbars normally puts the scrollbars inside the container and
// moves them with a transform equal to the scroll offset. A transformed child
// counts toward the container's scroll height, so shrinking content would keep
// its old height as blank space. The scrollbars live instead in a zero-size
// sticky slot at the start of the container: the browser pins the slot to the
// visible area, and a sticky offset never grows the scrollable area.
//
// The slot is the container's first child. Containers whose layout would move
// or space out an extra first child (grid, reversed or distributed flex) keep
// the library's own placement.
class ScrollbarAttachment {
    private readonly slot: HTMLElement | null
    private readonly childObserver: MutationObserver | null = null
    private readonly resizeObserver: ResizeObserver | null = null

    constructor(
        private readonly element: HTMLElement,
        private readonly style: CSSStyleDeclaration,
        createInstance: (slot: HTMLElement | null) => OverlayScrollbars,
    ) {
        this.slot = supportsStickySlot(style) ? createDocumentHtml(element.ownerDocument)`<div className=${SCROLLBAR_SLOT_CLASS}></div>` as HTMLElement : null

        if (this.slot) {
            element.prepend(this.slot)
            this.applySlotFlexCompensation()
        }

        this.instance = createInstance(this.slot)

        if (!this.slot)
            return

        const view = element.ownerDocument.defaultView
        const MutationObserverConstructor = view?.MutationObserver
        const ResizeObserverConstructor = view?.ResizeObserver
        this.childObserver = MutationObserverConstructor ? new MutationObserverConstructor(this.keepSlotFirst) : null
        this.childObserver?.observe(
            element,
            { childList: true },
        )
        this.resizeObserver = ResizeObserverConstructor ? new ResizeObserverConstructor(this.measure) : null
        this.resizeObserver?.observe(element)
        this.measure()
    }

    readonly instance: OverlayScrollbars

    destroy = (): void => {
        this.childObserver?.disconnect()
        this.resizeObserver?.disconnect()
        this.instance.destroy()
        this.slot?.remove()
    }

    // Applications replace or prepend children freely; the slot returns to
    // the front so the scrollbars stay pinned to the visible area.
    private keepSlotFirst = (): void => {
        if (
            !this.slot
            || this.element.firstChild === this.slot
        )
            return

        this.element.prepend(this.slot)
        this.childObserver?.takeRecords()
    }

    private measure = (): void => {
        if (!this.slot)
            return

        applyCssCustomProperties(
            this.slot,
            {
                '--lixpi-scrollbar-viewport-width': `${this.element.clientWidth}px`,
                '--lixpi-scrollbar-viewport-height': `${this.element.clientHeight}px`,
                '--lixpi-scrollbar-slot-top': this.style.paddingTop,
                '--lixpi-scrollbar-slot-left': this.style.paddingLeft,
            },
        )
    }

    // A flex gap would open after the slot like after any item.
    private applySlotFlexCompensation(): void {
        if (
            !this.slot
            || !this.style.display.endsWith('flex')
        )
            return

        const column = this.style.flexDirection === 'column'
        const gap = column ? this.style.rowGap : this.style.columnGap

        if (
            gap
            && gap !== 'normal'
            && gap !== '0px'
        )
            this.slot.style.setProperty(column ? 'margin-bottom' : 'margin-right', `calc(-1 * ${gap})`)
    }
}

const SCROLLBAR_SLOT_CLASS = 'lixpi-scrollbar-slot'
const SLOT_COMPATIBLE_JUSTIFY_CONTENT = new Set([
    'normal',
    'flex-start',
    'start',
    'stretch',
])

const supportsStickySlot = (style: CSSStyleDeclaration): boolean => {
    if (
        style.display === 'block'
        || style.display === 'flow-root'
        || style.display === 'list-item'
    )
        return true

    if (!style.display.endsWith('flex'))
        return false

    return (style.flexDirection === 'column' || style.flexDirection === 'row') && SLOT_COMPATIBLE_JUSTIFY_CONTENT.has(style.justifyContent)
}

// Replaces the native scrollbar of every scroll container in a document with
// an OverlayScrollbars overlay. Containers are discovered when the pointer,
// wheel, focus or scrolling first reaches them, so new UI needs no setup. The
// container itself becomes the OverlayScrollbars viewport, which keeps its
// layout and class contracts; only absolutely positioned scrollbar elements
// are added inside it.
class DocumentScrollbars {
    private readonly instances = new Map<HTMLElement, ScrollbarAttachment>()
    private readonly warnedEditableElements = new WeakSet<Element>()
    private readonly removalObserver: MutationObserver | null
    private readonly stylesheet: HTMLStyleElement
    private rootInstance: OverlayScrollbars | null = null
    private lastDiscoveryTarget: EventTarget | null = null
    private sweepFrame: number | null = null

    constructor(private readonly document: Document) {
        OverlayScrollbars.plugin(ClickScrollPlugin)
        const html = createDocumentHtml(document)
        this.stylesheet = html`<style textContent=${LAYERED_LIBRARY_CSS}></style>` as HTMLStyleElement
        document.head.append(this.stylesheet)

        for (const type of DISCOVERY_EVENTS)
            document.addEventListener(
                type,
                this.handleDiscoveryEvent,
                {
                    capture: true,
                    passive: true,
                },
            )

        const MutationObserverConstructor = document.defaultView?.MutationObserver
        this.removalObserver = MutationObserverConstructor ? new MutationObserverConstructor(this.scheduleSweep) : null
        this.removalObserver?.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true,
            },
        )
    }

    private attach(element: HTMLElement): void {
        if (
            this.instances.has(element)
            || UNSUPPORTED_TAG_NAMES.has(element.tagName)
            || !element.isConnected
            || OverlayScrollbars(element) !== undefined
        )
            return

        const overflow = readScrollOverflow(element)

        if (!overflow)
            return

        if (!isPolicyAllowed(element)) {
            this.warnSkippedEditableElement(element)

            return
        }

        // Initialization re-appends the container's children, which collapses
        // any selection inside them and can clamp the scroll offset.
        const selection = captureSelection(this.document, element)
        const offset: ScrollOffset = {
            left: element.scrollLeft,
            top: element.scrollTop,
        }
        const style = this.document.defaultView?.getComputedStyle(element)

        if (!style)
            return

        const attachment = new ScrollbarAttachment(
            element,
            style,
            slot => OverlayScrollbars(
                {
                    target: element,
                    elements: {
                        viewport: element,
                        padding: false,
                        content: false,
                    },
                    scrollbars: { slot: slot ?? undefined },
                },
                createScrollbarOptions(overflow),
            ),
        )
        element.scrollLeft = offset.left
        element.scrollTop = offset.top
        restoreSelection(this.document, selection)
        this.instances.set(element, attachment)
    }

    destroy = (): void => {
        for (const type of DISCOVERY_EVENTS)
            this.document.removeEventListener(
                type,
                this.handleDiscoveryEvent,
                { capture: true },
            )

        this.removalObserver?.disconnect()

        if (this.sweepFrame !== null)
            this.document.defaultView?.cancelAnimationFrame(this.sweepFrame)

        this.sweepFrame = null

        for (const attachment of this.instances.values())
            attachment.destroy()

        this.instances.clear()
        this.rootInstance?.destroy()
        this.rootInstance = null
        this.lastDiscoveryTarget = null
        this.stylesheet.remove()
    }

    // The page scrollbar attaches once the page itself scrolls. Measuring the
    // page on every pointer event would force a layout each time.
    private attachDocumentRoot(): void {
        const root = this.document.scrollingElement

        if (
            this.rootInstance
            || !this.document.body
            || !root
            || (root.scrollHeight <= root.clientHeight && root.scrollWidth <= root.clientWidth)
        )
            return

        const overflow = readDocumentOverflow(this.document)

        if (!overflow)
            return

        this.rootInstance = OverlayScrollbars(
            {
                target: this.document.body,
                cancel: { body: null },
            },
            createScrollbarOptions(overflow),
        )
    }

    // Pointer and wheel events repeat on the same element; only a new target
    // can reveal a scroll container that has not been attached yet.
    private handleDiscoveryEvent = (event: Event): void => {
        const target = event.target

        if (
            event.type !== 'scroll'
            && target === this.lastDiscoveryTarget
        )
            return

        this.lastDiscoveryTarget = target

        if (
            !target
            || !('nodeType' in target)
        )
            return

        if ((target as Node).nodeType !== 1) {
            if (target === this.document)
                this.attachDocumentRoot()

            return
        }

        let element: Element | null = target as Element

        while (
            element
            && element !== this.document.body
            && element !== this.document.documentElement
        ) {
            if (this.isHtmlElement(element))
                this.attach(element)

            element = element.parentElement
        }
    }

    private isHtmlElement(element: Element): element is HTMLElement {
        const HTMLElementConstructor = this.document.defaultView?.HTMLElement

        return HTMLElementConstructor !== undefined && element instanceof HTMLElementConstructor
    }

    private scheduleSweep = (): void => {
        if (
            this.sweepFrame !== null
            || this.instances.size === 0
        )
            return

        const view = this.document.defaultView

        if (!view)
            return

        this.sweepFrame = view.requestAnimationFrame(this.sweepDisconnected)
    }

    // A container that leaves the document keeps its observers until its
    // instance is destroyed. Checking after a frame lets moved elements stay.
    private sweepDisconnected = (): void => {
        this.sweepFrame = null

        for (const [element, attachment] of this.instances) {
            if (element.isConnected)
                continue

            attachment.destroy()
            this.instances.delete(element)
        }
    }

    private warnSkippedEditableElement(element: Element): void {
        if (this.warnedEditableElements.has(element))
            return

        this.warnedEditableElements.add(element)
        console.warn(
            `Custom scrollbar skipped for a scroll container inside editable content. Mark the region ${SCROLLBAR_POLICY_ATTRIBUTE}="auto" once its owner ignores DOM mutations there.`,
            element,
        )
    }
}

type DocumentScrollbarsEntry = {
    controller: DocumentScrollbars
    leases: number
}

const documentEntries = new WeakMap<Document, DocumentScrollbarsEntry>()

class DocumentScrollbarsLeaseHandle implements DocumentScrollbarsLease {
    private released = false

    constructor(
        private readonly document: Document,
        private readonly entry: DocumentScrollbarsEntry,
    ) {
        entry.leases += 1
    }

    release = (): void => {
        if (this.released)
            return

        this.released = true
        this.entry.leases -= 1

        if (this.entry.leases > 0)
            return

        this.entry.controller.destroy()
        documentEntries.delete(this.document)
    }
}

// One controller serves each document. Every application bootstrap acquires
// a lease; the controller is destroyed when the last lease is released.
export const acquireDocumentScrollbars = (document: Document): DocumentScrollbarsLease => {
    const entry = documentEntries.get(document) ?? {
        controller: new DocumentScrollbars(document),
        leases: 0,
    }
    documentEntries.set(document, entry)

    return new DocumentScrollbarsLeaseHandle(
        document,
        entry,
    )
}
