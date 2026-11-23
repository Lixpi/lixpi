import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { createButton } from '@lixpi/ui-kit/components/button'
import { createTextInput } from '@lixpi/ui-kit/components/text-input'
import {
    WorkspaceConversationHandoff,
    type WorkspaceConversationHandoffPorts,
} from './workspace-conversation-handoff.ts'
import { chevronDownIcon } from '@lixpi/ui-kit/svg'
import { BubbleMenu } from '@lixpi/ui-kit/components/bubble-menu'
import {
    type ConversationRunState,
    type ConversationSnapshot,
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

export type OpenWorkspaceConversation = (
    workspaceId: string,
    conversationAssetId: string,
) => void

export const delegatedOriginLabel = (workspaceName: string): string => `Started by ${workspaceName || 'parent workspace'} agent`

export type WorkspaceConversationTranscriptPorts = {
    load: (conversationAssetId: string) => Promise<CanvasConversationThread | null>
    mount: (request: CanvasConversationEditorMount) => CanvasConversationEditor
}

const runLabels: Record<ConversationRunState, string> = {
    queued: 'Waiting to start',
    running: 'Working',
    'waiting-tools': 'Working with tools',
    'waiting-input': 'Waiting for your answer',
    stopping: 'Stopping',
    stopped: 'Stopped',
    completed: '',
    failed: 'The response could not complete.',
    'needs-reauthentication': 'Sign in again to continue',
}

const conversationFailureLabel = (
    message: string,
    code?: string,
): string => {
    if (
        code === 'AGENT_MODEL_CALL_NOT_AUTHORIZED'
        || message.includes('AGENT_MODEL_CALL_NOT_AUTHORIZED')
    )
        return 'The response could not start. Check your account settings.'

    if (/^[A-Z][A-Z0-9_]{3,}$/u.test(
        message.trim(),
    ))
        return 'The response could not complete.'

    return message
}

export class WorkspaceConversationPanel {
    readonly element: HTMLElement
    private readonly footer: HTMLElement
    private readonly historyTrigger: HTMLButtonElement
    private readonly historyMenu: BubbleMenu
    private readonly picker: HTMLSelectElement
    private readonly title: HTMLInputElement
    private readonly rename: HTMLElement
    private readonly create: HTMLButtonElement
    private readonly collapse: HTMLButtonElement
    private readonly messages: HTMLElement
    private readonly state: HTMLElement
    private readonly newMessages: HTMLButtonElement
    private readonly queue: HTMLElement
    private readonly stop: HTMLButtonElement
    private readonly handoff?: WorkspaceConversationHandoff
    private readonly origin: HTMLElement
    private readonly unsubscribe: () => void
    private lastSelected = ''
    private pickerSignature = ''
    private readonly timer: number
    private readonly listTimer: number
    private renderedConversation = ''
    private renderedFollowing = false
    private followedConversation: string | null | undefined
    private followedSnapshot?: ConversationSnapshot
    private transcript?: CanvasConversationEditor
    private transcriptLoading = false
    private transcriptGeneration = 0
    private authorityRecovery?: Promise<void>
    private authorityRetry = false
    private authorityRunKey?: string
    private observedAuthorityVersion?: number
    private transcriptError = ''
    private destroyed = false
    private followBottom = true
    private collapsedScroll?: number
    private readonly html: ReturnType<typeof createDocumentHtml>

    constructor(
        readonly controller: WorkspaceConversationController,
        document: Document,
        onSelected: (conversationAssetId: string) => void,
        private readonly outputPorts: WorkspaceConversationOutputPorts | undefined,
        private readonly transcriptPorts: WorkspaceConversationTranscriptPorts,
        private readonly openConversation?: OpenWorkspaceConversation,
        handoffPorts?: WorkspaceConversationHandoffPorts,
    ) {
        this.html = createDocumentHtml(document)
        this.handoff = handoffPorts ? new WorkspaceConversationHandoff(
            controller,
            document,
            handoffPorts,
        ) : undefined
        this.origin = this.html`
            <p
                class="workspace-conversation-origin"
                hidden
            ></p>
        ` as HTMLElement
        this.picker = this.html`
            <select
                class="workspace-conversation-picker"
                aria-label="Conversation history"
                onchange=${() => {
                    this.historyMenu.hide()
                    void controller.select(this.picker.value)
                }}
            ></select>
        ` as HTMLSelectElement
        this.title = createTextInput({
            ariaLabel: 'Conversation title',
            className: 'workspace-conversation-title',
            document,
            onChange: value => {
                void controller.rename(value)
                this.historyMenu.hide()
            },
        }).element
        this.title.maxLength = 200
        this.title.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                this.title.value = controller.current?.title ?? ''
                this.historyMenu.hide()
                this.historyTrigger.focus()
            }

            if (event.key === 'Enter') {
                event.preventDefault()
                this.title.blur()
            }

            event.stopPropagation()
        })
        this.rename = this.html`
            <label class="workspace-conversation-menu-field">
                <span>Conversation name</span>
                ${this.title}
            </label>
        ` as HTMLElement
        this.messages = this.html`
            <div
                class="workspace-conversation-messages"
                role="log"
                aria-live="off"
                aria-label="Conversation messages"
                onwheel=${(event: WheelEvent) => {
                    if (!event.ctrlKey)
                        event.stopPropagation()
                }}
            ></div>
        ` as HTMLElement
        this.state = this.html`
            <div
                class="workspace-conversation-state"
                role="status"
                hidden
            ></div>
        ` as HTMLElement
        this.newMessages = createButton({
            label: 'New messages',
            className: 'workspace-conversation-new-messages',
            document,
            onClick: () => {
                this.followBottom = true
                this.messages.scrollTop = this.messages.scrollHeight
                this.newMessages.hidden = true
            },
        }).element
        this.newMessages.hidden = true
        const collapseButton = createButton({
            label: 'Hide conversation',
            ariaLabel: 'Collapse conversation',
            className: 'workspace-conversation-menu-action',
            document,
            onClick: () => {
                const collapsed = this.element.dataset.collapsed !== 'true'

                if (collapsed)
                    this.collapsedScroll = this.messages.scrollTop

                this.element.dataset.collapsed = String(collapsed)
                collapseButton.setLabel(collapsed ? 'Show conversation' : 'Hide conversation')
                this.collapse.ariaLabel = collapsed ? 'Expand conversation' : 'Collapse conversation'
                this.collapse.ariaExpanded = String(!collapsed)
                this.historyMenu.hide()
                this.renderState()

                if (!collapsed) {
                    this.messages.scrollTop = this.followBottom ? this.messages.scrollHeight : (this.collapsedScroll ?? this.messages.scrollTop)
                    this.collapsedScroll = undefined
                }
            },
        })
        this.collapse = collapseButton.element
        this.collapse.ariaExpanded = 'true'
        this.create = createButton({
            label: 'New conversation',
            ariaLabel: 'New conversation',
            className: 'workspace-conversation-menu-action',
            document,
            onClick: () => {
                this.historyMenu.hide()
                void controller.create()
            },
        }).element
        this.queue = this.html`<div class="workspace-conversation-queue"></div>` as HTMLElement
        this.stop = createButton({
            label: 'Stop',
            ariaLabel: 'Stop response',
            className: 'workspace-conversation-text-action',
            document,
            onClick: () => void controller.stop(),
        }).element
        this.stop.hidden = true
        this.historyTrigger = this.html`
            <button
                type="button"
                class="workspace-conversation-history"
                aria-label="Conversation history and actions"
                aria-haspopup="dialog"
                aria-expanded="false"
                onclick=${() => this.toggleHistory()}
            >
                <span>History</span>
                <span
                    class="workspace-conversation-history-icon"
                    aria-hidden="true"
                    innerHTML=${chevronDownIcon}
                ></span>
            </button>
        ` as HTMLButtonElement
        this.footer = this.html`
            <div class="workspace-conversation-footer">
                ${this.historyTrigger}${this.state}${this.stop}
            </div>
        ` as HTMLElement
        this.element = this.html`
            <section
                class="workspace-conversation-panel nopan"
                aria-label="Conversation with Lixpi"
                onpointerdown=${(event: PointerEvent) => event.stopPropagation()}
            >
                ${this.origin}${this.messages}${this.newMessages}${this.queue}${this.handoff?.element}${this.footer}
            </section>
        ` as HTMLElement
        const menuContent = this.html`
            <div class="workspace-conversation-menu-content">
                <label class="workspace-conversation-menu-field">
                    <span>Conversation</span>
                    ${this.picker}
                </label>
                ${this.rename}
                <div class="workspace-conversation-menu-actions">
                    ${this.create}${this.collapse}
                </div>
            </div>
        ` as HTMLElement
        this.historyMenu = new BubbleMenu({
            parentEl: this.element,
            label: 'Conversation history and actions',
            items: [{
                element: menuContent,
                context: ['conversation'],
            }],
            onShow: () => void (this.historyTrigger.ariaExpanded = 'true'),
            onHide: () => void (this.historyTrigger.ariaExpanded = 'false'),
        })
        this.historyMenu.element.classList.add('workspace-conversation-menu', 'nopan')
        this.historyMenu.element.role = 'dialog'
        document.addEventListener(
            'pointerdown',
            this.closeHistoryOutside,
            true,
        )
        document.addEventListener('keydown', this.closeHistoryOnEscape)
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
        this.timer = document.defaultView!.setInterval(() => {
            void controller.recover()
            this.recoverTranscript(true)
        }, 2500)
        this.listTimer = document.defaultView!.setInterval(() => void controller.refreshList(), 10000)
        this.messages.addEventListener('scroll', () => {
            if (this.element.dataset.collapsed === 'true')
                return

            if (
                this.renderedConversation
                && !this.renderedFollowing
            )
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

        if (
            this.renderedConversation
            && !this.renderedFollowing
        )
            this.controller.saveScroll(this.renderedConversation, this.collapsedScroll ?? this.messages.scrollTop)

        this.element.ownerDocument.removeEventListener(
            'pointerdown',
            this.closeHistoryOutside,
            true,
        )
        this.element.ownerDocument.removeEventListener('keydown', this.closeHistoryOnEscape)
        this.historyMenu.destroy()
        this.unsubscribe()
        this.destroyed = true
        this.transcriptGeneration += 1
        this.transcript?.destroy()
        this.controller.destroy()
        this.element.remove()
    }

    setFollowedConversation(
        following: boolean,
        conversationAssetId?: string | null,
    ): void {
        const target = following ? (conversationAssetId ?? null) : undefined

        if (this.followedConversation === target)
            return

        this.followedConversation = target
        this.followedSnapshot = undefined
        this.render()

        if (target)
            void this.loadFollowedSummary(target)
    }

    private async loadFollowedSummary(conversationAssetId: string): Promise<void> {
        const generation = this.transcriptGeneration

        try {
            const snapshot = await this.controller.ports.get({
                protocolVersion: 1,
                workspaceId: this.controller.workspaceId,
                conversationAssetId,
            })

            if (
                this.destroyed
                || generation !== this.transcriptGeneration
                || this.followedConversation !== conversationAssetId
                || snapshot.conversationAssetId !== conversationAssetId
            )
                return

            this.followedSnapshot = snapshot
            this.render()
        } catch {
            // The transcript's own read continues to report its load or authority failure.
        }
    }

    private presentedConversation(): ConversationSnapshot | undefined {
        if (this.followedConversation === undefined)
            return this.controller.current

        return this.followedSnapshot ?? this.controller.conversations.find(item => item.conversationAssetId === this.followedConversation)
    }

    private presentedConversationId(): string {
        return this.followedConversation === undefined ? (this.controller.current?.conversationAssetId ?? '') : (this.followedConversation ?? '')
    }

    private toggleHistory(): void {
        if (this.historyMenu.isVisible) {
            this.historyMenu.hide()

            return
        }

        this.historyMenu.show(
            'conversation',
            {
                targetRect: this.historyTrigger.getBoundingClientRect(),
                placement: 'above',
                clampToParent: false,
                animateOnShow: false,
            },
        )
    }

    private closeHistoryOutside = (event: PointerEvent): void => {
        if (!this.element.contains(event.target as Node))
            this.historyMenu.hide()
    }

    private closeHistoryOnEscape = (event: KeyboardEvent): void => {
        if (
            event.key !== 'Escape'
            || !this.historyMenu.isVisible
        )
            return

        event.preventDefault()
        this.historyMenu.hide()
        this.historyTrigger.focus()
    }

    private renderOrigin(delegatedBy: NonNullable<WorkspaceConversationController['current']>['delegatedBy']): void {
        this.origin.hidden = !delegatedBy

        if (!delegatedBy) {
            this.origin.replaceChildren()

            return
        }

        const link = this.openConversation
            ? createButton({
                label: 'Open parent conversation',
                className: 'workspace-conversation-origin-link',
                document: this.element.ownerDocument,
                onClick: () => this.openConversation!(delegatedBy.workspaceId, delegatedBy.conversationAssetId),
            }).element
            : null
        this.origin.replaceChildren(
            this.html`<span>${delegatedOriginLabel(delegatedBy.workspaceName)}</span>` as HTMLElement,
            ...(link ? [link] : []),
        )
    }

    private renderPicker(): void {
        const conversations = this.controller.conversations.map(item => {
            const active = item.run && !['completed', 'stopped', 'failed'].includes(item.run.state)
            const origin = item.delegatedBy ? ` · ${delegatedOriginLabel(item.delegatedBy.workspaceName)}` : ''
            const label = `${item.title || 'Conversation'}${origin}${active ? ` · ${runLabels[item.run!.state]}` : ''}${this.controller.isUnread(item) ? ' · Unread' : ''}`

            return {
                id: item.conversationAssetId,
                label,
            }
        })
        const signature = JSON.stringify(conversations)

        if (signature !== this.pickerSignature) {
            this.pickerSignature = signature
            this.picker.replaceChildren(...conversations.map(item => this.html`<option value=${item.id}>${item.label}</option>` as HTMLOptionElement))

            if (!conversations.length)
                this.picker.append(this.html`<option value="">New conversation</option>` as HTMLOptionElement)
        }

        this.picker.value = this.presentedConversationId()
        this.picker.disabled = this.followedConversation !== undefined
            || this.controller.submitting
            || this.controller.selecting
    }

    private render(): void {
        const following = this.followedConversation !== undefined
        const current = this.presentedConversation()
        const conversationAssetId = this.presentedConversationId()
        const hasMessages = following ? Boolean(conversationAssetId) : Boolean(current?.messages.length || current?.documentRevision)
        const hasHistory = following ? Boolean(current) : this.controller.conversations.some(item => item.messages.length || item.documentRevision)
        const activeRun = Boolean(current?.run && !['completed', 'stopped', 'failed'].includes(current.run.state))
        this.renderPicker()
        this.handoff?.render()

        if (
            following
            && this.handoff
        )
            this.handoff.element.hidden = true

        this.renderOrigin(current?.delegatedBy)

        if (this.element.ownerDocument.activeElement !== this.title)
            this.title.value = current?.title ?? ''

        this.rename.hidden = !this.controller.ports.rename || !hasMessages
        this.title.disabled = following
            || !current?.documentRevision
            || this.controller.selecting
        this.create.disabled = following
            || this.controller.submitting
            || this.controller.selecting
        this.create.hidden = !hasMessages
        this.collapse.hidden = !hasMessages
        this.historyTrigger.hidden = !hasMessages && !hasHistory
        this.messages.hidden = !hasMessages
        this.element.dataset.empty = String(!hasMessages)
        const changedConversation = this.renderedConversation !== conversationAssetId || this.renderedFollowing !== following

        if (changedConversation) {
            if (
                this.renderedConversation
                && !this.renderedFollowing
            )
                this.controller.saveScroll(this.renderedConversation, this.collapsedScroll ?? this.messages.scrollTop)

            this.renderedConversation = conversationAssetId
            this.renderedFollowing = following
            this.transcriptGeneration += 1
            this.transcript?.destroy()
            this.transcript = undefined
            this.transcriptLoading = false
            this.authorityRecovery = undefined
            this.authorityRetry = false
            this.authorityRunKey = undefined
            this.observedAuthorityVersion = undefined
            this.transcriptError = ''
            this.messages.replaceChildren()
            this.followBottom = true
            this.collapsedScroll = undefined
            this.newMessages.hidden = true
            this.historyMenu.hide()
        }

        if (hasMessages)
            void this.mountTranscript()

        if (!following)
            this.transcript?.renderOperations?.([...this.controller.operations.values()], this.outputPorts)

        this.recoverTranscript()
        this.renderState()
        this.footer.hidden = !hasMessages
            && !hasHistory
            && !activeRun
            && this.state.hidden
        this.stop.hidden = following || !activeRun
        this.stop.disabled = following
            || !activeRun
            || current?.run?.state === 'stopping'
        this.queue.replaceChildren(
            ...(current?.queuedTurns ?? []).filter(turn => !turn.interruptId).map(
                turn => this.html`
                    <div class="workspace-conversation-queued-message">
                        <span>Message queued</span>
                        ${createButton({
                            label: 'Cancel',
                            className: 'workspace-conversation-text-action',
                            document: this.element.ownerDocument,
                            onClick: () => void this.controller.queue('cancel-message', [turn.turnId]),
                        }).element}
                    </div>
                ` as HTMLElement,
            ),
        )

        if (current?.queuePaused)
            this.queue.append(
                createButton({
                    label: 'Resume queued messages',
                    className: 'workspace-conversation-text-action',
                    document: this.element.ownerDocument,
                    onClick: () => void this.controller.queue('resume'),
                }).element,
            )

        this.element.hidden = !hasMessages
            && !hasHistory
            && this.state.hidden
            && !this.queue.childElementCount
    }

    private renderState(): void {
        const following = this.followedConversation !== undefined
        const current = this.presentedConversation()
        const projectedFailureIds = new Set(
            this.element.dataset.collapsed !== 'true'
                && current?.run?.state === 'failed'
                ? Array.from(
                    this.messages.querySelectorAll<HTMLElement>('[data-message-id][data-failure-code]'),
                    element => element.dataset.messageId,
                )
                : [],
        )
        const runFailureVisible = current?.messages.some(
            message =>
                Boolean(message.failure)
                && message.turnId === current.run?.turnId
                && projectedFailureIds.has(message.messageId),
        )
        const error = this.transcriptError
            || (!following ? this.controller.error : '')
            || (!runFailureVisible ? current?.run?.error?.message : '')
        const errorLabel = error
            ? conversationFailureLabel(error, this.transcriptError
                || this.controller.error
                ? undefined
                : current?.run?.error?.code)
            : ''
        this.state.textContent = !following
            && this.controller.selecting
            ? 'Loading conversation...'
            : errorLabel || (!following
                && this.controller.submitting
                ? 'Sending...'
                : current?.run
                    && !runFailureVisible
                    ? runLabels[current.run.state]
                    : '')
        this.state.hidden = !this.state.textContent
        this.state.dataset.error = String(!this.controller.selecting && Boolean(error || current?.run?.state === 'failed'))
    }

    private async mountTranscript(): Promise<void> {
        const conversationAssetId = this.presentedConversationId()
        const following = this.followedConversation !== undefined

        if (
            !conversationAssetId
            || this.transcript
            || this.transcriptLoading
            || this.destroyed
        )
            return

        const generation = this.transcriptGeneration
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
            const mount = this.html`<div class="workspace-conversation-transcript"></div>` as HTMLElement
            this.messages.append(mount)
            const onStreaming = (): void => {
                if (
                    this.destroyed
                    || generation !== this.transcriptGeneration
                )
                    return

                if (!following)
                    this.transcript?.renderOperations?.([...this.controller.operations.values()], this.outputPorts)

                this.renderState()
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
                onStop: () => {
                    if (!following)
                        void this.controller.stop()
                },
                onReceiving: () => {},
                onSegment: () => {},
            })
            this.transcript.activate()
            this.observedAuthorityVersion = this.transcript.readDocumentVersion?.()
            this.recoverTranscript()
            this.transcriptError = ''
            this.renderState()
            const saved = following ? undefined : this.controller.readScroll(conversationAssetId)
            const collapsed = this.element.dataset.collapsed === 'true'
            this.collapsedScroll = collapsed ? saved : undefined
            this.messages.scrollTop = saved ?? this.messages.scrollHeight
            this.followBottom = saved === undefined
                || (!collapsed && this.messages.scrollHeight - this.messages.scrollTop - this.messages.clientHeight < 80)
            onStreaming()
        } catch (error) {
            if (
                !this.destroyed
                && generation === this.transcriptGeneration
            ) {
                this.transcriptError = error instanceof Error ? error.message : 'Conversation could not be loaded.'
                this.renderState()
            }
        } finally {
            if (generation === this.transcriptGeneration)
                this.transcriptLoading = false
        }
    }

    private recoverTranscript(onRecoveryTick = false): void {
        const editor = this.transcript
        const current = this.presentedConversation()

        if (
            this.destroyed
            || !editor?.recoverAuthority
            || !current
            || this.authorityRecovery
        )
            return

        const version = editor.readDocumentVersion?.()
        const run = current.run
        const runKey = run ? `${run.runId}:${run.epoch}:${run.state}` : ''
        const active = run && !['completed', 'stopped', 'failed'].includes(run.state)
        const stalled = onRecoveryTick
            && active
            && version !== undefined
            && version === this.observedAuthorityVersion

        if (onRecoveryTick)
            this.observedAuthorityVersion = version

        if (
            this.authorityRetry
            && !onRecoveryTick
        )
            return

        const behind = version !== undefined && version < current.documentRevision

        if (
            this.authorityRunKey === runKey
            && !behind
            && !stalled
            && !(onRecoveryTick && this.authorityRetry)
        )
            return

        const generation = this.transcriptGeneration
        this.authorityRunKey = runKey
        this.authorityRetry = false
        this.authorityRecovery = this.waitForAuthorityRecovery(
            editor.recoverAuthority(),
            generation,
        )
    }

    private async waitForAuthorityRecovery(
        recovery: Promise<void>,
        generation: number,
    ): Promise<void> {
        try {
            await recovery
        } catch {
            if (
                !this.destroyed
                && generation === this.transcriptGeneration
            )
                this.authorityRetry = true
        } finally {
            if (
                !this.destroyed
                && generation === this.transcriptGeneration
            )
                this.authorityRecovery = undefined
        }
    }

    private updateScroll(): void {
        if (!this.followBottom)
            this.newMessages.hidden = false
        else if (this.element.dataset.collapsed !== 'true')
            this.messages.scrollTop = this.messages.scrollHeight
    }
}
