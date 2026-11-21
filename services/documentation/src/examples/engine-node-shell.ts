import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { createCanvasNodeFooter } from '@lixpi/ui-kit/components/canvas-node-footer'
import {
    checkMarkIcon,
    progressRippleArtwork,
    trashBinIcon,
} from '@lixpi/ui-kit/svg'
import {
    type EngineNode,
    type CanvasViewport,
} from '@lixpi/canvas-engine/shared'
import {
    type MediaDescriptor,
} from '@lixpi/canvas-engine/frontend/media'
import {
    type NodeShellRegistrationOptions,
} from '@lixpi/canvas-components/nodes/shell'
import {
    type CanvasThemeSource,
} from '@lixpi/canvas-components/theme'
import '@lixpi/canvas-components/styles/node-shell'
import '@lixpi/ui-kit/styles/canvas-node-footer'

type ShellNodeData = {
    title: string
    media?: MediaDescriptor
}
type EngineNodeShellOptions = {
    theme: CanvasThemeSource
    enabled: () => boolean
    footerOffset: (
        nodeId: string,
        viewport: CanvasViewport,
    ) => number
    select: (nodeId: string) => void
    remove: (nodeId: string) => void
}

export const createEngineNodeShellOptions = <Data extends ShellNodeData>(options: EngineNodeShellOptions): NodeShellRegistrationOptions<Data> => ({
    enabled: options.enabled,
    getFooterOffsetScreen: (node, viewport) => options.footerOffset(node.nodeId, viewport),
    getSettings: () => ({
        gap: options.theme.value.controls.padding,
        zoomScaling: options.theme.value.connectors.scaling.zoomScaling,
    }),
    title: (host, node) => {
        const update = (current: EngineNode<Data>): void => void (host.textContent = current.data.title)
        update(node)

        return {
            update,
            destroy: () => host.replaceChildren(),
        }
    },
    metadata: (host, node) => {
        const update = (current: EngineNode<Data>): void => {
            const media = current.data.media
            host.textContent = [
                current.type,
                `${current.dimensions.width} × ${current.dimensions.height}`,
                media ? `${media.key} (version ${media.version})` : null,
            ].filter(Boolean).join(' · ')
        }
        update(node)

        return {
            update,
            destroy: () => host.replaceChildren(),
        }
    },
    actions: (host, node) => {
        const html = createDocumentHtml(host.ownerDocument)
        let current = node
        const remove = html`
            <button
                className="canvas-node-footer-info-button nopan"
                type="button"
            >
                <span
                    className="canvas-node-footer-info-icon"
                    innerHTML=${trashBinIcon}
                ></span>
            </button>
        ` as HTMLButtonElement
        const footer = createCanvasNodeFooter({
            document: host.ownerDocument,
            icons: {
                info: checkMarkIcon,
                progress: progressRippleArtwork,
            },
            infoLabel: `Select ${node.data.title}`,
            progressActive: false,
            selected: false,
            sections: [{ elements: [remove] }],
            onOpenDetails: () => options.select(current.nodeId),
        })
        host.append(footer.element)
        const removeNode = (event: MouseEvent): void => {
            event.stopPropagation()
            options.remove(current.nodeId)
        }
        const update = (next: EngineNode<Data>): void => {
            current = next
            remove.setAttribute('aria-label', `Delete ${next.data.title}`)
        }
        remove.addEventListener('click', removeNode)
        update(node)

        return {
            update,
            destroy: () => {
                remove.removeEventListener('click', removeNode)
                footer.destroy()
            },
        }
    },
})
