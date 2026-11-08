import {
    type OperationStatusCanvasNode,
} from '@lixpi/constants'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type BranchPromptReference,
    type BranchPromptReferenceRenderer,
} from './branch-marker-prompt.ts'

export type BranchReferenceResolutionRequest = {
    generationRequestId: string
    requestRevision: number
    bindingId: string
    assetId: string
}
export type BranchReferenceResolutionOptions = {
    document: Document
    operation: OperationStatusCanvasNode
    candidates: readonly Extract<BranchPromptReference, { referenceType: 'media' }>[]
    renderReference: BranchPromptReferenceRenderer
    resolveReference: (request: BranchReferenceResolutionRequest) => Promise<unknown>
}

export class BranchReferenceResolution {
    readonly element: HTMLDivElement
    private readonly lifetime = new Lifetime()
    private readonly error: HTMLElement
    private readonly choices: HTMLElement[] = []
    private resolving = false

    constructor(private readonly options: BranchReferenceResolutionOptions) {
        const html = createDocumentHtml(options.document)
        this.element = html`
            <div
                className="workspace-branch-reference-resolution nopan"
                role="group"
                aria-label="Resolve Asset reference"
            >
                <span className="workspace-branch-reference-resolution-message">Which Asset does this refer to?</span>
                <span className="workspace-branch-reference-resolution-choices"></span>
                <span
                    className="workspace-branch-reference-resolution-error"
                    role="status"
                ></span>
            </div>
        ` as HTMLDivElement
        this.error = this.element.querySelector('.workspace-branch-reference-resolution-error')!
        this.lifetime.own(() => this.element.remove())
        const host = this.element.querySelector('.workspace-branch-reference-resolution-choices')!
        const candidates = new Map(
            options.candidates.map(reference => [reference.assetId, reference]),
        )

        try {
            for (const assetId of new Set(options.operation.candidateAssetIds)) {
                const reference = candidates.get(assetId)

                if (!reference)
                    continue

                const preview = options.renderReference(reference)
                this.lifetime.own(() => preview.dom.remove())
                this.lifetime.own(() => preview.destroy())
                const choice = preview.dom
                choice.classList.add('workspace-branch-reference-resolution-choice', 'nopan')
                const trigger = choice.querySelector<HTMLElement>('.context-preview-inline-trigger') ?? choice
                trigger.setAttribute('role', 'button')
                trigger.setAttribute('aria-label', `Use @${reference.displayName}`)
                const stop = (event: Event) => event.stopPropagation()
                const click = (event: Event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void this.choose(assetId)
                }
                const keydown = (event: KeyboardEvent) => {
                    if (
                        event.key === 'Enter'
                        || event.key === ' '
                    )
                        click(event)
                }
                choice.addEventListener(
                    'pointerdown',
                    stop,
                    true,
                )
                choice.addEventListener(
                    'click',
                    click,
                    true,
                )
                choice.addEventListener(
                    'keydown',
                    keydown,
                    true,
                )
                this.lifetime.own(() => {
                    choice.removeEventListener(
                        'pointerdown',
                        stop,
                        true,
                    )
                    choice.removeEventListener(
                        'click',
                        click,
                        true,
                    )
                    choice.removeEventListener(
                        'keydown',
                        keydown,
                        true,
                    )
                })
                this.choices.push(choice)
                host.appendChild(choice)
            }
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    get hasChoices(): boolean {
        return this.choices.length > 0
    }

    private setDisabled(disabled: boolean): void {
        for (const choice of this.choices) {
            choice.classList.toggle('is-resolving', disabled)
            choice.setAttribute(
                'aria-disabled',
                String(disabled),
            )
        }
    }

    private async choose(assetId: string): Promise<void> {
        const { operation } = this.options

        if (
            this.resolving
            || this.lifetime.signal.aborted
            || !operation.generationRequestId
            || operation.requestRevision === undefined
            || !operation.unresolvedBindingId
        )
            return

        this.resolving = true
        this.error.textContent = ''
        this.setDisabled(true)

        try {
            await this.options.resolveReference({
                generationRequestId: operation.generationRequestId,
                requestRevision: operation.requestRevision,
                bindingId: operation.unresolvedBindingId,
                assetId,
            })
        } catch (error) {
            if (this.lifetime.signal.aborted)
                return

            this.resolving = false
            this.setDisabled(false)
            this.error.textContent = error instanceof Error ? error.message : String(error)
        }
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}

export const createBranchReferenceResolution = (options: BranchReferenceResolutionOptions): BranchReferenceResolution | null => {
    const { operation } = options

    if (
        !operation.generationRequestId
        || operation.requestRevision === undefined
        || !operation.unresolvedBindingId
        || !operation.candidateAssetIds?.length
    )
        return null

    const view = new BranchReferenceResolution(options)

    if (view.hasChoices)
        return view

    view.destroy()

    return null
}
