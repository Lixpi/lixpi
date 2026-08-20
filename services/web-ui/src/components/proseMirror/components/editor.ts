// @ts-nocheck
'use strict'

import { EditorState } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { DOMParser } from "prosemirror-model"
import {
    DOCUMENT_TYPE,
    aiChatThreadNodeType,
    aiPromptInputNodeType,
    createProseMirrorSchema
} from '@lixpi/prosemirror'
import { keymap } from "prosemirror-keymap"
import { history } from "prosemirror-history"
import { baseKeymap } from "prosemirror-commands"
import { dropCursor } from "prosemirror-dropcursor"
import { gapCursor } from "prosemirror-gapcursor"

// Plugins
import { statePlugin } from '$src/components/proseMirror/plugins/statePlugin.js'
import focusPlugin from '$src/components/proseMirror/plugins/focusPlugin.js'
import lockCursorPositionPlugin from '$src/components/proseMirror/plugins/lockCursorPositionPlugin.js'
import {
    createAiChatThreadPlugin
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin'
import {
    createAiPromptInputPlugin
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin'
import { createCodeBlockPlugin, codeBlockInputRule } from '$src/components/proseMirror/plugins/codeBlockPlugin.js'
import { activeNodePlugin } from "$src/components/proseMirror/plugins/activeNodePlugin"

import { bubbleMenuPlugin } from '$src/components/proseMirror/plugins/bubbleMenuPlugin/index.ts'
import { linkTooltipPlugin } from '$src/components/proseMirror/plugins/linkTooltipPlugin/linkTooltipPlugin.ts'
import { imageSelectionPlugin } from '$src/components/proseMirror/plugins/imageSelectionPlugin/index.ts'
import {
    createAtPromptReferencePickerPlugin,
    createPromptReferenceNodeViewPlugin,
    createSlashCapabilityModulePickerPlugin,
    type PromptReferencePreviewRenderer,
} from '$src/components/proseMirror/plugins/promptReferencePickerPlugin/index.ts'

import {buildKeymap} from "$src/components/proseMirror/components/keyMap.js"
import {buildInputRules} from "$src/components/proseMirror/components/inputRules.js"
import { createSvelteComponentRendererPlugin } from '$src/components/proseMirror/plugins/svelteComponentRenderer/svelteComponentRendererPlugin.js'
import { ProseMirrorAuthorityService } from '$src/services/prosemirror-authority-service.ts'
// import TaskRow from '$src/rows/TaskRow.svelte'

import { defaultAttrs as defautSubtaskAttrs } from '$src/components/proseMirror/customNodes/taskRowNode.js'

type ProseMirrorEditorConfig = {
    editorMountElement: HTMLElement
    content: HTMLElement
    initialVal?: any
    isDisabled: boolean
    documentType?: string
    threadId?: string | null
    onEditorChange?: (value: any) => void
    onStreamingUpdate?: (value: any) => void
    onAiChatSubmit?: (value: any) => void
    onAiChatStop?: (value: any) => void
    onPromptSubmit?: (value: any) => void
    promptControlFactories?: any
    promptReferenceCatalog?: any
    promptReferencePreviewRenderer?: PromptReferencePreviewRenderer
    onReceivingStateChange?: (threadId: string, receiving: boolean) => void
    readOnly?: boolean
    proseMirrorAuthority?: any
    aiChatThreadRenderContext?: any
    schema?: any
    plugins?: any[]
    enablePromptReferences?: boolean
}

export class ProseMirrorEditor {
    editorView!: EditorView
    editorSchema: any = null
    proseMirrorAuthority: ProseMirrorAuthorityService | null = null

    constructor({
        editorMountElement,
        content,
        initialVal = {},
        isDisabled,
        documentType = DOCUMENT_TYPE.ASSET_CONTENT,
        threadId,
        onEditorChange,
        onStreamingUpdate,
        onAiChatSubmit,
        onAiChatStop,
        onPromptSubmit,
        promptControlFactories,
        promptReferenceCatalog,
        promptReferencePreviewRenderer,
        onReceivingStateChange,
        readOnly = false,
        proseMirrorAuthority,
        aiChatThreadRenderContext,
        schema,
        plugins = [],
        enablePromptReferences = false
    }: ProseMirrorEditorConfig) {
        this.onEditorChange = onEditorChange
        this.onStreamingUpdate = onStreamingUpdate
        this.onAiChatSubmit = onAiChatSubmit
        this.onAiChatStop = onAiChatStop
        this.onPromptSubmit = onPromptSubmit
        this.promptControlFactories = promptControlFactories
        this.promptReferenceCatalog = promptReferenceCatalog
        this.promptReferencePreviewRenderer = promptReferencePreviewRenderer
        this.onReceivingStateChange = onReceivingStateChange
        this.proseMirrorAuthorityOptions = proseMirrorAuthority
        this.proseMirrorAuthority = null
        this.isDisabled = isDisabled
        this.readOnly = readOnly || Boolean(proseMirrorAuthority && !proseMirrorAuthority.receiveOnly)
        this.aiChatThreadRenderContext = {
            ...(aiChatThreadRenderContext ?? {}),
            readOnly,
            // Capability run traces render Asset and Capability handles with the
            // same hover cards prompt references use, so the chat thread needs
            // the same resolver the prompt-reference node views get.
            promptReferencePreviewRenderer,
        }
        this.documentType = documentType
        this.threadId = threadId
        this.registeredSchema = schema
        this.registeredPlugins = plugins
        this.enablePromptReferences = enablePromptReferences
        this.editorSchema = this.createSchema()

        const initialDocContent = this.createInitialDocument(initialVal, content)

        this.editorView = new EditorView(editorMountElement, {
            state: EditorState.create({
                doc: initialDocContent,    // initialVal is the initial content of the editor
                plugins: this.createPlugins(initialVal, isDisabled)
            }),
            editable: () => this.isEditorEditable()
        })

        if (this.proseMirrorAuthorityOptions) {
            const onLeaseStateChange = this.proseMirrorAuthorityOptions.onLeaseStateChange
            this.proseMirrorAuthority = new ProseMirrorAuthorityService({
                ...this.proseMirrorAuthorityOptions,
                getView: () => this.editorView,
                onRemoteDocumentChange: value => this.dispatchStreamingUpdate(value),
                onLeaseStateChange: state => this.handleLeaseStateChange(state, onLeaseStateChange),
            })
        }
    }

    createInitialDocument(initialVal, content) {
        const hasValidContent = initialVal && typeof initialVal === 'object' && Object.keys(initialVal).length > 0

        if (this.documentType === DOCUMENT_TYPE.AI_PROMPT_INPUT) {
            if (hasValidContent) {
                try {
                    const doc = this.editorSchema.nodeFromJSON(initialVal)
                    doc.check()
                    return doc
                } catch (e) {
                    console.warn('[EDITOR] Invalid AI prompt draft, creating fresh input:', e)
                }
            }
            const inputNode = this.editorSchema.nodes[aiPromptInputNodeType].createAndFill()
            return this.editorSchema.nodes.doc.create(null, [inputNode])
        }

        if (
            this.documentType === DOCUMENT_TYPE.ASSET_CONVERSATION
            || this.documentType === DOCUMENT_TYPE.ASSET_PROVENANCE
        ) {
            if (hasValidContent) {
                try {
                    const doc = this.editorSchema.nodeFromJSON(initialVal)
                    doc.check()
                    return doc
                } catch (e) {
                    console.warn('📝 [EDITOR] Invalid AI chat thread content, creating fresh document:', e)
                    console.warn('📝 [EDITOR] Failed initialVal:', JSON.stringify(initialVal, null, 2))
                }
            }

            const threadNode = this.editorSchema.nodes.aiChatThread.createAndFill({ threadId: this.threadId })
            return this.editorSchema.nodes.doc.create(null, [threadNode])
        }

        return hasValidContent
            ? this.editorSchema.nodeFromJSON(initialVal)
            : DOMParser.fromSchema(this.editorSchema).parse(content)
    }

    createSchema() {
        return this.registeredSchema ?? createProseMirrorSchema(this.documentType)
    }

    createPlugins(initialValue, isDisabled) {
        if (this.registeredSchema) {
            const registeredPlugins = [
                statePlugin(
                    initialValue,
                    this.dispatchStateChange.bind(this),
                    this.dispatchStreamingUpdate.bind(this),
                    this.proseMirrorAuthorityOptions ? this.dispatchLocalTransaction.bind(this) : null
                ),
                focusPlugin(this.updateEditorFocusState.bind(this)),
                createPromptReferenceNodeViewPlugin(this.promptReferencePreviewRenderer),
                ...this.registeredPlugins,
                keymap(baseKeymap),
                dropCursor(),
                gapCursor(),
                history(),
            ]
            if (this.enablePromptReferences && this.promptReferenceCatalog) {
                registeredPlugins.push(createAtPromptReferencePickerPlugin(this.promptReferenceCatalog))
            }
            return registeredPlugins
        }
        const basePlugins = [
            statePlugin(
                initialValue,
                this.dispatchStateChange.bind(this),
                this.dispatchStreamingUpdate.bind(this),
                this.proseMirrorAuthorityOptions ? this.dispatchLocalTransaction.bind(this) : null
            ),
            focusPlugin(this.updateEditorFocusState.bind(this)), // Allows to enable editor if it was disabled and user clicks on the editor area
            bubbleMenuPlugin(),
            linkTooltipPlugin(),
            imageSelectionPlugin(),
            createPromptReferenceNodeViewPlugin(this.promptReferencePreviewRenderer),
            buildInputRules(this.editorSchema),
            keymap(buildKeymap(this.editorSchema, this.documentType)),
            keymap(baseKeymap),
            dropCursor(),
            gapCursor(),
            history(),
            // createSvelteComponentRendererPlugin(TaskRow, 'taskRow', defautSubtaskAttrs),
            createCodeBlockPlugin(this.editorSchema),
            codeBlockInputRule(this.editorSchema),
            activeNodePlugin,
            // codeMirrorInputRulePlugin(this.editorSchema),
        ]

        // Add aiChatThread-specific plugins only for AI chat thread documents
        if (
            this.documentType === DOCUMENT_TYPE.ASSET_CONVERSATION
            || this.documentType === DOCUMENT_TYPE.ASSET_PROVENANCE
        ) {
            basePlugins.push(
                createAiChatThreadPlugin({
                    sendAiRequestHandler: async val => {
                        await this.proseMirrorAuthority?.flushPendingSteps()
                        await this.onAiChatSubmit(val)
                    },
                    stopAiRequestHandler: val => this.onAiChatStop(val),
                    onReceivingStateChange: this.onReceivingStateChange,
                    renderContext: this.aiChatThreadRenderContext
                })
            )
        }

        // Add aiPromptInput-specific plugin for the floating input editor
        if (this.documentType === DOCUMENT_TYPE.AI_PROMPT_INPUT) {
            if (this.promptReferenceCatalog) {
                basePlugins.push(
                    createAtPromptReferencePickerPlugin(this.promptReferenceCatalog),
                    createSlashCapabilityModulePickerPlugin(this.promptReferenceCatalog),
                )
            }
            basePlugins.push(
                createAiPromptInputPlugin({
                    onSubmit: (data) => this.onPromptSubmit?.(data),
                    createContextTray: this.promptControlFactories?.createContextTray,
                    createModelDropdown: this.promptControlFactories?.createModelDropdown,
                    createModelMultiSelect: this.promptControlFactories?.createModelMultiSelect,
                    createImageModelDropdown: this.promptControlFactories?.createImageModelDropdown,
                    createImageModelMultiSelect: this.promptControlFactories?.createImageModelMultiSelect,
                    createImageSizeDropdown: this.promptControlFactories?.createImageSizeDropdown,
                    createVideoModelDropdown: this.promptControlFactories?.createVideoModelDropdown,
                    createVideoModelMultiSelect: this.promptControlFactories?.createVideoModelMultiSelect,
                    createVideoAspectDropdown: this.promptControlFactories?.createVideoAspectDropdown,
                    createVideoResolutionDropdown: this.promptControlFactories?.createVideoResolutionDropdown,
                    createVideoDurationDropdown: this.promptControlFactories?.createVideoDurationDropdown,
                    createSubmitButton: this.promptControlFactories?.createSubmitButton,
                    createCapabilityControls: this.promptControlFactories?.createCapabilityControls,
                    placeholderText: 'Talk to me...'
                })
            )
        }

        return basePlugins
    }

    updateDocument(value) {
        if (!this.editorView || !value) return
        const nextDoc = this.editorSchema.nodeFromJSON(value)
        nextDoc.check()
        if (this.editorView.state.doc.eq(nextDoc)) return
        this.editorView.updateState(EditorState.create({
            doc: nextDoc,
            plugins: this.createPlugins(value, this.isDisabled),
        }))
    }

    isEditorEditable() {
        return !this.isDisabled && !this.readOnly
    }

    updateEditorFocusState(focusedState) {
        if (!this.editorView) { return }
        this.editorView.setProps({ editable: () => this.isEditorEditable() })
    }

    handleLeaseStateChange(state, onLeaseStateChange) {
        if (!this.editorView) return
        this.readOnly = state.readOnly
        this.editorView.setProps({ editable: () => this.isEditorEditable() })
        onLeaseStateChange?.(state)
    }

    dispatchStateChange(json) {
        this.onEditorChange?.(json)
    }

    dispatchStreamingUpdate(json) {
        this.onStreamingUpdate?.(json)
    }

    dispatchLocalTransaction(transaction) {
        this.proseMirrorAuthority?.submitLocalTransaction(transaction)
    }

    destroy() {
        this.proseMirrorAuthority?.disconnect()
        this.proseMirrorAuthority = null
        if (this.editorView) {
            this.editorView.destroy()
            this.editorView = null
            this.editorSchema = null
        }
    }
}

export default ProseMirrorEditor
