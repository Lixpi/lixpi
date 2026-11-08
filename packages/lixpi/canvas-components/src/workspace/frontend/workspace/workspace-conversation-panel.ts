import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

import {
    type ConversationSettings,
} from '@lixpi/constants'
import {
    type WorkspaceConversationController,
} from './workspace-conversation-controller.ts'
import {
    type CanvasConversationEditor,
    type CanvasConversationEditorMount,
    type CanvasConversationThread,
    type WorkspaceConversationOutputPorts,
} from './canvas-conversation-run.ts'

export type WorkspaceConversationTranscriptPorts = {
    load: (conversationAssetId: string) => Promise<CanvasConversationThread | null>
    mount: (request: CanvasConversationEditorMount) => CanvasConversationEditor
}

export class WorkspaceConversationPanel {
    readonly element: HTMLElement
    private readonly picker: HTMLSelectElement
    private readonly title: HTMLInputElement
    private readonly messages: HTMLElement
    private readonly state: HTMLElement
    private readonly context: HTMLSelectElement
    private readonly policy: HTMLSelectElement
    private readonly override: HTMLSelectElement
    private readonly newMessages: HTMLButtonElement
    private readonly queue: HTMLElement
    private readonly stop: HTMLButtonElement
    private readonly unsubscribe: () => void
    private lastSelected = ''
    private readonly timer: number
    private readonly listTimer: number
    private renderedConversation = ''
    private transcript?: CanvasConversationEditor
    private transcriptLoading = false
    private transcriptGeneration = 0
    private transcriptError = ''
    private destroyed = false
    private followBottom = true
    private readonly html: ReturnType<typeof createDocumentHtml>

    constructor(
        readonly controller: WorkspaceConversationController,
        document: Document,
        onSelected: (conversationAssetId: string) => void,
        private readonly outputPorts: WorkspaceConversationOutputPorts | undefined,
        private readonly transcriptPorts: WorkspaceConversationTranscriptPorts,
    ) {
        this.html = createDocumentHtml(document)
        this.picker = this.html`
            <select
                aria-label="Conversation"
                onchange=${() => void controller.select(this.picker.value)}
            ></select>
        ` as HTMLSelectElement
        this.title = this.html`
            <input
                type="text"
                aria-label="Conversation title"
                maxlength="200"
                onchange=${() => void controller.rename(this.title.value)}
            />
        ` as HTMLInputElement
        this.messages = this.html`
            <div
                class="workspace-conversation-messages"
                role="log"
                aria-live="off"
                aria-label="Conversation messages"
            ></div>
        ` as HTMLElement
        this.state = this.html`
            <div
                class="workspace-conversation-state"
                role="status"
            ></div>
        ` as HTMLElement
        this.context = this.select(
            'Context mode',
            ['explicit', 'discovery', 'mixed'],
            value => this.settings({ contextMode: value as ConversationSettings['contextMode'] }),
        )
        this.policy = this.select(
            'Messages during a run',
            ['steer', 'stop-first', 'queue'],
            value => this.settings({ midRunPolicy: value as ConversationSettings['midRunPolicy'] }),
        )
        this.override = this.select(
            'Next message policy',
            ['conversation-default', 'steer', 'stop-first', 'queue'],
            value =>
                void (controller.nextMessagePolicy = value === 'conversation-default' ? undefined : (value as ConversationSettings['midRunPolicy'])),
        )
        this.newMessages = this.html`
            <button
                type="button"
                class="workspace-conversation-new-messages"
                hidden
                onclick=${() => {
                    this.followBottom = true
                    this.messages.scrollTop = this.messages.scrollHeight
                    this.newMessages.hidden = true
                }}
            >New messages</button>
        ` as HTMLButtonElement
        const collapse = this.html`
            <button
                type="button"
                aria-expanded="true"
                onclick=${() => {
                    const collapsed = this.element.dataset.collapsed !== 'true'
                    this.element.dataset.collapsed = String(collapsed)
                    collapse.textContent = collapsed ? 'Expand' : 'Collapse'
                    collapse.setAttribute(
                        'aria-expanded',
                        String(!collapsed),
                    )
                }}
            >Collapse</button>
        ` as HTMLButtonElement
        this.queue = this.html`<div class="workspace-conversation-queue"></div>` as HTMLElement
        this.stop = this.html`
            <button
                type="button"
                onclick=${() => void controller.stop()}
            >Stop</button>
        ` as HTMLButtonElement
        this.element = this.html`
            <section
                class="workspace-conversation-panel nopan"
                aria-label="Workspace conversation"
            >
                <header>
                    ${this.picker}${this.title}
                    <button
                        type="button"
                        onclick=${() => void controller.create()}
                    >New conversation</button>
                    ${this.stop}${collapse}
                </header>
                ${this.messages}${this.newMessages}
                <div class="workspace-conversation-settings">${this.context}${this.policy}${this.override}</div>
                ${this.queue}${this.state}
            </section>
        ` as HTMLElement
        this.unsubscribe = controller.onChange(() => {
            this.render()
            const id = controller.current?.conversationAssetId ?? ''

            if (
                id !== this.lastSelected
                && !controller.submitting
                && !controller.selecting
            ) {
                this.lastSelected = id
                onSelected(id)
            }
        })
        this.timer = document.defaultView!.setInterval(() => void controller.recover(), 2500)
        this.listTimer = document.defaultView!.setInterval(() => void controller.refreshList(), 10000)
        this.messages.addEventListener('scroll', () => {
            if (this.renderedConversation)
                controller.saveScroll(this.renderedConversation, this.messages.scrollTop)

            this.followBottom = this.messages.scrollHeight - this.messages.scrollTop - this.messages.clientHeight < 80

            if (this.followBottom)
                this.newMessages.hidden = true
        })
        this.render()
    }

    destroy(): void {
        this.element.ownerDocument.defaultView?.clearInterval(this.timer)
        this.element.ownerDocument.defaultView?.clearInterval(this.listTimer)

        if (this.renderedConversation)
            this.controller.saveScroll(this.renderedConversation, this.messages.scrollTop)

        this.unsubscribe()
        this.destroyed = true
        this.transcriptGeneration += 1
        this.transcript?.destroy()
        this.controller.destroy()
        this.element.remove()
    }

    private select(
        label: string,
        values: string[],
        change: (value: string) => void,
    ): HTMLSelectElement {
        const options = values.map(value => this.html`<option value=${value}>${value}</option>`)

        return this.html`
            <select
                aria-label=${label}
                onchange=${(event: Event) => change((event.target as HTMLSelectElement).value)}
            >${options}</select>
        ` as HTMLSelectElement
    }

    private settings(patch: Partial<ConversationSettings>): void {
        void this.updateSettings(patch)
    }

    private async updateSettings(patch: Partial<ConversationSettings>): Promise<void> {
        try {
            await this.controller.changeSettings(patch)
        } catch (error) {
            this.state.textContent = error instanceof Error ? error.message : 'Settings could not be saved.'
        }
    }

    private render(): void {
        const current = this.controller.current
        const options = this.controller.conversations.map(item => {
            const active = item.run && !['completed', 'stopped', 'failed'].includes(item.run.state)
            const label = `${item.title || 'Conversation'}${active ? ` · ${item.run!.state}` : ''}${this.controller.isUnread(item) ? ' · Unread' : ''}`

            return this.html`<option value=${item.conversationAssetId}>${label}</option>` as HTMLOptionElement
        })
        this.picker.replaceChildren(...options)

        if (!this.controller.conversations.length)
            this.picker.append(this.html`<option value="">New conversation</option>` as HTMLOptionElement)

        this.picker.value = current?.conversationAssetId ?? ''

        if (this.element.ownerDocument.activeElement !== this.title)
            this.title.value = current?.title ?? ''

        this.title.hidden = !this.controller.ports.rename
        this.title.disabled = !current
            || !current.documentRevision
            || this.controller.selecting
        this.picker.disabled = this.controller.submitting || this.controller.selecting
        const changedConversation = this.renderedConversation !== (current?.conversationAssetId ?? '')

        if (changedConversation) {
            if (this.renderedConversation)
                this.controller.saveScroll(this.renderedConversation, this.messages.scrollTop)

            this.renderedConversation = current?.conversationAssetId ?? ''
            this.transcriptGeneration += 1
            this.transcript?.destroy()
            this.transcript = undefined
            this.transcriptLoading = false
            this.transcriptError = ''
            this.messages.replaceChildren()
            this.followBottom = true
            this.newMessages.hidden = true
        }

        if (
            current?.messages.length
            || current?.documentRevision
        )
            void this.mountTranscript()
        else if (!this.messages.firstChild)
            this.messages.append(
                this.html`<p class="workspace-conversation-empty">Discuss a plan, inspect an Asset, or ask for an edit.</p>` as HTMLElement,
            )

        this.transcript?.renderOperations?.([...this.controller.operations.values()], this.outputPorts)

        this.state.textContent = this.transcriptError
            || this.controller.error
            || current?.run?.error?.message
            || (this.controller.selecting
                ? 'Loading conversation…'
                : this.controller.submitting
                    ? 'Sending…'
                    : this.controller.steeringPending
                        ? 'Steering pending'
                        : current?.run
                            ? current.run.state === 'waiting-input'
                                ? 'Waiting for your answer'
                                : current.run.state
                            : 'Ready')
        this.context.value = current?.settings.contextMode ?? 'explicit'
        this.policy.value = current?.settings.midRunPolicy ?? 'steer'
        this.override.value = this.controller.nextMessagePolicy ?? 'conversation-default'
        this.override.disabled = this.controller.submitting || this.controller.selecting
        this.context.disabled = !current
            || this.controller.submitting
            || this.controller.selecting
        this.policy.disabled = !current
            || this.controller.submitting
            || this.controller.selecting
        this.stop.disabled = !current?.run || ['completed', 'stopped', 'failed'].includes(current.run.state)
        this.queue.replaceChildren(
            ...(current?.queuedTurns ?? []).filter(turn => !turn.interruptId).map(
                turn => this.html`
                    <div>Queued message <button
                            type="button"
                            onclick=${() => void this.controller.queue('cancel-message', [turn.turnId])}
                        >Cancel</button></div>
                ` as HTMLElement,
            ),
        )

        if (current?.queuePaused)
            this.queue.append(
                this.html`
                    <button
                        type="button"
                        onclick=${() => void this.controller.queue('resume')}
                    >Resume queue</button>
                ` as HTMLElement,
            )
    }

    private async mountTranscript(): Promise<void> {
        const current = this.controller.current

        if (
            !current
            || this.transcript
            || this.transcriptLoading
            || this.destroyed
        )
            return

        const generation = this.transcriptGeneration
        const conversationAssetId = current.conversationAssetId
        this.transcriptLoading = true

        try {
            const thread = await this.transcriptPorts.load(conversationAssetId)

            if (
                this.destroyed
                || generation !== this.transcriptGeneration
                || !thread
            )
                return

            this.messages.replaceChildren()
            const mount = this.html`<div class="ai-chat-thread-node-editor"></div>` as HTMLElement
            this.messages.append(mount)
            const onStreaming = (): void => {
                if (
                    this.destroyed
                    || generation !== this.transcriptGeneration
                )
                    return

                this.transcript?.renderOperations?.([...this.controller.operations.values()], this.outputPorts)
                this.updateScroll()
            }
            this.transcript = this.transcriptPorts.mount({
                container: mount,
                workspaceId: this.controller.workspaceId,
                thread,
                readOnly: true,
                onChange: () => {},
                onStreaming,
                onSubmit: async () => {},
                onStop: () => void this.controller.stop(),
                onReceiving: () => {},
                onSegment: () => {},
            })
            this.transcript.activate()
            this.transcriptError = ''
            const saved = this.controller.readScroll(conversationAssetId)
            this.messages.scrollTop = saved ?? this.messages.scrollHeight
            this.followBottom = saved === undefined
                || this.messages.scrollHeight - this.messages.scrollTop - this.messages.clientHeight < 80
            onStreaming()
        } catch (error) {
            if (
                !this.destroyed
                && generation === this.transcriptGeneration
            ) {
                this.transcriptError = error instanceof Error ? error.message : 'Conversation could not be loaded.'
                this.state.textContent = this.transcriptError
            }
        } finally {
            if (generation === this.transcriptGeneration)
                this.transcriptLoading = false
        }
    }

    private updateScroll(): void {
        if (this.followBottom)
            this.messages.scrollTop = this.messages.scrollHeight
        else
            this.newMessages.hidden = false
    }
}
