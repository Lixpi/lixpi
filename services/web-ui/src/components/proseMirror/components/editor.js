// @ts-nocheck
'use strict'

import { EditorState, Plugin, PluginKey } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { Schema, DOMParser } from "prosemirror-model"
import customNodes from '../customNodes'
// import { schema } from "prosemirror-schema-basic"
import { schema } from './schema'
import { keymap } from "prosemirror-keymap"
import { history } from "prosemirror-history"
import { baseKeymap } from "prosemirror-commands"
import { dropCursor } from "prosemirror-dropcursor"
import { gapCursor } from "prosemirror-gapcursor"

// Plugins
import { statePlugin } from '../plugins/statePlugin.js'
import focusPlugin from '../plugins/focusPlugin.js'
import { createAiUserInputPlugin } from '../plugins/aiUserInputPlugin.js' //TODO: deprecated, remove
import { createAiUserMessagePlugin } from '../plugins/aiUserMessagePlugin.js'
import lockCursorPositionPlugin from '../plugins/lockCursorPositionPlugin.js'
import {
    createAiChatThreadPlugin,
    aiChatThreadNodeType,
    aiChatThreadNodeSpec,
    aiResponseMessageNodeType,
    aiResponseMessageNodeSpec
} from '../plugins/aiChatThreadPlugin'
import { createCodeBlockPlugin, codeBlockInputRule } from '../plugins/codeBlockPlugin.js'
import { activeNodePlugin } from "../plugins/activeNodePlugin"

// Node types
import { documentTitleNodeType } from "../customNodes/documentTitleNode.js"

import { bubbleMenuPlugin } from '../plugins/bubbleMenuPlugin/index.ts'
import { linkTooltipPlugin } from '../plugins/linkTooltipPlugin/linkTooltipPlugin.ts'
import { slashCommandsMenuPlugin } from '../plugins/slashCommandsMenuPlugin/index.ts'
import { imageLifecyclePlugin } from '../plugins/imageLifecyclePlugin/index.ts'
import { imageSelectionPlugin } from '../plugins/imageSelectionPlugin/index.ts'

import {buildKeymap} from "./keyMap.js"
import {buildInputRules} from "./inputRules.js"
import { createSvelteComponentRendererPlugin } from '../plugins/svelteComponentRenderer/svelteComponentRendererPlugin.js'
// import TaskRow from './../../rows/TaskRow.svelte'

import { defaultAttrs as defautSubtaskAttrs } from '../customNodes/taskRowNode.js'

// Document type constants
const DOCUMENT_TYPE = {
    DOCUMENT: 'document',
    AI_CHAT_THREAD: 'aiChatThread'
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
    const docContent = documentType === DOCUMENT_TYPE.AI_CHAT_THREAD
        ? `${documentTitleNodeType} ${aiChatThreadNodeType}+`
        : `${documentTitleNodeType} block+`

    let extendedSchema = schema.spec.nodes
    .update('doc', {
        content: docContent,
        marks: "_",
    })
    nodesKeys.forEach((nodeKey) => {
        extendedSchema = extendedSchema.addBefore("paragraph", nodeKey, supportedNodes[nodeKey])
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
        onEditorChange,
        onProjectTitleChange,
        onAiChatSubmit,
        onAiChatStop
    }) {
        this.onEditorChange = onEditorChange
        this.onProjectTitleChange = onProjectTitleChange
        this.onAiChatSubmit = onAiChatSubmit
        this.onAiChatStop = onAiChatStop
        this.isDisabled = isDisabled
        this.documentType = documentType
        this.editorSchema = this.createSchema()

        const initialDocContent = Object.keys(initialVal ?? {}).length > 0
            ? this.editorSchema.nodeFromJSON(initialVal)
            : DOMParser.fromSchema(this.editorSchema).parse(content);

        this.editorView = new EditorView(editorMountElement, {
            state: EditorState.create({
                doc: initialDocContent,    // initialVal is the initial content of the editor
                plugins: this.createPlugins(initialVal, isDisabled)
            }),
            editable: () => !isDisabled
        })
    }

    createSchema() {
        // Combine custom nodes with plugin nodes for schema building
        const allNodes = {
            ...customNodes,
            [aiChatThreadNodeType]: aiChatThreadNodeSpec,
            [aiResponseMessageNodeType]: aiResponseMessageNodeSpec
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
                        paragraphPlaceholder: 'Type something and hit Cmd+Enter on Mac or Ctrl+Enter on PC to send it to AI.\n'
                    }
                }),
                createAiUserInputPlugin(val => {})
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
