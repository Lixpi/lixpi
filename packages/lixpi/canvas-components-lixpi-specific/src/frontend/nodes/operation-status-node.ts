import type { OperationStatusCanvasNode } from '@lixpi/constants'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { operationStatusDismissIcon } from '@lixpi/ui-kit/svg'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import { isMediaGenerationReferenceResolutionOperation } from '../../shared/generation/reference-resolution-presentation.ts'
import type { WorkspaceNodeShells } from './workspace-node-shells.ts'

export type OperationStatusNodeActions = {
    verify: (node: OperationStatusCanvasNode, signal: AbortSignal) => Promise<void>
    cancel: (node: OperationStatusCanvasNode, signal: AbortSignal) => Promise<void>
    edit: (node: OperationStatusCanvasNode, signal: AbortSignal) => Promise<void>
    dismissUpload: (node: OperationStatusCanvasNode) => void
}

export class OperationStatusNode {
    readonly element: HTMLElement
    private readonly lifetime = new Lifetime()
    private readonly content: HTMLElement
    private readonly actionsElement: HTMLElement
    private readonly html: ReturnType<typeof createDocumentHtml>

    constructor(node: OperationStatusCanvasNode, shells: WorkspaceNodeShells, private readonly actions: OperationStatusNodeActions) {
        const shell = shells.create(node, `workspace-upload-placeholder-node is-${node.status}`, { uploadStatus: node.status }, { renderResizeHandles: false })
        this.element = shell.nodeEl
        shell.own(() => this.destroy())
        this.html = createDocumentHtml(this.element.ownerDocument)
        const html = this.html
        shell.dragOverlay.className = 'upload-placeholder-drag-overlay nopan'
        const label = node.status === 'failed'
            ? `${node.operation === 'upload' ? 'Conversion' : 'Generation'} failed`
            : node.status === 'action-required'
            ? 'Action required'
            : node.operation === 'upload'
            ? 'Converting upload'
            : 'Generating media'
        const message = node.message ?? (node.status === 'failed'
            ? 'The file could not be converted to a supported format.'
            : 'Creating a supported copy before adding it to the canvas.')
        this.content = html`
            <div className="workspace-upload-placeholder-content">
                <span className="workspace-upload-placeholder-status">${label}</span>
                <span className="workspace-upload-placeholder-name">${node.title}</span>
                <span className="workspace-upload-placeholder-message">${message}</span>
            </div>
        ` as HTMLElement
        this.element.append(this.content)
        this.lifetime.own(() => this.content.remove())
        if (node.status === 'in-progress') {
            const spinner = html`<span className="workspace-upload-placeholder-loading-spinner ai-response-loading-spinner" aria-hidden="true"></span>` as HTMLElement
            this.element.append(spinner)
            this.lifetime.own(() => spinner.remove())
        }
        this.actionsElement = html`<div className="workspace-media-operation-actions nopan"></div>` as HTMLElement
        if (node.operation === 'media-generation' && node.generationRequestId && node.requestRevision !== undefined) {
            if (node.status === 'action-required' && !isMediaGenerationReferenceResolutionOperation(node)) {
                if (node.verificationAssetId && node.generationRun !== undefined) {
                    this.addAction('Verify with provider', () => actions.verify(node, this.lifetime.signal))
                }
                this.addAction('Cancel', () => actions.cancel(node, this.lifetime.signal))
            }
            if (node.status === 'failed') {
                this.appendProblem(node)
                this.addAction('Edit request', () => actions.edit(node, this.lifetime.signal))
                this.addAction('Dismiss', () => actions.cancel(node, this.lifetime.signal))
            }
        }
        if (this.actionsElement.childElementCount > 0) this.content.append(this.actionsElement)
        if (node.status === 'failed' && node.operation === 'upload') {
            const dismiss = html`<button type="button" className="workspace-upload-placeholder-dismiss nopan" aria-label="Dismiss" innerHTML=${operationStatusDismissIcon}></button>` as HTMLButtonElement
            this.element.append(dismiss)
            this.lifetime.own(() => dismiss.remove())
            this.bindAction(dismiss, async () => actions.dismissUpload(node))
        }
    }

    private addAction(label: string, action: () => Promise<void>): void {
        const html = this.html
        const button = html`<button type="button" className="workspace-media-operation-action nopan">${label}</button>` as HTMLButtonElement
        this.bindAction(button, action)
        this.actionsElement.append(button)
    }

    private bindAction(button: HTMLButtonElement, action: () => Promise<void>): void {
        const stopPointer = (event: Event) => event.stopPropagation()
        const click = (event: Event) => {
            event.stopPropagation()
            if (button.disabled || this.lifetime.signal.aborted) return
            void this.runAction(button, action)
        }
        button.addEventListener('pointerdown', stopPointer)
        button.addEventListener('click', click)
        this.lifetime.own(() => {
            button.removeEventListener('pointerdown', stopPointer)
            button.removeEventListener('click', click)
        })
    }

    private async runAction(button: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
        button.disabled = true
        try {
            await action()
        } catch (error) {
            if (this.lifetime.signal.aborted) return
            const message = this.content.querySelector('.workspace-upload-placeholder-message')
            if (message) message.textContent = error instanceof Error ? error.message : String(error)
        } finally {
            if (!this.lifetime.signal.aborted) button.disabled = false
        }
    }

    private appendProblem(node: OperationStatusCanvasNode): void {
        if (!node.problem) return
        const html = this.html
        const moderationContext = [
            node.problem.moderationStage ? `Safety stage: ${node.problem.moderationStage}` : '',
            node.problem.moderationCategories?.length ? `Categories: ${node.problem.moderationCategories.join(', ')}` : '',
        ].filter(Boolean).join(' · ')
        const details = html`
            <details className="workspace-media-operation-problem nopan">
                <summary>Provider details</summary>
                <span className="workspace-media-operation-moderation-context">${moderationContext}</span>
                <span className="workspace-media-operation-provider-reason">${node.problem.providerReason ?? node.problem.detail}</span>
                <code className="workspace-media-operation-provider-code">${node.problem.providerCode ?? ''}</code>
                <code className="workspace-media-operation-support-code">${node.problem.supportCode}</code>
            </details>
        ` as HTMLElement
        this.actionsElement.append(details)
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
