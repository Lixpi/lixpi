import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { createButton } from '@lixpi/ui-kit/components/button'
import {
    type ConversationHumanAction,
    type ConversationHumanActionResult,
} from '@lixpi/constants'
import {
    type WorkspaceConversationController,
} from './workspace-conversation-controller.ts'

export type WorkspaceConversationHandoffPorts = {
    upload: (
        file: File,
        interruptId: string,
    ) => Promise<{ assetId: string }>
    attest: (action: Extract<ConversationHumanAction, { kind: 'attestation' }>) => Promise<void>
    download: (action: Extract<ConversationHumanAction, { kind: 'download' }>) => Promise<void>
    exportWorkspace: (workspaceId: string) => Promise<void>
    openVerification: (action: Extract<ConversationHumanAction, { kind: 'provider-verification' }>) => Promise<void>
}

export class WorkspaceConversationHandoff {
    readonly element: HTMLElement
    private readonly html: ReturnType<typeof createDocumentHtml>
    private readonly body: HTMLElement
    private readonly error: HTMLElement
    private readonly input: HTMLInputElement
    private interruptId?: string
    private disabled = false
    private ready?: ConversationHumanActionResult
    private retry?: HTMLButtonElement

    constructor(
        private readonly controller: WorkspaceConversationController,
        private readonly document: Document,
        private readonly ports: WorkspaceConversationHandoffPorts,
    ) {
        this.html = createDocumentHtml(document)
        this.input = this.html`
            <input
                type="file"
                hidden
                accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.ppt,.pptx,.odt,.rtf,.txt,.md"
                aria-label="Choose a file from your device"
                onchange=${this.upload}
            />
        ` as HTMLInputElement
        this.body = this.html`<div></div>` as HTMLElement
        this.error = this.html`<div role="status"></div>` as HTMLElement
        this.element = this.html`
            <div
                class="workspace-conversation-state"
                hidden
            >${this.input}${this.body}${this.error}</div>
        ` as HTMLElement
    }

    render(): void {
        const pending = this.controller.pendingHumanAction
        this.element.hidden = !pending

        if (this.interruptId === pending?.interruptId)
            return

        this.interruptId = pending?.interruptId
        this.ready = undefined
        this.retry = undefined
        this.disabled = false
        this.error.textContent = ''
        this.body.replaceChildren()

        if (!pending)
            return

        const {
            action,
            interruptId,
        } = pending

        if (action.kind === 'file') {
            this.retry = this.button('Continue', () => void this.complete(interruptId))
            this.retry.hidden = true
            this.body.append(
                this.button('Choose file', () => this.input.click()),
                this.retry,
            )
        } else if (action.kind === 'attestation') {
            const statement = action.classification === 'self'
                ? `I am the person depicted in "${action.title}".`
                : `The person depicted in "${action.title}" has authorized this use.`
            this.body.append(
                this.html`<p>${statement}</p>` as HTMLElement,
                this.button(
                    'Confirm attestation',
                    () => void this.perform(interruptId, async () => {
                        if (!this.ready)
                            await this.ports.attest(action)

                        return {}
                    }),
                ),
            )
        } else if (
            action.kind === 'download'
            || action.kind === 'workspace-export'
        ) {
            const label = action.kind === 'download' ? 'Download media' : 'Download workspace ZIP'

            if (action.kind === 'download') {
                const title = this.document.createElement('p')
                title.textContent = action.title
                this.body.append(title)
            }

            this.body.append(
                this.button(
                    label,
                    () => void this.perform(interruptId, async () => {
                        if (!this.ready) {
                            if (action.kind === 'download')
                                await this.ports.download(action)
                            else
                                await this.ports.exportWorkspace(action.workspaceId)
                        }

                        return {}
                    }),
                ),
            )
        } else {
            this.body.append(
                this.button(
                    'Open provider verification',
                    () => void this.perform(interruptId, async () => {
                        await this.ports.openVerification(action)

                        return undefined
                    }),
                ),
                this.button('Continue after verification', () => void this.perform(interruptId, async () => ({}))),
            )
        }
    }

    private upload = (): void => {
        const file = this.input.files?.[0]
        this.input.value = ''
        const interruptId = this.interruptId

        if (
            file
            && interruptId
        )
            void this.perform(interruptId, async () => await this.ports.upload(file, interruptId))
    }

    private async complete(interruptId: string): Promise<void> {
        const ready = this.ready

        if (ready)
            await this.perform(interruptId, async () => ready)
    }

    private async perform(
        interruptId: string,
        operation: () => Promise<ConversationHumanActionResult | undefined>,
    ): Promise<void> {
        if (
            this.disabled
            || this.controller.pendingHumanAction?.interruptId !== interruptId
        )
            return

        this.disabled = true
        this.error.textContent = ''
        this.setControlsDisabled(true)

        try {
            const result = await operation()

            if (
                !result
                || this.controller.pendingHumanAction?.interruptId !== interruptId
            )
                return

            this.ready = result
            await this.controller.completeHumanAction(interruptId, result)
        } catch (error) {
            if (this.interruptId === interruptId) {
                this.error.textContent = error instanceof Error ? error.message : 'The action could not finish.'

                if (this.retry)
                    this.retry.hidden = !this.ready
            }
        } finally {
            if (this.interruptId === interruptId) {
                this.disabled = false
                this.setControlsDisabled(false)
            }
        }
    }

    private setControlsDisabled(disabled: boolean): void {
        for (const button of this.body.querySelectorAll('button'))
            button.disabled = disabled
    }

    private button(
        label: string,
        onClick: () => void,
    ): HTMLButtonElement {
        return createButton({
            document: this.document,
            label,
            ariaLabel: label,
            className: 'workspace-conversation-text-action',
            onClick,
        }).element
    }
}
