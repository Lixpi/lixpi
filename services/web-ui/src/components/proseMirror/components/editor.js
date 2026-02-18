// @ts-nocheck
'use strict'

import { EditorState, Plugin, PluginKey } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Schema, DOMParser } from "prosemirror-model"
import customNodes from '$src/components/proseMirror/customNodes'
// import { schema } from "prosemirror-schema-basic"
import { schema } from '$src/components/proseMirror/components/schema'
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
    createAiChatThreadPlugin,
    aiChatThreadNodeType,
    aiChatThreadNodeSpec,
    aiResponseMessageNodeType,
    aiResponseMessageNodeSpec,
    aiUserMessageNodeType,
    aiUserMessageNodeSpec,
    aiGeneratedImageNodeType,
    aiGeneratedImageNodeSpec,
    aiGeneratedImageNodeView
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin'
// aiUserInput is kept in the schema for legacy content migration but no longer imported here
import { aiUserInputNodeType, aiUserInputNodeSpec } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserInputNode.ts'
import {
    createAiPromptInputPlugin,
    aiPromptInputNodeType,
    aiPromptInputNodeSpec
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin'
import { createCodeBlockPlugin, codeBlockInputRule } from '$src/components/proseMirror/plugins/codeBlockPlugin.js'
import { activeNodePlugin } from "$src/components/proseMirror/plugins/activeNodePlugin"

// Node types
import { documentTitleNodeType } from "$src/components/proseMirror/customNodes/documentTitleNode.js"

import { bubbleMenuPlugin } from '$src/components/proseMirror/plugins/bubbleMenuPlugin/index.ts'
import { linkTooltipPlugin } from '$src/components/proseMirror/plugins/linkTooltipPlugin/linkTooltipPlugin.ts'
import { slashCommandsMenuPlugin } from '$src/components/proseMirror/plugins/slashCommandsMenuPlugin/index.ts'
import { imageLifecyclePlugin } from '$src/components/proseMirror/plugins/imageLifecyclePlugin/index.ts'
import { imageSelectionPlugin } from '$src/components/proseMirror/plugins/imageSelectionPlugin/index.ts'

import {buildKeymap} from "$src/components/proseMirror/components/keyMap.js"
import {buildInputRules} from "$src/components/proseMirror/components/inputRules.js"
import { createSvelteComponentRendererPlugin } from '$src/components/proseMirror/plugins/svelteComponentRenderer/svelteComponentRendererPlugin.js'
// import TaskRow from '$src/rows/TaskRow.svelte'

import { defaultAttrs as defautSubtaskAttrs } from '$src/components/proseMirror/customNodes/taskRowNode.js'

// Document type constants
const DOCUMENT_TYPE = {
    DOCUMENT: 'document',
    AI_CHAT_THREAD: 'aiChatThread',
    AI_PROMPT_INPUT: 'aiPromptInput'
}

// `nodesBuilder` extends the base ProseMirror `schema` with custom node types defined in `supportedNodes`.
// `schema`: Base ProseMirror schema to be extended.
// `supportedNodes`: Object with custom node types. Each key is a node type name, value is its spec.
// `documentType`: Determines the doc content model.
// Returns the extended schema.
const nodesBuilder = (schema, supportedNodes, documentType) => {
    const nodesKeys = Object.keys(supportedNodes)

    // Determine doc content based on documentType
    // - 'document': Regular documents with title and block content
    // - 'aiChatThread': AI chat thread with title and aiChatThread nodes
    // - 'aiPromptInput': Floating AI prompt input (single aiPromptInput node)
    let docContent
    if (documentType === DOCUMENT_TYPE.AI_CHAT_THREAD) {
        docContent = `${documentTitleNodeType} ${aiChatThreadNodeType}+`
    } else if (documentType === DOCUMENT_TYPE.AI_PROMPT_INPUT) {
        docContent = `${aiPromptInputNodeType}`
    } else {
        docContent = `${documentTitleNodeType} block+`
    }

    let extendedSchema = schema.spec.nodes
    .update('doc', {
        content: docContent,
        marks: "_",
    })

    // IMPORTANT: Preserve base schema order when overriding existing nodes.
    // If we add (or re-add) existing textblocks like `code_block` *before* `paragraph`,
    // ProseMirror's default block selection can pick `code_block` when you press Enter
    // out of the title, which makes regular documents feel broken.
    nodesKeys.forEach((nodeKey) => {
        const spec = supportedNodes[nodeKey]
        if (extendedSchema.get(nodeKey)) {
            extendedSchema = extendedSchema.update(nodeKey, spec)
        } else {
            extendedSchema = extendedSchema.addBefore("paragraph", nodeKey, spec)
        }
    })
    return extendedSchema
}

export class ProseMirrorEditor {
    constructor({
        editorMountElement,
        content,
        initialVal = {},
        isDisabled,
        documentType = DOCUMENT_TYPE.DOCUMENT,
        threadId,
        onEditorChange,
        onProjectTitleChange,
        onAiChatSubmit,
        onAiChatStop,
        onPromptSubmit,
        onPromptStop,
        isPromptReceiving,
        promptControlFactories,
        onReceivingStateChange
    }) {
        this.onEditorChange = onEditorChange
        this.onProjectTitleChange = onProjectTitleChange
        this.onAiChatSubmit = onAiChatSubmit
        this.onAiChatStop = onAiChatStop
        this.onPromptSubmit = onPromptSubmit
        this.onPromptStop = onPromptStop
        this.isPromptReceiving = isPromptReceiving
        this.promptControlFactories = promptControlFactories
        this.onReceivingStateChange = onReceivingStateChange
        this.isDisabled = isDisabled
        this.documentType = documentType
        this.threadId = threadId
        this.editorSchema = this.createSchema()

        const initialDocContent = this.createInitialDocument(initialVal, content)

        this.editorView = new EditorView(editorMountElement, {
            state: EditorState.create({
                doc: initialDocContent,    // initialVal is the initial content of the editor
                plugins: this.createPlugins(initialVal, isDisabled)
            }),
            editable: () => !isDisabled
        })
    }

    createInitialDocument(initialVal, content) {
        const hasValidContent = initialVal && typeof initialVal === 'object' && Object.keys(initialVal).length > 0

        console.log('📝 [EDITOR] createInitialDocument called:', {
            documentType: this.documentType,
            threadId: this.threadId,
            hasValidContent,
            initialValKeys: initialVal ? Object.keys(initialVal) : null,
            initialValType: initialVal?.type
        })

        if (this.documentType === DOCUMENT_TYPE.AI_PROMPT_INPUT) {
            // Floating prompt input — always create fresh
            const inputNode = this.editorSchema.nodes[aiPromptInputNodeType].createAndFill()
            return this.editorSchema.nodes.doc.create(null, [inputNode])
        }

        if (this.documentType === DOCUMENT_TYPE.AI_CHAT_THREAD) {
            if (hasValidContent) {
                try {
                    console.log('📝 [EDITOR] Attempting to parse initialVal as AI chat thread:', JSON.stringify(initialVal, null, 2).substring(0, 500))
                    const doc = this.editorSchema.nodeFromJSON(initialVal)
                    console.log('📝 [EDITOR] Successfully created doc from JSON, running check()...')
                    doc.check()
                    console.log('📝 [EDITOR] doc.check() passed, returning doc')
                    return doc
                } catch (e) {
                    console.warn('📝 [EDITOR] Invalid AI chat thread content, creating fresh document:', e)
                    console.warn('📝 [EDITOR] Failed initialVal:', JSON.stringify(initialVal, null, 2))
                }
            }

            console.log('📝 [EDITOR] Creating fresh AI chat thread document with threadId:', this.threadId)
            const titleNode = this.editorSchema.nodes.documentTitle.createAndFill()
            const threadNode = this.editorSchema.nodes.aiChatThread.createAndFill({ threadId: this.threadId })
            console.log('📝 [EDITOR] Created threadNode:', threadNode?.toString())
            return this.editorSchema.nodes.doc.create(null, [titleNode, threadNode])
        }

        return hasValidContent
            ? this.editorSchema.nodeFromJSON(initialVal)
            : DOMParser.fromSchema(this.editorSchema).parse(content)
    }

    createSchema() {
        let allNodes
        if (this.documentType === DOCUMENT_TYPE.AI_CHAT_THREAD) {
            allNodes = {
                ...customNodes,
                [aiChatThreadNodeType]: aiChatThreadNodeSpec,
                [aiResponseMessageNodeType]: aiResponseMessageNodeSpec,
                // aiUserInput kept in schema for legacy content migration
                [aiUserInputNodeType]: aiUserInputNodeSpec,
                [aiUserMessageNodeType]: aiUserMessageNodeSpec,
                [aiGeneratedImageNodeType]: aiGeneratedImageNodeSpec
            }
        } else if (this.documentType === DOCUMENT_TYPE.AI_PROMPT_INPUT) {
            allNodes = {
                [aiPromptInputNodeType]: aiPromptInputNodeSpec
            }
        } else {
            allNodes = { ...customNodes }
        }

        return new Schema({
            nodes: nodesBuilder(schema, allNodes, this.documentType),
            marks: schema.spec.marks
        })
    }

    createPlugins(initialValue, isDisabled) {
        const basePlugins = [
            statePlugin(initialValue, this.dispatchStateChange.bind(this), this.onProjectTitleChange.bind(this)),
            focusPlugin(this.updateEditorFocusState.bind(this)), // Allows to enable editor if it was disabled and user clicks on the editor area
            bubbleMenuPlugin(),
            linkTooltipPlugin(),
            slashCommandsMenuPlugin(),
            imageLifecyclePlugin(),
            imageSelectionPlugin(),
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
        if (this.documentType === DOCUMENT_TYPE.AI_CHAT_THREAD) {
            basePlugins.push(
                createAiChatThreadPlugin({
                    sendAiRequestHandler: val => this.onAiChatSubmit(val),
                    stopAiRequestHandler: val => this.onAiChatStop(val),
                    placeholders: {
                        titlePlaceholder: 'New document',
                        paragraphPlaceholder: 'I\'m your new document...'
                    },
                    onReceivingStateChange: this.onReceivingStateChange
                })
            )
        }

        // Add aiPromptInput-specific plugin for the floating input editor
        if (this.documentType === DOCUMENT_TYPE.AI_PROMPT_INPUT) {
            basePlugins.push(
                createAiPromptInputPlugin({
                    onSubmit: (data) => this.onPromptSubmit?.(data),
                    onStop: () => this.onPromptStop?.(),
                    isReceiving: () => this.isPromptReceiving?.() ?? false,
                    createModelDropdown: this.promptControlFactories?.createModelDropdown,
                    createImageToggle: this.promptControlFactories?.createImageToggle,
                    createSubmitButton: this.promptControlFactories?.createSubmitButton,
                    placeholderText: 'Talk to me...'
                })
            )
        }

        return basePlugins
    }

    updateEditorFocusState(focusedState) {
        if (!this.editorView) { return }
        this.editorView.setProps({ editable: () => !this.isDisabled })
    }

    dispatchStateChange(json) {
        this.onEditorChange(json)
    }

    destroy() {
        if (this.editorView) {
            this.editorView.destroy()
            this.editorView = null
            this.editorSchema = null
        }
    }
}

export default ProseMirrorEditor
